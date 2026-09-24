const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Customer = require("../models/Customer");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { sendWhatsAppText } = require("../services/whatsappService");
const { canTransition, deliveryEstimateDate, formatDate } = require("../services/orderLifecycleService");
const { requireAdmin, publicAdmin } = require("../middleware/adminAuth");

const router = express.Router();
const ORDER_STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
const CONVERSATION_STATUSES = ["BOT_ACTIVE", "HUMAN_REQUIRED", "RESOLVED", "COMPLETED", "CANCELLED"];
const MANAGEABLE_CONVERSATION_STATUSES = ["BOT_ACTIVE", "HUMAN_REQUIRED"];
const SUPPORT_STATUSES = ["BOT_ACTIVE", "HUMAN_REQUIRED", "RESOLVED"];
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
const safeOrder = (order) => order.toObject ? order.toObject() : order;
const PRODUCT_FIELDS = ["name", "description", "price", "category", "stock", "cod", "image", "isActive"];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function productUpdates(body) {
  const update = {};
  for (const field of PRODUCT_FIELDS) if (Object.prototype.hasOwnProperty.call(body || {}, field)) update[field] = body[field];
  if (Object.prototype.hasOwnProperty.call(update, "name")) update.name = String(update.name || "").trim();
  if (Object.prototype.hasOwnProperty.call(update, "category")) update.category = String(update.category || "").trim();
  if (Object.prototype.hasOwnProperty.call(update, "description")) update.description = String(update.description || "").trim();
  if (Object.prototype.hasOwnProperty.call(update, "price")) update.price = Number(update.price);
  if (Object.prototype.hasOwnProperty.call(update, "stock")) update.stock = Number(update.stock);
  if (Object.prototype.hasOwnProperty.call(update, "cod")) update.cod = update.cod === true;
  if (Object.prototype.hasOwnProperty.call(update, "isActive")) update.isActive = update.isActive === true;
  if (Object.prototype.hasOwnProperty.call(update, "image")) update.image = String(update.image || "").trim();
  if (!update.name && Object.prototype.hasOwnProperty.call(update, "name")) throw new Error("Product name is required");
  if (!update.category && Object.prototype.hasOwnProperty.call(update, "category")) throw new Error("Category is required");
  if (Object.prototype.hasOwnProperty.call(update, "price") && (!Number.isFinite(update.price) || update.price <= 0)) throw new Error("Price must be a positive number");
  if (Object.prototype.hasOwnProperty.call(update, "stock") && (!Number.isSafeInteger(update.stock) || update.stock < 0)) throw new Error("Stock must be a non-negative integer");
  if (update.image && !/^https?:\/\//i.test(update.image) && !/^\/[\w./-]+$/.test(update.image)) throw new Error("Image must be a valid URL or local image path");
  return update;
}

function analyticsDateRange(query) {
  const dateFromInput = query.from;
  const dateToInput = query.to;
  let from;
  let toExclusive;
  let range = query.range || "30d";
  if (dateFromInput || dateToInput) {
    if (!dateFromInput || !dateToInput || !/^\d{4}-\d{2}-\d{2}$/.test(dateFromInput) || !/^\d{4}-\d{2}-\d{2}$/.test(dateToInput)) throw new Error("Custom dates must use YYYY-MM-DD for both from and to");
    from = new Date(`${dateFromInput}T00:00:00.000Z`);
    const inclusiveTo = new Date(`${dateToInput}T00:00:00.000Z`);
    if (Number.isNaN(from.valueOf()) || Number.isNaN(inclusiveTo.valueOf()) || from.toISOString().slice(0, 10) !== dateFromInput || inclusiveTo.toISOString().slice(0, 10) !== dateToInput || inclusiveTo < from) throw new Error("Invalid custom date range");
    toExclusive = new Date(inclusiveTo); toExclusive.setUTCDate(toExclusive.getUTCDate() + 1); range = "custom";
  } else {
    if (!Object.prototype.hasOwnProperty.call(RANGE_DAYS, range)) throw new Error("Range must be 7d, 30d, 90d, or 1y");
    toExclusive = new Date(); toExclusive.setUTCHours(0, 0, 0, 0); toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
    from = new Date(toExclusive); from.setUTCDate(from.getUTCDate() - RANGE_DAYS[range]);
  }
  return { range, from, toExclusive, groupFormat: range === "1y" ? "%Y-%m" : "%Y-%m-%d" };
}

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password || !process.env.JWT_SECRET) return res.status(401).json({ success: false, message: "Invalid email or password" });
    const admin = await Admin.findOne({ email }).select("+passwordHash");
    if (!admin || !admin.isActive || !(await bcrypt.compare(password, admin.passwordHash))) return res.status(401).json({ success: false, message: "Invalid email or password" });
    admin.lastLoginAt = new Date(); await admin.save();
    const token = jwt.sign({ adminId: String(admin._id), role: admin.role }, process.env.JWT_SECRET, { expiresIn: "8h" });
    return res.json({ success: true, token, admin: publicAdmin(admin) });
  } catch (error) { console.error("Admin login error:", error.message); return res.status(500).json({ success: false, message: "Unable to sign in" }); }
});

