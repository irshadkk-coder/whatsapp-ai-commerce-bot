require("dotenv").config();
const express = require("express");
const rateLimit = require("express-rate-limit");
const { connectDatabase, mongoose } = require("./src/config/database");
const Customer = require("./src/models/Customer");
const Conversation = require("./src/models/Conversation");
const Message = require("./src/models/Message");
const Product = require("./src/models/Product");
const Order = require("./src/models/Order");
const { sendWhatsAppText } = require("./src/services/whatsappService");
const { getGeminiReply } = require("./src/services/geminiService");
const { createOrder } = require("./src/services/orderService");
const { canCancelOrder, customerOrders, trackingText } = require("./src/services/orderLifecycleService");
const { createPaymentLink, fetchPaymentLink, verifyWebhookSignature } = require("./src/services/paymentService");
const { findRelevantProduct, findCategoryProducts, getAvailableProducts, getRequestedCategory, availableProductFilter } = require("./src/utils/productService");
const adminRoutes = require("./src/routes/adminRoutes");
const app = express();
app.disable("x-powered-by");
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many login attempts. Please try again later." } });
const adminApiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please try again later." } });
function webhookPaymentIdentifiers(event) {
  const payment = event.payload?.payment?.entity;
  const paymentLink = event.payload?.payment_link?.entity;
  return {
    payment,
    paymentLink,
    paymentId: payment?.id,
    razorpayOrderId: payment?.order_id || paymentLink?.order_id,
    paymentLinkId: paymentLink?.id || payment?.payment_link_id,
    referenceId: paymentLink?.reference_id,
  };
}

async function findOnlineOrderForWebhook(identifiers) {
  const matchingFields = [];
  if (identifiers.paymentLinkId) {
    const field = { razorpayPaymentLinkId: identifiers.paymentLinkId };
    matchingFields.push(field);
    const order = await Order.findOne({ paymentMethod: { $in: ["ONLINE", "COD"] }, ...field });
    if (order) return { order, matchingFields };
  }
  if (identifiers.referenceId) {
    const field = { razorpayReferenceId: identifiers.referenceId };
    matchingFields.push(field);
    const order = await Order.findOne({ paymentMethod: { $in: ["ONLINE", "COD"] }, ...field });
    if (order) return { order, matchingFields };
  }
  if (identifiers.razorpayOrderId) {
    const field = { razorpayOrderId: identifiers.razorpayOrderId };
    matchingFields.push(field);
    const order = await Order.findOne({ paymentMethod: { $in: ["ONLINE", "COD"] }, ...field });
    if (order) return { order, matchingFields };
  }
  return { order: null, matchingFields };
}

function logWebhookMatchFailure(eventType, identifiers, matchingFields) {
  console.warn("Razorpay webhook order match failed", {
    eventType,
    paymentId: identifiers.paymentId,
    razorpayOrderId: identifiers.razorpayOrderId,
    paymentLinkId: identifiers.paymentLinkId,
    referenceId: identifiers.referenceId,
    matchingFields,
  });
}
// Razorpay signs the exact bytes it sends, so this route must receive the raw body.
app.post("/webhook/razorpay", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!verifyWebhookSignature(req.body, req.get("x-razorpay-signature"))) {
      console.warn("Rejected Razorpay webhook with an invalid signature.");
      return res.sendStatus(401);
    }
    const event = JSON.parse(req.body.toString("utf8"));
    const identifiers = webhookPaymentIdentifiers(event);
    const { payment, paymentLink, razorpayOrderId } = identifiers;
    const { order, matchingFields } = await findOnlineOrderForWebhook(identifiers);
    if (event.event === "payment.failed") {
      if (!order) { logWebhookMatchFailure(event.event, identifiers, matchingFields); return res.sendStatus(200); }
      if (order.paymentMethod === "COD" && order.paymentStatus === "COD" && order.orderStatus === "CONFIRMED") {
        console.info("Razorpay payment failed; existing COD order remains unchanged", { orderId: order.orderId, paymentLinkId: identifiers.paymentLinkId });
        return res.sendStatus(200);
      }
      const failed = await Order.findOneAndUpdate({ _id: order._id, paymentMethod: "ONLINE", paymentStatus: "PENDING" }, { $set: { paymentStatus: "FAILED" } }, { new: true });
      if (failed) await reply({ _id: failed.customerId, whatsappId: failed.whatsappId }, "Payment was not completed. Your order has not been confirmed yet. You can try the payment link again or contact support to choose Cash on Delivery.");
      return res.sendStatus(200);
    }
    if (!["payment.captured", "payment_link.paid"].includes(event.event) || !payment) return res.sendStatus(200);
    const amount = Number(payment.amount);
    const paidLinkEvent = event.event === "payment_link.paid" && paymentLink?.status === "paid";
    const capturedPayment = payment.status === "captured" || event.event === "payment.captured";
    const storedOrderIdMismatch = order?.razorpayOrderId && razorpayOrderId && order.razorpayOrderId !== razorpayOrderId;
    if (!order) {
      logWebhookMatchFailure(event.event, identifiers, matchingFields);
      return res.sendStatus(200);
    }
    if (order.paymentStatus === "PAID") return res.sendStatus(200);
    if (payment.currency !== "INR" || !Number.isSafeInteger(amount) || !capturedPayment || (event.event === "payment_link.paid" && !paidLinkEvent) || storedOrderIdMismatch || amount !== Math.round(Number(order.totalAmount) * 100)) {
      logWebhookMatchFailure(event.event, identifiers, matchingFields);
      return res.sendStatus(200);
    }
    const wasCodOnlineAttempt = order.paymentMethod === "COD" && order.paymentStatus === "COD";
    const paidOrder = await Order.findOneAndUpdate({ _id: order._id, paymentMethod: { $in: ["ONLINE", "COD"] }, paymentStatus: { $in: ["PENDING", "FAILED", "COD"] } }, { $set: { paymentMethod: "ONLINE", paymentStatus: "PAID", razorpayPaymentId: payment.id, paidAt: new Date(), orderStatus: "CONFIRMED" } }, { new: true });
    if (!paidOrder) return res.sendStatus(200);
    await Customer.updateOne({ _id: paidOrder.customerId }, { $inc: { totalOrders: 1, totalSpent: paidOrder.totalAmount } });
    await Conversation.updateMany({ pendingOrderId: paidOrder._id, currentStep: "AWAITING_PAYMENT_VERIFICATION" }, { $set: { status: "COMPLETED", currentStep: "IDLE" } });
    const confirmationText = wasCodOnlineAttempt ? `Payment Successful!\n\nYour existing order #${paidOrder.orderId} has been updated to Online Payment.\n\nPaid: Rs.${paidOrder.totalAmount}/-\n\nThank you for your order!` : `Payment Successful!\n\nYour order has been confirmed.\n\nOrder: #${paidOrder.orderId}\nProduct: ${paidOrder.productName}\nQuantity: ${paidOrder.quantity}\nPaid: Rs.${paidOrder.totalAmount}/-\n\nPayment: Online Payment\n\nThank you for your order!`;
    await reply({ _id: paidOrder.customerId, whatsappId: paidOrder.whatsappId }, confirmationText);
    return res.sendStatus(200);
  } catch (error) { console.error("Razorpay webhook processing error:", error.message); return res.sendStatus(500); }
});
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  next();
});
app.use((req, res, next) => {
  const origin = req.get("origin");
  const allowedOrigin = process.env.ADMIN_DASHBOARD_ORIGIN || "http://localhost:3000";
  if (origin === allowedOrigin) res.set("Access-Control-Allow-Origin", allowedOrigin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use("/api/admin/login", adminLoginLimiter);
app.use("/api/admin", adminApiLimiter, adminRoutes);
const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => res.send("WhatsApp AI Bot is running"));
app.get("/health", (_req, res) => res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({ status: mongoose.connection.readyState === 1 ? "ok" : "unavailable", database: mongoose.connection.readyState === 1 ? "connected" : "disconnected" }));
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) return res.status(200).send(req.query["hub.challenge"]);
  return res.sendStatus(403);
});
const norm = (text) => text.trim().toLowerCase();
const isCancel = (text) => ["cancel", "stop"].includes(norm(text));
const isYes = (text) => ["yes", "1"].includes(norm(text));
const isNo = (text) => ["no", "2", "cancel"].includes(norm(text));
const isEdit = (text) => norm(text) === "edit";
const isHuman = (text) => /\b(human|agent|person|support|talk to)\b/i.test(text);
const isOrder = (text) => /\b(order|buy|purchase|need|want|get)\b/i.test(text);
const isNewOrder = (text) => /\b(order|buy|purchase|need|want)\b/i.test(text);
const isGreeting = (text) => /^(hi+|hello+|hey+|hii+)$/i.test(text.trim());
const isOnlinePaymentRequest = (text) => /\b(pay\s+online|online\s+payment|change\s+to\s+online\s+payment|want\s+to\s+pay\s+now|pay\s+by\s+upi)\b/i.test(text);
const isCodPaymentRequest = (text) => /\b(want\s+cod|cash\s+on\s+delivery|pay\s+cod)\b/i.test(text);
const isPaymentStatusQuestion = (text) => /\b(payment\s*status|did\s+(?:my\s+)?payment\s+(?:go\s+through|succeed)|is\s+(?:my\s+)?payment\s+successful|payment\s+pending)\b/i.test(text);
const isPaymentRetryRequest = (text) => /\b(repay|pay\s+again|retry\s+payment|need\s+to\s+repay|payment\s+failed|try\s+(?:the\s+)?payment\s+again)\b/i.test(text);
function normalizedIntent(text) { return String(text).trim().toLowerCase().replace(/\u2019/g, "'").replace(/[.!?,]+$/, ""); }
const isTrackingRequest = (text) => /^(?:track(?:\s+(?:my\s+)?)?order|where\s+is\s+my\s+order|order\s+status|my\s+orders?|track\s+my\s+package|where\s+is\s+my\s+package|delivery\s+status|track)$/i.test(normalizedIntent(text));
const isOrderCancellationRequest = (text) => /\b(cancel(?:\s+my)?\s+order|i\s+want\s+to\s+cancel|cancel\s+order)\b/i.test(text);