router.use(requireAdmin);
router.get("/me", (req, res) => res.json({ success: true, admin: publicAdmin(req.admin) }));

router.get("/customers", async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const search = req.query.search?.trim();
    const match = search ? { $or: [{ name: new RegExp(escapeRegex(search), "i") }, { whatsappId: new RegExp(escapeRegex(search), "i") }, { phone: new RegExp(escapeRegex(search), "i") }] } : {};
    const pipeline = [
      { $match: match },
      { $sort: { updatedAt: -1 } },
      { $facet: { customers: [
        { $skip: (page - 1) * limit }, { $limit: limit },
        { $lookup: { from: "orders", let: { customerId: "$_id" }, pipeline: [{ $match: { $expr: { $eq: ["$customerId", "$$customerId"] } } }, { $sort: { createdAt: -1 } }, { $group: { _id: null, orderCount: { $sum: 1 }, totalPaid: { $sum: { $cond: [{ $eq: ["$paymentStatus", "PAID"] }, "$totalAmount", 0] } }, latestOrder: { $first: "$orderId" } } }], as: "orderStats" } },
        { $project: { name: 1, whatsappId: 1, phone: 1, createdAt: 1, updatedAt: 1, stats: { $ifNull: [{ $arrayElemAt: ["$orderStats", 0] }, { orderCount: 0, totalPaid: 0, latestOrder: null }] } } },
      ], total: [{ $count: "value" }] } },
    ];
    const [result] = await Customer.aggregate(pipeline);
    const total = result.total[0]?.value || 0;
    return res.json({ success: true, customers: result.customers.map((customer) => ({ ...customer, orderCount: customer.stats.orderCount, totalPaid: customer.stats.totalPaid, latestOrder: customer.stats.latestOrder })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { console.error("Admin customers error:", error.message); return res.status(500).json({ success: false, message: "Unable to load customers" }); }
});

router.get("/customers/:id", async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).select("name whatsappId phone totalOrders totalSpent createdAt updatedAt").lean();
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });
    const [orders, paid, conversation] = await Promise.all([
      Order.find({ customerId: customer._id }).sort({ createdAt: -1 }).select("orderId productName quantity price totalAmount paymentMethod paymentStatus orderStatus createdAt updatedAt").lean(),
      Order.aggregate([{ $match: { customerId: customer._id, paymentStatus: "PAID" } }, { $group: { _id: null, total: { $sum: "$totalAmount" } } }]),
      Conversation.findOne({ customerId: customer._id }).sort({ updatedAt: -1 }).select("status currentStep pendingOrderId updatedAt createdAt").lean(),
    ]);
    return res.json({ success: true, customer: { ...customer, orderCount: orders.length, totalPaid: paid[0]?.total || 0, latestOrder: orders[0] || null, conversation: conversation ? { id: String(conversation._id), status: conversation.status, currentStep: conversation.currentStep, updatedAt: conversation.updatedAt } : null }, orders });
  } catch (_) { return res.status(404).json({ success: false, message: "Customer not found" }); }
});