function isFlowCancellationIntent(text) {
  if (isOrderCancellationRequest(text)) return true;
  return new Set(["cancel", "cancel order", "cancel this", "i don't want this", "i dont want this", "i don't want this product", "i dont want this product", "stop", "forget it", "never mind"]).has(normalizedIntent(text));
}

function isProductChangeIntent(text) {
  return new Set(["i want another product", "need another product", "need other product", "i want other product", "change product", "different product", "show other products", "show products", "choose another product", "i want a different product", "another item", "different item"]).has(normalizedIntent(text));
}
function isViewedProductOrderIntent(text) {
  const message = String(text).trim().replace(/[.!?]+$/, "");
  return isYes(message) || /^(?:ok|okay|i\s+want\s+(?:it|this|this\s+product)|i\s+need\s+(?:this\s+product|order\s+this\s+product)|i\s+want\s+to\s+(?:order\s+this|buy\s+this\s+item)|order\s+(?:it|this))$/i.test(message);
}
const isGenericCatalogRequest = (text) => /^(?:any\s+products?\s+(?:is|are)\s+available|what\s+products?\s+(?:do\s+you\s+have|are\s+available)|can\s+(?:you|u)\s+list\s+(?:your|ur)?\s*products?|list\s+products?|show\s+(?:me\s+)?products?|products?|product\s+list|what\s+do\s+you\s+sell|what\s+can\s+i\s+buy|what\s+items\s+do\s+you\s+have|available\s+products?)\??$/i.test(String(text).trim());
const orderIdFromText = (text) => String(text).match(/\bORD-\d{8}-[A-Z0-9]+\b/i)?.[0]?.toUpperCase();
const reply = (customer, text) => sendWhatsAppText({ to: customer.whatsappId, text, customerId: customer._id });
function productListText(products, title) {
  if (!products.length) return title ? `Sorry, there are currently no available products in the ${title} category. 😊` : "Sorry, there are currently no products available. Please check back later. 😊";
  return `🛍️ ${title ? `${title} Products` : "Our Available Products"}\n\n${products.map((product, index) => `${index + 1}️⃣ ${product.name}\n💰 ₹${product.price}/-\n📦 In Stock${product.cod ? "\n💳 COD Available" : ""}`).join("\n\n")}\n\nReply with the product name to order. 😊`;
}
function productDetailsText(product) {
  return `✨ ${product.name}\n\n💰 Price: ₹${product.price}/-\n📦 In Stock\n${product.cod ? "💳 COD Available" : "💳 Online Payment Available"}${product.description ? `\n\n${product.description}` : ""}\n\nWould you like to order this product? 😊\n\nReply YES to order\nReply NO to cancel`;
}
function clearViewedProduct(conversation) { ["selectedProductId", "selectedProductName", "selectedProductPrice"].forEach((key) => { conversation[key] = undefined; }); }
async function beginViewedProductOrder(customer, conversation) {
  const product = await Product.findOne({ productId: conversation.selectedProductId, ...availableProductFilter }).lean();
  if (!product) { clearViewedProduct(conversation); await conversation.save(); await reply(customer, "Sorry, that product is no longer available."); return true; }
  await begin({ customer, conversation, product, quantity: 1 });
  return true;
}
async function handleCatalog(customer, category) {
  const products = category ? await findCategoryProducts(category) : await getAvailableProducts();
  await reply(customer, productListText(products, category));
  return true;
}
function recentOrdersText(orders) { return `📦 Your recent orders:\n\n${orders.map((order, index) => `${index + 1}️⃣ #${order.orderId} — ${order.productName}\n   Status: ${order.orderStatus}`).join("\n\n")}\n\nReply with the order number you want to track.`; }
async function handleTracking(customer, text) {
  const requestedOrderId = orderIdFromText(text);
  const result = await customerOrders(customer._id, requestedOrderId);
  if (requestedOrderId) { if (!result) { await reply(customer, "Sorry, I couldn't find that order in your account."); return true; } await reply(customer, trackingText(result)); return true; }
  if (!result.length) { await reply(customer, "I couldn't find any orders in your account yet."); return true; }
  if (result.length > 1) { await reply(customer, recentOrdersText(result)); return true; }
  await reply(customer, trackingText(result[0])); return true;
}
async function handleOrderCancellation(customer, text) {
  const requestedOrderId = orderIdFromText(text);
  const result = await customerOrders(customer._id, requestedOrderId);
  if (requestedOrderId && !result) { await reply(customer, "Sorry, I couldn't find that order in your account."); return true; }
  if (!requestedOrderId && !result.length) { await reply(customer, "I couldn't find an order to cancel in your account."); return true; }
  if (!requestedOrderId && result.length > 1) { await reply(customer, `📦 Your recent orders:\n\n${result.map((order, index) => `${index + 1}️⃣ #${order.orderId} — ${order.productName}\n   Status: ${order.orderStatus}`).join("\n\n")}\n\nReply “cancel order <order number>” to cancel an eligible order.`); return true; }
  const order = requestedOrderId ? result : result[0];
  if (!canCancelOrder(order)) { const message = order.orderStatus === "SHIPPED" ? "🚚 Your order has already been shipped, so cancellation is no longer available." : order.orderStatus === "DELIVERED" ? "🎉 This order has already been delivered, so it cannot be cancelled." : "❌ This order is already cancelled."; await reply(customer, message); return true; }
  const cancelled = await Order.findOneAndUpdate({ _id: order._id, customerId: customer._id, orderStatus: { $in: ["PENDING", "CONFIRMED", "PROCESSING"] } }, { $set: { orderStatus: "CANCELLED" } }, { new: true });
  if (!cancelled) { await reply(customer, "Sorry, this order can no longer be cancelled."); return true; }
  await reply(customer, `❌ Order Cancelled\n\nOrder: #${cancelled.orderId}\nProduct: ${cancelled.productName}\n\nYour order has been cancelled successfully.`); return true;
}
function paymentLinkPaymentStatus(paymentLink) {
  const payments = Array.isArray(paymentLink?.payments) ? paymentLink.payments : [];
  const successfulPayment = payments.find((payment) => payment?.status === "captured" || payment?.captured === true);
  const latestPayment = payments.at(-1);
  return successfulPayment ? "captured" : latestPayment?.status || (paymentLink?.status === "paid" ? "paid" : "not_paid");
}
function logRepayDecision(order, paymentLink, paymentStatus, action) {
  console.info("Razorpay REPAY decision", {
    orderId: order.orderId,
    paymentLinkId: paymentLink?.id || order.razorpayPaymentLinkId,
    paymentLinkStatus: paymentLink?.status,
    paymentStatus,
    action,
  });
}
async function sendCodOnlinePaymentLink(customer) {
  const latestOrder = await Order.findOne({ customerId: customer._id }).sort({ updatedAt: -1 });
  if (latestOrder?.paymentStatus === "PAID") { await reply(customer, `Payment for order #${latestOrder.orderId} is already completed.`); return true; }
  if (latestOrder?.orderStatus === "CANCELLED") { await reply(customer, `Order #${latestOrder.orderId} is cancelled, so an online payment link cannot be created.`); return true; }
  const order = await Order.findOne({ customerId: customer._id, paymentMethod: "COD", paymentStatus: "COD", orderStatus: "CONFIRMED" }).sort({ updatedAt: -1 });
  if (!order) { await reply(customer, "I could not find an eligible Cash on Delivery order to switch to online payment."); return true; }
  if (order.razorpayPaymentLinkId) {
    try {
      const existingLink = await fetchPaymentLink(order.razorpayPaymentLinkId);
      if (["created", "partially_paid"].includes(existingLink.status)) {
        const url = order.razorpayPaymentLinkUrl || order.paymentLinkUrl || existingLink.short_url;
        if (!url) { await reply(customer, "Your existing online payment link is active, but its URL could not be retrieved. Please contact support."); return true; }
        if (!order.razorpayPaymentLinkUrl) { order.razorpayPaymentLinkUrl = url; order.paymentLinkUrl = url; await order.save(); }
        await reply(customer, `You can pay online for your existing order.\n\nOrder: #${order.orderId}\nAmount: Rs.${order.totalAmount}/-\n\nPlease complete payment using this secure link:\n${url}`);
        return true;
      }
      if (existingLink.status === "paid") { await reply(customer, "Razorpay reports that this payment link has been paid. Your order is awaiting secure confirmation, so please do not make another payment."); return true; }
      if (!["expired", "cancelled"].includes(existingLink.status)) { await reply(customer, "Your existing payment link is still being processed. Please wait or contact support."); return true; }
      order.razorpayPaymentLinkId = undefined; order.razorpayPaymentLinkUrl = undefined; order.paymentLinkUrl = undefined; order.razorpayReferenceId = undefined; order.razorpayOrderId = undefined;
      await order.save();
    } catch (error) {
      await reply(customer, "I could not verify the existing payment link. Please try again shortly or contact support.");
      return true;
    }
  }
  try {
    const payment = await createPaymentLink(order);
    Object.assign(order, { razorpayPaymentLinkId: payment.id, razorpayPaymentLinkUrl: payment.short_url, paymentLinkUrl: payment.short_url, razorpayReferenceId: payment.reference_id });
    if (payment.razorpayOrderId) order.razorpayOrderId = payment.razorpayOrderId;
    await order.save();
    await reply(customer, `You can pay online for your existing order.\n\nOrder: #${order.orderId}\nAmount: Rs.${order.totalAmount}/-\n\nPlease complete payment using this secure link:\n${payment.short_url}`);
  } catch (error) {
    console.error("Could not create COD-to-online payment link:", error?.error?.description || error?.response?.data?.error?.description || error?.message);
    await reply(customer, "Online payment is temporarily unavailable. Your existing order remains Cash on Delivery.");
  }
  return true;
}
const fields = ["customerName", "houseBuilding", "area", "district", "pincode"];
const labels = { customerName: "Name", houseBuilding: "House/Building", area: "Area/Place", district: "District", pincode: "Pincode" };
const patterns = { customerName: /^[^a-z]*(?:name)\s*[:\-]\s*(.+)$/im, houseBuilding: /^[^a-z]*(?:house\s*\/\s*building|house|building)\s*[:\-]\s*(.+)$/im, area: /^[^a-z]*(?:area\s*\/\s*place|area|place)\s*[:\-]\s*(.+)$/im, district: /^[^a-z]*(?:district)\s*[:\-]\s*(.+)$/im, pincode: /^[^a-z]*(?:pincode|pin\s*code|pin)\s*[:\-]\s*(.+)$/im };
const deliveryForm = () => "📦 Please provide your delivery details:\n\n👤 Name:\n🏠 House/Building:\n📍 Area/Place:\n🏙️ District:\n📮 Pincode:\n\nPlease send your Name first. 😊";
const fieldByCursor = { NAME: "customerName", HOUSE_BUILDING: "houseBuilding", AREA: "area", DISTRICT: "district", PINCODE: "pincode" };
const cursorByField = { customerName: "NAME", houseBuilding: "HOUSE_BUILDING", area: "AREA", district: "DISTRICT", pincode: "PINCODE" };
function extractQuantity(text) {
  const match = String(text).match(/\b([1-9]\d*)\s*(?:x\s*)?[a-z][a-z\s-]{1,40}\b/i);
  const quantity = match ? Number(match[1]) : null;
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}
function parseForm(text) {
  const result = {};
  for (const [field, pattern] of Object.entries(patterns)) {
    const value = String(text).match(new RegExp(pattern.source, "im"))?.[1]?.trim().replace(/\s+/g, " ");
    if (value) result[field] = field === "pincode" ? value.replace(/\s/g, "") : value;
  }
  return result;
}
function missing(conversation) { return fields.filter((field) => !String(conversation[field] || "").trim() || (field === "pincode" && !/^\d{6}$/.test(conversation.pincode))); }
function valid(conversation, product) { return product && Number.isFinite(product.price) && product.price >= 0 && Number.isSafeInteger(conversation.quantity) && conversation.quantity > 0 && !missing(conversation).length && conversation.whatsappId && Number.isFinite(product.price * conversation.quantity); }
function clearActive(conversation) { ["selectedProductId", "selectedProductName", "selectedProductPrice", "quantity", "customerName", "houseBuilding", "area", "district", "address", "landmark", "pincode", "paymentMethod", "pendingOrderId"].forEach((key) => { conversation[key] = undefined; }); conversation.deliveryField = null; conversation.editingField = null; }
async function cancelActiveFlow(customer, conversation) {
  clearActive(conversation); conversation.status = "CANCELLED"; conversation.currentStep = "IDLE"; await conversation.save();
  await reply(customer, "Your order process has been cancelled. 😊\n\nYou can message me anytime if you'd like to order something.");
  return true;
}
async function handlePriorityIntent({ customer, conversation, text }) {
  if (isFlowCancellationIntent(text)) return cancelActiveFlow(customer, conversation);
  if (isProductChangeIntent(text)) {
    clearActive(conversation); conversation.status = "BOT_ACTIVE"; conversation.currentStep = "IDLE"; await conversation.save();
    return handleCatalog(customer);
  }
  if (isTrackingRequest(text)) return handleTracking(customer, text);
  return false;
}
async function handleOrderCreationError(customer, conversation, error) {
  if (error?.code !== "INSUFFICIENT_STOCK") throw error;
  conversation.currentStep = "AWAITING_CONFIRMATION"; await conversation.save();
  await reply(customer, `Sorry, the requested quantity is unavailable. Available stock: ${error.availableStock}.\n\nReply EDIT to change the quantity or NO to cancel.`);
  return true;
}
function nextMissingField(conversation) { return missing(conversation)[0] || null; }
async function promptForCurrentField(customer, conversation) {
  const field = nextMissingField(conversation);
  conversation.deliveryField = field ? cursorByField[field] : null;
  await conversation.save();
  if (field === "customerName") return reply(customer, "Please send your Name first. 😊");
  if (field === "houseBuilding") return reply(customer, `Thanks, ${conversation.customerName}! 😊\n\n🏠 Please provide your House/Building:`);
  if (field === "area") return reply(customer, "📍 Please provide your Area/Place:");
  if (field === "district") return reply(customer, "🏙️ Please provide your District:");
  return reply(customer, "📮 Please provide your Pincode:");
}
async function begin({ customer, conversation, product, quantity }) {
  clearActive(conversation);
  Object.assign(conversation, { customerId: customer._id, whatsappId: customer.whatsappId, status: "BOT_ACTIVE", currentStep: "AWAITING_DELIVERY_DETAILS", deliveryField: "NAME", selectedProductId: product.productId, selectedProductName: product.name, selectedProductPrice: product.price, quantity, paymentMethod: "COD" });
  await conversation.save();
  await reply(customer, `Sure! 😊\n\n✨ ${product.name}\n💰 ₹${product.price}/-\n${product.cod ? "🚚 Cash on Delivery Available" : "💳 Online Payment Available"}\n\n${deliveryForm()}`);
}
function summary(conversation, product, title = "Order Summary") {
  if (!valid(conversation, product)) return null;
  return `🧾 ${title}\n\n✨ Product: ${product.name}\n🔢 Quantity: ${conversation.quantity}\n💰 Price: ₹${product.price}/-\n💵 Total: ₹${product.price * conversation.quantity}/-\n\n👤 Name: ${conversation.customerName}\n📱 Mobile: ${conversation.whatsappId}\n\n🏠 House/Building: ${conversation.houseBuilding}\n📍 Area/Place: ${conversation.area}\n🏙️ District: ${conversation.district}\n📮 Pincode: ${conversation.pincode}\n\n💳 Payment: Cash on Delivery\n\nWould you like to confirm your order?\n\nReply:\n✅ YES — Confirm\n✏️ EDIT — Change details\n❌ NO — Cancel`;
}
const editMenu = () => "✏️ What would you like to change?\n\n1️⃣ Name\n2️⃣ House/Building\n3️⃣ Area/Place\n4️⃣ District\n5️⃣ Pincode\n6️⃣ Quantity\n\nReply with the number.";
const editOptions = { "1": "NAME", "2": "HOUSE_BUILDING", "3": "AREA", "4": "DISTRICT", "5": "PINCODE", "6": "QUANTITY" };
const editPrompts = { NAME: "👤 Please enter the new Name:", HOUSE_BUILDING: "🏠 Please enter the new House/Building:", AREA: "📍 Please enter the new Area/Place:", DISTRICT: "🏙️ Please enter the new District:", PINCODE: "📮 Please enter the new 6-digit Pincode:", QUANTITY: "🔢 Please enter the quantity:" };
async function handleDelivery({ customer, conversation, text }) {
  const input = {};
  const lines = String(text).split('\n').map(l => l.trim()).filter(l => l);
  const unconsumed = [];

  for (let line of lines) {
    let matched = false;
    for (const [field, pattern] of Object.entries(patterns)) {
      const match = line.match(new RegExp(pattern.source, "i"));
      if (match) {
        const value = match[1].trim().replace(/\s+/g, " ");
        input[field] = field === "pincode" ? value.replace(/\s/g, "") : value;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const pinRegex = /(?:^|[^\d])(\d(?:\s*\d){5})(?:[^\d]|$)/;
      const pinMatch = line.match(pinRegex);
      if (pinMatch) {
        input.pincode = pinMatch[1].replace(/\s/g, "");
        line = line.replace(pinMatch[1], "").trim();
      }
      if (line) {
        unconsumed.push(line);
      }
    }
  }

  const currentField = fieldByCursor[conversation.deliveryField];
  
  const remainingFields = [];
  let foundCurrent = false;
  for (const f of fields) {
    if (f === currentField) foundCurrent = true;
    if (foundCurrent && !input[f] && !conversation[f]) remainingFields.push(f);
  }

  if (unconsumed.length > 0) {
    if (unconsumed.length === remainingFields.length) {
      unconsumed.forEach((line, i) => {
        input[remainingFields[i]] = line.replace(/\s+/g, " ");
      });
    } else if (currentField && !input[currentField]) {
      input[currentField] = unconsumed[0].replace(/\s+/g, " ");
    }
  }
  Object.assign(conversation, input);
  if (conversation.houseBuilding && conversation.area && conversation.district && /^\d{6}$/.test(conversation.pincode || "")) conversation.address = [conversation.houseBuilding, conversation.area, conversation.district, conversation.pincode].join(", ");
  const product = await Product.findOne({ productId: conversation.selectedProductId, ...availableProductFilter }).lean();
  if (!product) { conversation.status = "CANCELLED"; conversation.currentStep = "IDLE"; await conversation.save(); await reply(customer, "Sorry, that product is no longer available. Your order process has been cancelled."); return true; }
  const absent = missing(conversation);
  if (absent.length) {
    conversation.currentStep = "AWAITING_DELIVERY_DETAILS"; await conversation.save();
    if (absent.includes("pincode") && input.pincode && !/^\d{6}$/.test(input.pincode)) { conversation.deliveryField = "PINCODE"; await conversation.save(); await reply(customer, "📮 Please enter a valid 6-digit pincode."); }
    else await promptForCurrentField(customer, conversation);
    return true;
  }
  await Customer.updateOne({ _id: customer._id }, { $set: { name: conversation.customerName, houseBuilding: conversation.houseBuilding, area: conversation.area, district: conversation.district, address: conversation.address, pincode: conversation.pincode } });
  const orderSummary = summary(conversation, product);
  if (!orderSummary) { await reply(customer, deliveryForm()); return true; }
  conversation.deliveryField = null; conversation.currentStep = "AWAITING_CONFIRMATION"; await conversation.save(); await reply(customer, orderSummary); return true;
}
async function showUpdatedSummary(customer, conversation) {
  const product = await Product.findOne({ productId: conversation.selectedProductId, ...availableProductFilter }).lean();
  const orderSummary = summary(conversation, product, "Updated Order Summary");
  if (!orderSummary) { await reply(customer, "Please complete the required order details before confirming."); return false; }
  conversation.editingField = null; conversation.currentStep = "AWAITING_CONFIRMATION"; await conversation.save(); await reply(customer, orderSummary); return true;
}
async function handleEditValue({ customer, conversation, text }) {
  if (isNo(text)) { clearActive(conversation); conversation.status = "CANCELLED"; conversation.currentStep = "IDLE"; await conversation.save(); await reply(customer, "Your order process has been cancelled. 😊\n\nYou can message me anytime if you'd like to order something."); return true; }
  if (isEdit(text)) { conversation.editingField = null; conversation.currentStep = "AWAITING_EDIT_SELECTION"; await conversation.save(); await reply(customer, editMenu()); return true; }
  if (isYes(text)) { await reply(customer, editPrompts[conversation.editingField] || "Please enter the required value."); return true; }
  const value = text.trim().replace(/\s+/g, " ");
  const field = conversation.editingField;
  if (!field || !editPrompts[field]) { conversation.currentStep = "AWAITING_EDIT_SELECTION"; conversation.editingField = null; await conversation.save(); await reply(customer, editMenu()); return true; }
  if (field === "PINCODE" && !/^\d{6}$/.test(value)) { await reply(customer, "📮 Please enter a valid 6-digit pincode."); return true; }
  if (field === "QUANTITY" && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)) { await reply(customer, "Please enter a valid quantity greater than 0."); return true; }
  if (field !== "PINCODE" && field !== "QUANTITY" && !value) { await reply(customer, editPrompts[field]); return true; }
  const target = field === "NAME" ? "customerName" : field === "HOUSE_BUILDING" ? "houseBuilding" : field === "AREA" ? "area" : field === "DISTRICT" ? "district" : field === "PINCODE" ? "pincode" : "quantity";
  conversation[target] = field === "QUANTITY" ? Number(value) : value;
  conversation.address = [conversation.houseBuilding, conversation.area, conversation.district, conversation.pincode].join(", ");
  await Customer.updateOne({ _id: customer._id }, { $set: { name: conversation.customerName, houseBuilding: conversation.houseBuilding, area: conversation.area, district: conversation.district, address: conversation.address, pincode: conversation.pincode } });
  return showUpdatedSummary(customer, conversation);
}
async function handleStep({ customer, conversation, text }) {
  if (await handlePriorityIntent({ customer, conversation, text })) return true;
  if (conversation.currentStep === "IDLE" && conversation.selectedProductId) {
    if (isViewedProductOrderIntent(text)) return beginViewedProductOrder(customer, conversation);
    if (isNo(text)) { clearViewedProduct(conversation); await conversation.save(); await reply(customer, "No problem. Let me know if you would like to see another product."); return true; }
  }
  const requestedProduct = isNewOrder(text) ? await findRelevantProduct(text) : null;
  if (requestedProduct && conversation.currentStep !== "AWAITING_PAYMENT_VERIFICATION") { await begin({ customer, conversation, product: requestedProduct, quantity: extractQuantity(text) || 1 }); return true; }
  if (conversation.currentStep === "AWAITING_QUANTITY") { 
    // AWAITING_QUANTITY is a legacy state; fresh catalog/product intents must not be consumed as quantity when the legacy state is stale.
    const numericMatch = text.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const position = parseInt(numericMatch[1], 10);
      const available = await getAvailableProducts();
      if (position > 0 && position <= available.length) return false;
    }
    conversation.quantity = /^\s*[1-9]\d*\s*$/.test(text) ? Number(text.trim()) : 1; 
    conversation.currentStep = "AWAITING_DELIVERY_DETAILS"; 
    conversation.deliveryField = "NAME"; 
    await conversation.save(); 
    await reply(customer, deliveryForm()); 
    return true; 
  }
  if (conversation.currentStep === "AWAITING_NAME") { conversation.currentStep = "AWAITING_DELIVERY_DETAILS"; conversation.deliveryField = "NAME"; return handleDelivery({ customer, conversation, text }); }
  if (["AWAITING_ADDRESS", "AWAITING_LANDMARK", "AWAITING_PINCODE"].includes(conversation.currentStep)) { const legacyStep = conversation.currentStep; conversation.currentStep = "AWAITING_DELIVERY_DETAILS"; conversation.deliveryField = legacyStep === "AWAITING_PINCODE" ? "PINCODE" : "HOUSE_BUILDING"; return handleDelivery({ customer, conversation, text }); }
  if (["AWAITING_ADDRESS", "AWAITING_LANDMARK", "AWAITING_PINCODE", "AWAITING_DELIVERY_DETAILS"].includes(conversation.currentStep)) return handleDelivery({ customer, conversation, text });
  if (conversation.currentStep === "AWAITING_PAYMENT_VERIFICATION") {
    if (isPaymentStatusQuestion(text)) {
      await reply(customer, "Your payment is still being verified. Your order will be confirmed automatically after Razorpay sends verified payment confirmation.");
      return true;
    }
    if (!isPaymentRetryRequest(text)) return false;
    const order = conversation.pendingOrderId ? await Order.findById(conversation.pendingOrderId) : null;
    if (!order) { await reply(customer, "I could not find the pending payment request. Please contact support for help with this order."); return true; }
    if (order.paymentStatus === "PAID" || order.orderStatus === "CONFIRMED") { logRepayDecision(order, null, order.paymentStatus, "already_confirmed"); await reply(customer, "Your payment is already confirmed. No further payment is needed."); return true; }
    const existingUrl = order.razorpayPaymentLinkUrl || order.paymentLinkUrl;
    if (order.razorpayPaymentLinkId) {
      try {
        const paymentLink = await fetchPaymentLink(order.razorpayPaymentLinkId);
        const paymentStatus = paymentLinkPaymentStatus(paymentLink);
        if (paymentLink.status === "paid" || paymentStatus === "captured") {
          logRepayDecision(order, paymentLink, paymentStatus, "awaiting_verified_webhook");
          await reply(customer, "Razorpay reports this payment link as paid. Your order is awaiting secure webhook confirmation, so please do not repay.");
          return true;
        }
        if (["created", "partially_paid"].includes(paymentLink.status)) {
          const usableUrl = existingUrl || paymentLink.short_url;
          if (!usableUrl) { await reply(customer, "Your existing payment link is active, but its URL could not be retrieved. Please contact support."); return true; }
          if (!existingUrl && paymentLink.short_url) { order.razorpayPaymentLinkUrl = paymentLink.short_url; order.paymentLinkUrl = paymentLink.short_url; await order.save(); }
          logRepayDecision(order, paymentLink, paymentStatus, "reused_existing_link");
          await reply(customer, `Your existing payment link is still active. Please use it to complete payment:\n${usableUrl}`);
          return true;
        }
        if (!["expired", "cancelled"].includes(paymentLink.status)) {
          logRepayDecision(order, paymentLink, paymentStatus, "no_replacement_while_status_unclear");
          await reply(customer, "Your payment link is still being processed. Please wait for Razorpay verification or contact support.");
          return true;
        }
      } catch (error) {
        logRepayDecision(order, null, "unknown", "link_fetch_failed_no_replacement");
        await reply(customer, "I could not verify the existing payment link. Please try again shortly or contact support.");
        return true;
      }
    }
    // A verified expired/cancelled link is no longer usable. Clear only its payment-link
    // identifiers so the service creates one replacement with a fresh reference ID.
    order.razorpayPaymentLinkId = undefined;
    order.razorpayPaymentLinkUrl = undefined;
    order.paymentLinkUrl = undefined;
    order.razorpayReferenceId = undefined;
    order.razorpayOrderId = undefined;
    await order.save();
    try {
      const payment = await createPaymentLink(order);
      Object.assign(order, { razorpayPaymentLinkId: payment.id, razorpayPaymentLinkUrl: payment.short_url, paymentLinkUrl: payment.short_url, razorpayReferenceId: payment.reference_id });
      if (payment.razorpayOrderId) order.razorpayOrderId = payment.razorpayOrderId;
      await order.save();
      logRepayDecision(order, null, "not_paid", "created_replacement_link");
      await reply(customer, `Here is your new secure payment link:\n${payment.short_url}\n\nYour order will be confirmed automatically after verified payment.`);
    } catch (error) {
      console.error("Could not replace Razorpay payment link:", error?.error?.description || error?.response?.data?.error?.description || error?.message);
      await reply(customer, "I could not create a new payment link right now. Please try again shortly or contact support.");
    }
    return true;
  }
  if (conversation.currentStep === "AWAITING_PAYMENT_METHOD") {
    const method = norm(text);
    if (method !== "cod" && method !== "online") { await reply(customer, "Please reply COD or ONLINE."); return true; }
    // An existing checkout already reserved its stock, so it must remain
    // completable even when that reservation brought available stock to zero.
    const product = await Product.findOne({ productId: conversation.selectedProductId, isActive: { $ne: false } }).lean();
    if (!valid(conversation, product)) { conversation.currentStep = "AWAITING_DELIVERY_DETAILS"; await promptForCurrentField(customer, conversation); return true; }
    if (method === "cod" && !product.cod) { await reply(customer, `Cash on Delivery is not available for ${product.name}. Please reply ONLINE to continue.`); return true; }
    if (method === "cod") {
      let existingOrder = conversation.pendingOrderId ? await Order.findById(conversation.pendingOrderId) : null;
      if (!existingOrder) {
        existingOrder = await Order.findOne({ customerId: customer._id, productId: product.productId, quantity: conversation.quantity, paymentMethod: "ONLINE", paymentStatus: { $in: ["PENDING", "FAILED"] }, orderStatus: "PENDING" }).sort({ updatedAt: -1 });
      }
      if (existingOrder && String(existingOrder.customerId) === String(customer._id) && existingOrder.productId === product.productId && existingOrder.quantity === conversation.quantity) {
        if (existingOrder.paymentStatus === "PAID") { await reply(customer, `Payment for order #${existingOrder.orderId} is already confirmed. No further payment method change is needed.`); return true; }
        if (existingOrder.paymentMethod === "ONLINE" && ["PENDING", "FAILED"].includes(existingOrder.paymentStatus) && existingOrder.orderStatus === "PENDING") {
          const order = await Order.findOneAndUpdate(
            { _id: existingOrder._id, customerId: customer._id, productId: product.productId, quantity: conversation.quantity, paymentMethod: "ONLINE", paymentStatus: { $in: ["PENDING", "FAILED"] }, orderStatus: "PENDING" },
            { $set: { paymentMethod: "COD", paymentStatus: "COD", orderStatus: "CONFIRMED" }, $unset: { razorpayOrderId: 1, razorpayPaymentId: 1, razorpayPaymentLinkId: 1, razorpayPaymentLinkUrl: 1, razorpayReferenceId: 1, paymentLinkUrl: 1 } },
            { new: true }
          );
          if (order) {
            conversation.status = "COMPLETED"; conversation.currentStep = "IDLE"; await conversation.save();
            await Customer.updateOne({ _id: customer._id }, { $inc: { totalOrders: 1, totalSpent: order.totalAmount } });
            await reply(customer, `Your order has been confirmed!\n\n${order.productName}\nPrice: Rs.${order.price}/-\nPayment: Cash on Delivery\n\nThank you for your order, ${conversation.customerName}!`);
            return true;
          }
          const latestOrder = await Order.findById(existingOrder._id);
          if (latestOrder?.paymentStatus === "PAID") { await reply(customer, `Payment for order #${latestOrder.orderId} is already confirmed. No further payment method change is needed.`); return true; }
          await reply(customer, "I could not safely switch the existing order to Cash on Delivery. Please try again shortly."); return true;
        }
      }
      let order;
      try { order = await createOrder({ customer, conversation, product, paymentMethod: "COD", paymentStatus: "COD", orderStatus: "CONFIRMED" }); }
      catch (error) { return handleOrderCreationError(customer, conversation, error); }
      conversation.status = "COMPLETED"; conversation.currentStep = "IDLE"; await conversation.save();
      await Customer.updateOne({ _id: customer._id }, { $inc: { totalOrders: 1, totalSpent: order.totalAmount } });
      await reply(customer, `Your order has been confirmed!\n\n${product.name}\nPrice: Rs.${product.price}/-\nPayment: Cash on Delivery\n\nThank you for your order, ${conversation.customerName}!`);
      return true;
    }
    let order = conversation.pendingOrderId ? await Order.findById(conversation.pendingOrderId) : null;
    if (!order) {
      order = await Order.findOne({ customerId: customer._id, productId: product.productId, quantity: conversation.quantity, paymentMethod: "ONLINE", paymentStatus: { $in: ["PENDING", "FAILED"] }, orderStatus: "PENDING" }).sort({ updatedAt: -1 });
    }
    if (!order) {
      try { order = await createOrder({ customer, conversation, product, paymentMethod: "ONLINE", paymentStatus: "PENDING", orderStatus: "PENDING" }); }
      catch (error) { return handleOrderCreationError(customer, conversation, error); }
      conversation.pendingOrderId = order._id; await conversation.save();
    } else if (!conversation.pendingOrderId || conversation.pendingOrderId.toString() !== order._id.toString()) {
      conversation.pendingOrderId = order._id; await conversation.save();
    }
    if (!(order.razorpayPaymentLinkUrl || order.paymentLinkUrl)) {
      try {
        const payment = await createPaymentLink(order);
        Object.assign(order, { razorpayPaymentLinkId: payment.id, razorpayPaymentLinkUrl: payment.short_url, paymentLinkUrl: payment.short_url, razorpayReferenceId: payment.reference_id });
        if (payment.razorpayOrderId) order.razorpayOrderId = payment.razorpayOrderId;
        await order.save();
      } catch (error) {
        conversation.currentStep = "AWAITING_PAYMENT_METHOD"; await conversation.save();
        console.error("Could not create Razorpay payment link:", error?.error?.description || error?.response?.data?.error?.description || error?.message);
        await reply(customer, "Online payment is temporarily unavailable. Please reply COD to place this order with Cash on Delivery, or try ONLINE again later.");
        return true;
      }
    }
    conversation.paymentMethod = "ONLINE"; conversation.currentStep = "AWAITING_PAYMENT_VERIFICATION"; await conversation.save();
    const paymentLinkUrl = order.razorpayPaymentLinkUrl || order.paymentLinkUrl;
    await reply(customer, `Online Payment\n\nOrder Total: Rs.${order.totalAmount}/-\n\nPlease complete your payment using this secure link:\n${paymentLinkUrl}\n\nAfter successful payment, your order will be confirmed automatically.`);
    return true;
  }
  if (conversation.currentStep === "AWAITING_EDIT_SELECTION") {
    if (isNo(text)) { clearActive(conversation); conversation.status = "CANCELLED"; conversation.currentStep = "IDLE"; await conversation.save(); await reply(customer, "Your order process has been cancelled. 😊\n\nYou can message me anytime if you'd like to order something."); return true; }
    if (isEdit(text)) { await reply(customer, editMenu()); return true; }
    const selected = editOptions[norm(text)];
    if (!selected) { await reply(customer, "Please reply with a number from 1 to 6."); return true; }
    conversation.editingField = selected; conversation.currentStep = "AWAITING_EDIT_VALUE"; await conversation.save(); await reply(customer, editPrompts[selected]); return true;
  }
  if (conversation.currentStep === "AWAITING_EDIT_VALUE") return handleEditValue({ customer, conversation, text });
  if (conversation.currentStep !== "AWAITING_CONFIRMATION") return false;
  if (isNo(text)) { clearActive(conversation); conversation.status = "CANCELLED"; conversation.currentStep = "IDLE"; await conversation.save(); await reply(customer, "Your order process has been cancelled. 😊\n\nYou can message me anytime if you'd like to order something."); return true; }
  if (isEdit(text)) { conversation.currentStep = "AWAITING_EDIT_SELECTION"; conversation.editingField = null; await conversation.save(); await reply(customer, editMenu()); return true; }
  if (!isYes(text)) { await reply(customer, "Please reply YES to confirm your order or NO to cancel. You can also tell me a different product to start a new order."); return true; }
  const product = await Product.findOne({ productId: conversation.selectedProductId, ...availableProductFilter }).lean();
  if (!product) { conversation.status = "CANCELLED"; conversation.currentStep = "IDLE"; await conversation.save(); await reply(customer, "Sorry, that product is no longer available. Your order process has been cancelled."); return true; }
  if (!valid(conversation, product)) { conversation.currentStep = "AWAITING_DELIVERY_DETAILS"; await promptForCurrentField(customer, conversation); return true; }
  conversation.currentStep = "AWAITING_PAYMENT_METHOD"; await conversation.save();
  await reply(customer, product.cod ? "Payment Method\n\n1. Cash on Delivery\n2. Online Payment\n\nPlease reply:\nCOD\nor\nONLINE" : "Payment Method\n\nOnline Payment is available for this product.\n\nPlease reply:\nONLINE");
  return true;
}
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== "text" || !message.text?.body) return res.sendStatus(200);
    const from = message.from; const userMessage = message.text.body;
    const customer = await Customer.findOneAndUpdate({ whatsappId: from }, { $setOnInsert: { whatsappId: from, phone: from, totalOrders: 0, totalSpent: 0 } }, { new: true, upsert: true });
    try { await Message.create({ whatsappMessageId: message.id, whatsappId: from, customerId: customer._id, direction: "INCOMING", message: userMessage, messageType: "text" }); } catch (error) { if (error?.code === 11000) return res.sendStatus(200); throw error; }
    let conversation = await Conversation.findOne({ whatsappId: from, status: { $in: ["BOT_ACTIVE", "HUMAN_REQUIRED"] } }).sort({ updatedAt: -1 });
    if (conversation?.status === "HUMAN_REQUIRED") return res.sendStatus(200);
    if (!conversation && (isOrderCancellationRequest(userMessage) || isCancel(userMessage))) { await handleOrderCancellation(customer, userMessage); return res.sendStatus(200); }
    if (!conversation && (isTrackingRequest(userMessage) || orderIdFromText(userMessage))) { await handleTracking(customer, userMessage); return res.sendStatus(200); }
    if (conversation && await handleStep({ customer, conversation, text: userMessage })) return res.sendStatus(200);
    if (isOnlinePaymentRequest(userMessage)) { await sendCodOnlinePaymentLink(customer); return res.sendStatus(200); }
    if (isCodPaymentRequest(userMessage)) {
      const codOrder = await Order.findOne({ customerId: customer._id, paymentMethod: "COD", paymentStatus: "COD", orderStatus: "CONFIRMED" }).sort({ updatedAt: -1 });
      if (codOrder) { await reply(customer, `Your order #${codOrder.orderId} remains Cash on Delivery unless an online payment is verified.`); return res.sendStatus(200); }
    }
    if (isHuman(userMessage)) { await Conversation.findOneAndUpdate({ whatsappId: from, status: "BOT_ACTIVE" }, { $set: { status: "HUMAN_REQUIRED", currentStep: "IDLE", customerId: customer._id, whatsappId: from } }, { new: true, upsert: true }); await reply(customer, "Sure! 👨‍💼 I'll connect you with our support team."); return res.sendStatus(200); }
    if (isGreeting(userMessage)) { await reply(customer, "Hi! 😊 Welcome to our store. How can I help you today?"); return res.sendStatus(200); }
    const requestedCategory = getRequestedCategory(userMessage);
    if (requestedCategory) { await handleCatalog(customer, requestedCategory); return res.sendStatus(200); }
    if (isGenericCatalogRequest(userMessage)) { await handleCatalog(customer); return res.sendStatus(200); }
    const numericMatch = userMessage.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const position = parseInt(numericMatch[1], 10);
      if (position > 0) {
        const available = await getAvailableProducts();
        if (position <= available.length) {
          const product = available[position - 1];
          conversation = await Conversation.findOneAndUpdate({ whatsappId: from, status: "BOT_ACTIVE", currentStep: "IDLE" }, { $set: { customerId: customer._id, whatsappId: from, status: "BOT_ACTIVE", currentStep: "IDLE" } }, { new: true, upsert: true });
          await begin({ customer, conversation, product, quantity: 1 });
          return res.sendStatus(200);
        } else {
          await reply(customer, "Sorry, that is an invalid option. Please select a valid product number from the catalogue.");
          return res.sendStatus(200);
        }
      }
    }
    const product = await findRelevantProduct(userMessage);
    if (product && isOrder(userMessage)) { conversation = await Conversation.findOneAndUpdate({ whatsappId: from, status: "BOT_ACTIVE", currentStep: "IDLE" }, { $set: { customerId: customer._id, whatsappId: from, status: "BOT_ACTIVE", currentStep: "IDLE" } }, { new: true, upsert: true }); await begin({ customer, conversation, product, quantity: extractQuantity(userMessage) || 1 }); return res.sendStatus(200); }
    if (product) { conversation = await Conversation.findOneAndUpdate({ whatsappId: from, status: "BOT_ACTIVE", currentStep: "IDLE" }, { $set: { customerId: customer._id, whatsappId: from, status: "BOT_ACTIVE", currentStep: "IDLE", selectedProductId: product.productId, selectedProductName: product.name, selectedProductPrice: product.price } }, { new: true, upsert: true }); await reply(customer, productDetailsText(product)); return res.sendStatus(200); }
    await reply(customer, await getGeminiReply(userMessage, product ? [product] : []));
  } catch (error) { console.error("Webhook processing error:", error.message); }
  return res.sendStatus(200);
});
app.use((error, _req, res, _next) => { console.error("Unhandled request error:", error.message); if (res.headersSent) return; return res.status(500).json({ success: false, message: "Internal server error" }); });

let server;
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`${signal} received; shutting down gracefully.`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.close();
  process.exit(0);
}
async function start() { try { await connectDatabase(); server = app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`)); } catch (error) { console.error("Server could not start:", error.message); process.exit(1); } }
process.once("SIGTERM", () => { shutdown("SIGTERM").catch((error) => { console.error("Graceful shutdown error:", error.message); process.exit(1); }); });
process.once("SIGINT", () => { shutdown("SIGINT").catch((error) => { console.error("Graceful shutdown error:", error.message); process.exit(1); }); });
start();