router.get("/conversations", async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const match = req.query.status && CONVERSATION_STATUSES.includes(req.query.status) ? { status: req.query.status } : {};
    const search = req.query.search?.trim();
    const pipeline = [
      { $match: match }, { $sort: { updatedAt: -1 } },
      { $lookup: { from: "customers", localField: "customerId", foreignField: "_id", as: "customer" } }, { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
      ...(search ? [{ $match: { $or: [{ "customer.name": new RegExp(escapeRegex(search), "i") }, { whatsappId: new RegExp(escapeRegex(search), "i") }, { "customer.phone": new RegExp(escapeRegex(search), "i") }] } }] : []),
      { $facet: { conversations: [
        { $skip: (page - 1) * limit }, { $limit: limit },
        { $lookup: { from: "messages", let: { customerId: "$customerId", whatsappId: "$whatsappId" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$customerId", "$$customerId"] }, { $eq: ["$whatsappId", "$$whatsappId"] }] } } }, { $sort: { createdAt: -1 } }, { $limit: 1 }, { $project: { message: 1, direction: 1, createdAt: 1 } }], as: "lastMessage" } },
        { $project: { whatsappId: 1, status: 1, currentStep: 1, updatedAt: 1, customer: { id: "$customer._id", name: "$customer.name", phone: "$customer.phone" }, lastMessage: { $arrayElemAt: ["$lastMessage", 0] } } },
      ], total: [{ $count: "value" }] } },
    ];
    const [result] = await Conversation.aggregate(pipeline);
    const total = result.total[0]?.value || 0;
    return res.json({ success: true, conversations: result.conversations, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { console.error("Admin conversations error:", error.message); return res.status(500).json({ success: false, message: "Unable to load conversations" }); }
});

router.get("/conversations/:id", async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id).select("customerId whatsappId status currentStep deliveryField editingField pendingOrderId selectedProductId selectedProductName selectedProductPrice quantity paymentMethod createdAt updatedAt").lean();
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found" });
    const [customer, messages, order] = await Promise.all([
      Customer.findById(conversation.customerId).select("name whatsappId phone createdAt updatedAt").lean(),
      Message.find({ customerId: conversation.customerId, whatsappId: conversation.whatsappId }).sort({ createdAt: 1 }).select("direction message messageType createdAt").lean(),
      conversation.pendingOrderId ? Order.findById(conversation.pendingOrderId).select("orderId productName quantity totalAmount paymentMethod paymentStatus orderStatus").lean() : null,
    ]);
    return res.json({ success: true, conversation, customer: customer ? { id: String(customer._id), name: customer.name, whatsappId: customer.whatsappId, phone: customer.phone } : null, messages, order });
  } catch (_) { return res.status(404).json({ success: false, message: "Conversation not found" }); }
});

router.patch("/conversations/:id/status", async (req, res) => {
  const status = req.body?.status;
  if (!MANAGEABLE_CONVERSATION_STATUSES.includes(status)) return res.status(400).json({ success: false, message: "Status must be BOT_ACTIVE or HUMAN_REQUIRED" });
  try {
    const conversation = await Conversation.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true, runValidators: true }).select("status currentStep updatedAt");
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found" });
    return res.json({ success: true, conversation });
  } catch (_) { return res.status(404).json({ success: false, message: "Conversation not found" }); }
});

router.get("/support/stats", async (_req, res) => {
  try {
    const stats = await Conversation.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    const counts = Object.fromEntries(stats.map((item) => [item._id, item.count]));
    return res.json({ success: true, stats: { totalConversations: stats.reduce((total, item) => total + item.count, 0), humanRequired: counts.HUMAN_REQUIRED || 0, botActive: counts.BOT_ACTIVE || 0, resolved: counts.RESOLVED || 0, requiringAttention: counts.HUMAN_REQUIRED || 0 } });
  } catch (error) { console.error("Support stats error:", error.message); return res.status(500).json({ success: false, message: "Unable to load support statistics" }); }
});

router.get("/support/conversations", async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const status = req.query.status;
    if (status && !SUPPORT_STATUSES.includes(status)) return res.status(400).json({ success: false, message: "Invalid support status filter" });
    const baseMatch = status ? { status } : {};
    const search = String(req.query.search || "").trim();
    if (search.length > 120) return res.status(400).json({ success: false, message: "Search must be 120 characters or fewer" });
    const regex = search ? new RegExp(escapeRegex(search), "i") : null;
    const orderCustomerIds = regex ? await Order.find({ orderId: regex }).distinct("customerId") : [];
    const pipeline = [
      { $match: baseMatch }, { $sort: { updatedAt: -1 } },
      { $lookup: { from: "customers", localField: "customerId", foreignField: "_id", as: "customer" } }, { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
      ...(regex ? [{ $match: { $or: [{ "customer.name": regex }, { whatsappId: regex }, { "customer.phone": regex }, { customerId: { $in: orderCustomerIds } }] } }] : []),
      { $facet: { conversations: [
        { $skip: (page - 1) * limit }, { $limit: limit },
        { $lookup: { from: "messages", let: { customerId: "$customerId", whatsappId: "$whatsappId" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$customerId", "$$customerId"] }, { $eq: ["$whatsappId", "$$whatsappId"] }] } } }, { $sort: { createdAt: -1 } }, { $limit: 1 }, { $project: { message: 1, direction: 1, createdAt: 1 } }], as: "lastMessage" } },
        { $lookup: { from: "orders", let: { customerId: "$customerId" }, pipeline: [{ $match: { $expr: { $eq: ["$customerId", "$$customerId"] } } }, { $sort: { createdAt: -1 } }, { $limit: 1 }, { $project: { orderId: 1, productName: 1, totalAmount: 1, orderStatus: 1 } }], as: "latestOrder" } },
        { $project: { whatsappId: 1, status: 1, currentStep: 1, updatedAt: 1, customer: { id: "$customer._id", name: "$customer.name", phone: "$customer.phone" }, lastMessage: { $arrayElemAt: ["$lastMessage", 0] }, latestOrder: { $arrayElemAt: ["$latestOrder", 0] } } },
      ], total: [{ $count: "value" }] } },
    ];
    const [result] = await Conversation.aggregate(pipeline);
    const total = result.total[0]?.value || 0;
    return res.json({ success: true, conversations: result.conversations, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { console.error("Support conversations error:", error.message); return res.status(500).json({ success: false, message: "Unable to load support conversations" }); }
});

router.get("/support/conversations/:id", async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.messagePage, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.messageLimit, 10) || 50));
    const conversation = await Conversation.findById(req.params.id).select("customerId whatsappId status currentStep deliveryField editingField pendingOrderId selectedProductId selectedProductName selectedProductPrice quantity paymentMethod internalNotes createdAt updatedAt").lean();
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found" });
    const [customer, latestOrder, totalMessages, messages] = await Promise.all([
      Customer.findById(conversation.customerId).select("name whatsappId phone createdAt updatedAt").lean(),
      Order.findOne({ customerId: conversation.customerId }).sort({ createdAt: -1 }).select("orderId productName quantity totalAmount paymentMethod paymentStatus orderStatus createdAt").lean(),
      Message.countDocuments({ customerId: conversation.customerId, whatsappId: conversation.whatsappId }),
      Message.find({ customerId: conversation.customerId, whatsappId: conversation.whatsappId }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select("direction message messageType createdAt").lean(),
    ]);
    messages.reverse();
    return res.json({ success: true, conversation: { ...conversation, internalNotes: (conversation.internalNotes || []).map((note) => ({ id: String(note._id), text: note.text, createdBy: note.createdBy, createdAt: note.createdAt })) }, customer: customer ? { id: String(customer._id), name: customer.name, whatsappId: customer.whatsappId, phone: customer.phone, createdAt: customer.createdAt } : null, latestOrder, messages, messagePagination: { page, limit, total: totalMessages, totalPages: Math.ceil(totalMessages / limit) } });
  } catch (_) { return res.status(404).json({ success: false, message: "Conversation not found" }); }
});

router.patch("/support/conversations/:id/status", async (req, res) => {
  const status = req.body?.status;
  if (!SUPPORT_STATUSES.includes(status)) return res.status(400).json({ success: false, message: "Invalid support status" });
  try {
    const conversation = await Conversation.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true, runValidators: true }).select("status currentStep updatedAt").lean();
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found" });
    return res.json({ success: true, conversation });
  } catch (_) { return res.status(404).json({ success: false, message: "Conversation not found" }); }
});

router.post("/support/conversations/:id/notes", async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text || text.length > 2000) return res.status(400).json({ success: false, message: "Note must be between 1 and 2000 characters" });
  try {
    const note = { text, createdBy: { adminId: String(req.admin._id), name: req.admin.name || req.admin.email || "Admin" }, createdAt: new Date() };
    const conversation = await Conversation.findByIdAndUpdate(req.params.id, { $push: { internalNotes: note } }, { new: true, runValidators: true }).select("internalNotes").lean();
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found" });
    const created = conversation.internalNotes[conversation.internalNotes.length - 1];
    return res.status(201).json({ success: true, note: { id: String(created._id), text: created.text, createdBy: created.createdBy, createdAt: created.createdAt } });
  } catch (error) { return res.status(400).json({ success: false, message: error.message || "Unable to add note" }); }
});

router.get("/analytics", async (req, res) => {
  try {
    const period = analyticsDateRange(req.query);
    const dateMatch = { createdAt: { $gte: period.from, $lt: period.toExclusive } };
    const successfulSale = { paymentStatus: "PAID", orderStatus: { $ne: "CANCELLED" } };
    const [orderData, salesOverTime, customerData, totalCustomers] = await Promise.all([
      Order.aggregate([{ $match: dateMatch }, { $facet: {
        summary: [{ $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: { $cond: [{ $and: [{ $eq: ["$paymentStatus", "PAID"] }, { $ne: ["$orderStatus", "CANCELLED"] }] }, "$totalAmount", 0] } }, confirmedOrders: { $sum: { $cond: [{ $eq: ["$orderStatus", "CONFIRMED"] }, 1, 0] } }, pendingOrders: { $sum: { $cond: [{ $eq: ["$orderStatus", "PENDING"] }, 1, 0] } }, cancelledOrders: { $sum: { $cond: [{ $eq: ["$orderStatus", "CANCELLED"] }, 1, 0] } }, codOrders: { $sum: { $cond: [{ $eq: ["$paymentMethod", "COD"] }, 1, 0] } }, onlineOrders: { $sum: { $cond: [{ $eq: ["$paymentMethod", "ONLINE"] }, 1, 0] } }, paidOrders: { $sum: { $cond: [{ $and: [{ $eq: ["$paymentStatus", "PAID"] }, { $ne: ["$orderStatus", "CANCELLED"] }] }, 1, 0] } }, pendingPayments: { $sum: { $cond: [{ $eq: ["$paymentStatus", "PENDING"] }, 1, 0] } } } }],
        paymentMethods: [{ $group: { _id: "$paymentMethod", orders: { $sum: 1 } } }, { $project: { _id: 0, method: "$_id", orders: 1 } }, { $sort: { method: 1 } }],
        paymentStatuses: [{ $group: { _id: "$paymentStatus", orders: { $sum: 1 } } }, { $project: { _id: 0, status: "$_id", orders: 1 } }, { $sort: { status: 1 } }],
        orderStatuses: [{ $group: { _id: "$orderStatus", orders: { $sum: 1 } } }, { $project: { _id: 0, status: "$_id", orders: 1 } }, { $sort: { status: 1 } }],
        topProducts: [{ $match: successfulSale }, { $group: { _id: { productId: "$productId", name: "$productName" }, quantity: { $sum: "$quantity" }, orders: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } }, { $project: { _id: 0, productId: "$_id.productId", name: "$_id.name", quantity: 1, orders: 1, revenue: 1 } }, { $sort: { quantity: -1, revenue: -1 } }, { $limit: 10 }],
        recentOrders: [{ $sort: { createdAt: -1 } }, { $limit: 10 }, { $project: { orderId: 1, customerName: 1, whatsappId: 1, productName: 1, quantity: 1, totalAmount: 1, paymentMethod: 1, paymentStatus: 1, orderStatus: 1, createdAt: 1 } }],
      } }]),
      Order.aggregate([{ $match: dateMatch }, { $group: { _id: { $dateToString: { format: period.groupFormat, date: "$createdAt", timezone: "UTC" } }, orders: { $sum: 1 }, revenue: { $sum: { $cond: [{ $and: [{ $eq: ["$paymentStatus", "PAID"] }, { $ne: ["$orderStatus", "CANCELLED"] }] }, "$totalAmount", 0] } } } }, { $project: { _id: 0, date: "$_id", orders: 1, revenue: 1 } }, { $sort: { date: 1 } }]),
      Customer.aggregate([{ $match: dateMatch }, { $facet: { newCustomers: [{ $count: "value" }], customerGrowth: [{ $group: { _id: { $dateToString: { format: period.groupFormat, date: "$createdAt", timezone: "UTC" } }, customers: { $sum: 1 } } }, { $project: { _id: 0, date: "$_id", customers: 1 } }, { $sort: { date: 1 } }] } }]),
      Customer.countDocuments(),
    ]);
    const summary = orderData[0].summary[0] || { totalOrders: 0, totalRevenue: 0, confirmedOrders: 0, pendingOrders: 0, cancelledOrders: 0, codOrders: 0, onlineOrders: 0, paidOrders: 0, pendingPayments: 0 };
    const customerSummary = customerData[0];
    return res.json({ success: true, range: { type: period.range, from: period.from.toISOString(), to: new Date(period.toExclusive.valueOf() - 1).toISOString() }, summary: { ...summary, totalCustomers, newCustomers: customerSummary.newCustomers[0]?.value || 0 }, salesOverTime, ordersOverTime: salesOverTime.map(({ date, orders }) => ({ date, orders })), customerGrowth: customerSummary.customerGrowth, paymentMethods: orderData[0].paymentMethods, paymentStatuses: orderData[0].paymentStatuses, orderStatuses: orderData[0].orderStatuses, topProducts: orderData[0].topProducts, recentOrders: orderData[0].recentOrders });
  } catch (error) { return res.status(400).json({ success: false, message: error.message || "Unable to load analytics" }); }
});

router.get("/products", async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const filter = {};
    if (req.query.category?.trim()) filter.category = req.query.category.trim();
    if (req.query.status === "active") filter.isActive = true;
    if (req.query.status === "inactive") filter.isActive = false;
    if (req.query.stock === "available") filter.stock = { $gt: 0 };
    if (req.query.stock === "out") filter.stock = 0;
    if (req.query.search?.trim()) { const search = new RegExp(escapeRegex(req.query.search.trim()), "i"); filter.$or = [{ name: search }, { productId: search }, { category: search }]; }
    const [products, total] = await Promise.all([Product.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Product.countDocuments(filter)]);
    return res.json({ success: true, products, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { console.error("Admin products error:", error.message); return res.status(500).json({ success: false, message: "Unable to load products" }); }
});

router.get("/products/:id", async (req, res) => {
  try { const product = await Product.findById(req.params.id).lean(); if (!product) return res.status(404).json({ success: false, message: "Product not found" }); return res.json({ success: true, product }); }
  catch (_) { return res.status(404).json({ success: false, message: "Product not found" }); }
});

router.post("/products", async (req, res) => {
  try {
    const productId = String(req.body?.productId || "").trim();
    if (!productId) return res.status(400).json({ success: false, message: "Product ID is required" });
    const values = productUpdates(req.body);
    if (!values.name || !values.category || !Object.prototype.hasOwnProperty.call(values, "price") || !Object.prototype.hasOwnProperty.call(values, "stock")) return res.status(400).json({ success: false, message: "Name, category, price, and stock are required" });
    const product = await Product.create({ productId, ...values });
    return res.status(201).json({ success: true, product });
  } catch (error) { if (error.code === 11000) return res.status(409).json({ success: false, message: "Product ID already exists" }); return res.status(400).json({ success: false, message: error.message || "Unable to create product" }); }
});

router.patch("/products/:id", async (req, res) => {
  try {
    const values = productUpdates(req.body);
    if (!Object.keys(values).length) return res.status(400).json({ success: false, message: "No editable product fields supplied" });
    const product = await Product.findByIdAndUpdate(req.params.id, { $set: values }, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    return res.json({ success: true, product });
  } catch (error) { return res.status(400).json({ success: false, message: error.message || "Unable to update product" }); }
});

router.delete("/products/:id", async (req, res) => {
  try { const product = await Product.findByIdAndUpdate(req.params.id, { $set: { isActive: false } }, { new: true }); if (!product) return res.status(404).json({ success: false, message: "Product not found" }); return res.json({ success: true, product, message: "Product deactivated" }); }
  catch (_) { return res.status(404).json({ success: false, message: "Product not found" }); }
});

router.get("/dashboard", async (_req, res) => {
  try {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const [totalOrders, todayOrders, pendingOrders, confirmedOrders, codOrders, onlinePaidOrders, revenue, recentOrders] = await Promise.all([
      Order.countDocuments(), Order.countDocuments({ createdAt: { $gte: startOfToday } }), Order.countDocuments({ orderStatus: "PENDING" }),
      Order.countDocuments({ orderStatus: "CONFIRMED" }), Order.countDocuments({ paymentMethod: "COD", paymentStatus: "COD" }),
      Order.countDocuments({ paymentMethod: "ONLINE", paymentStatus: "PAID" }),
      Order.aggregate([{ $match: { paymentStatus: "PAID" } }, { $group: { _id: null, total: { $sum: "$totalAmount" } } }]),
      Order.find().sort({ createdAt: -1 }).limit(10).select("orderId customerName whatsappId productName totalAmount paymentMethod paymentStatus orderStatus createdAt").lean(),
    ]);
    res.json({ success: true, stats: { totalOrders, todayOrders, pendingOrders, confirmedOrders, codOrders, onlinePaidOrders, totalRevenue: revenue[0]?.total || 0 }, recentOrders });
  } catch (error) { console.error("Admin dashboard error:", error.message); res.status(500).json({ success: false, message: "Unable to load dashboard" }); }
});

router.get("/orders", async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const filter = {};
    if (req.query.status && ORDER_STATUSES.includes(req.query.status)) filter.orderStatus = req.query.status;
    if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
    if (req.query.paymentMethod) filter.paymentMethod = req.query.paymentMethod;
    if (req.query.search?.trim()) { const search = new RegExp(req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); filter.$or = [{ orderId: search }, { customerName: search }, { whatsappId: search }]; }
    const [orders, total] = await Promise.all([Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select("orderId customerName whatsappId productName quantity totalAmount paymentMethod paymentStatus orderStatus estimatedDeliveryDate carrier trackingNumber createdAt updatedAt").lean(), Order.countDocuments(filter)]);
    res.json({ success: true, orders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { console.error("Admin orders error:", error.message); res.status(500).json({ success: false, message: "Unable to load orders" }); }
});

router.get("/orders/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    return res.json({ success: true, order: safeOrder(order) });
  } catch (_) { return res.status(404).json({ success: false, message: "Order not found" }); }
});

router.patch("/orders/:id/status", async (req, res) => {
  const status = req.body?.status;
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ success: false, message: "Invalid order status" });
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (!canTransition(order.orderStatus, status)) return res.status(409).json({ success: false, message: `Cannot change an order from ${order.orderStatus} to ${status}` });
    
    if (order.paymentMethod === "ONLINE" && order.paymentStatus !== "PAID" && order.orderStatus === "PENDING" && status === "CONFIRMED") {
      return res.status(409).json({ success: false, message: "Cannot confirm an unpaid online order" });
    }

    const carrier = Object.prototype.hasOwnProperty.call(req.body || {}, "carrier") ? String(req.body.carrier || "").trim() : undefined;
    const trackingNumber = Object.prototype.hasOwnProperty.call(req.body || {}, "trackingNumber") ? String(req.body.trackingNumber || "").trim() : undefined;
    if ((carrier && carrier.length > 120) || (trackingNumber && trackingNumber.length > 120)) return res.status(400).json({ success: false, message: "Carrier and tracking number must be 120 characters or fewer" });
    let estimatedDeliveryDate;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "estimatedDeliveryDate") && req.body.estimatedDeliveryDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.estimatedDeliveryDate)) return res.status(400).json({ success: false, message: "Estimated delivery date must use YYYY-MM-DD" });
      estimatedDeliveryDate = new Date(`${req.body.estimatedDeliveryDate}T00:00:00.000Z`);
      if (Number.isNaN(estimatedDeliveryDate.valueOf()) || estimatedDeliveryDate.toISOString().slice(0, 10) !== req.body.estimatedDeliveryDate) return res.status(400).json({ success: false, message: "Invalid estimated delivery date" });
    }
    order.orderStatus = status;
    if (status === "SHIPPED") { order.shippedAt ||= new Date(); order.carrier = carrier ?? order.carrier; order.trackingNumber = trackingNumber ?? order.trackingNumber; order.estimatedDeliveryDate = estimatedDeliveryDate || order.estimatedDeliveryDate || deliveryEstimateDate(order.shippedAt); }
    if (status === "DELIVERED") order.deliveredAt ||= new Date();
    await order.save();
    if (status === "SHIPPED" || status === "DELIVERED") {
      const text = status === "SHIPPED" ? `🚚 Your order has been shipped!\n\nOrder: #${order.orderId}\nProduct: ${order.productName}\nQuantity: ${order.quantity}\n\nTracking ID: ${order.trackingNumber || "Not available yet."}\nCarrier: ${order.carrier || "Not available yet."}\nEstimated delivery: ${formatDate(order.estimatedDeliveryDate) || "Not available yet."}\n\nThank you for your order! ❤️` : `🎉 Your order has been delivered!\n\nOrder: #${order.orderId}\nProduct: ${order.productName}\n\nThank you for shopping with us! ❤️`;
      sendWhatsAppText({ to: order.whatsappId, text, customerId: order.customerId }).catch((error) => console.error("Order lifecycle notification failed:", error.message));
    }
    return res.json({ success: true, order: safeOrder(order) });
  } catch (error) { console.error("Order status update error:", error.message); return res.status(400).json({ success: false, message: "Unable to update order status" }); }
});

module.exports = router;
