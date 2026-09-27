const Order = require("../models/Order");

const ALLOWED_TRANSITIONS = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

function deliveryEstimateDate(from = new Date()) {
  const configured = Number.parseInt(process.env.DELIVERY_ESTIMATE_DAYS, 10);
  const days = Number.isSafeInteger(configured) && configured >= 1 && configured <= 30 ? configured : 5;
  const result = new Date(from);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function canCancelOrder(order) { return ["PENDING", "CONFIRMED", "PROCESSING"].includes(order.orderStatus); }
function canTransition(from, to) { return ALLOWED_TRANSITIONS[from]?.includes(to) || false; }
function formatDate(date) { return date ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(date)) : null; }

function trackingText(order) {
  const statusText = { PENDING: "⏳ Your order is awaiting confirmation.", CONFIRMED: "✅ Your order has been confirmed.", PROCESSING: "📦 Your order is being prepared for shipment.", SHIPPED: "🚚 Your order has been shipped.", DELIVERED: "🎉 Your order has been delivered.", CANCELLED: "❌ Your order was cancelled." }[order.orderStatus];
  const paymentText = order.paymentStatus === "PAID" ? "Paid" : order.paymentStatus === "COD" ? "Cash on Delivery" : order.paymentStatus === "PENDING" ? "Pending" : order.paymentStatus === "FAILED" ? "Failed" : order.paymentStatus;
  const lines = ["📦 Order Tracking", "", `Order: #${order.orderId}`, `✨ Product: ${order.productName}`, `🔢 Quantity: ${order.quantity}`, "", `💳 Payment: ${paymentText}`, `📦 Status: ${statusText}`];
  if (order.orderStatus === "SHIPPED") {
    lines.push("", `🚚 Carrier: ${order.carrier || "Not available yet."}`, `🔎 Tracking Number: ${order.trackingNumber || "Not available yet."}`);
  }
  if (order.shippedAt) lines.push(`Shipped: ${formatDate(order.shippedAt)}`);
  if (order.deliveredAt && order.orderStatus === "DELIVERED") lines.push(`Delivered: ${formatDate(order.deliveredAt)}`);
  if (order.estimatedDeliveryDate && order.orderStatus !== "CANCELLED" && order.orderStatus !== "DELIVERED") {
    lines.push("", `📅 Estimated Delivery:\n${formatDate(order.estimatedDeliveryDate)}`);
  }
  return lines.join("\n");
}

function deliveryDateText(order) {
  const statusText = { PENDING: "⏳ Your order is awaiting confirmation.", CONFIRMED: "✅ Your order has been confirmed.", PROCESSING: "📦 Your order is being prepared for shipment.", SHIPPED: "🚚 Your order has been shipped.", DELIVERED: "🎉 Your order has been delivered.", CANCELLED: "❌ Your order was cancelled." }[order.orderStatus];
  if (order.orderStatus === "CANCELLED") {
    return `📦 Delivery Update\n\nOrder: #${order.orderId}\n\n${statusText}\n\nThis order has been cancelled and will not be delivered.`;
  }
  if (order.orderStatus === "DELIVERED") {
    return `📦 Delivery Update\n\nOrder: #${order.orderId}\n✨ Product: ${order.productName}\n📦 Status: Delivered\n\n🎉 Your order has been delivered${order.deliveredAt ? ` on ${formatDate(order.deliveredAt)}` : ""}!`;
  }
  const lines = ["📦 Delivery Update", "", `Order: #${order.orderId}`, `✨ Product: ${order.productName}`, `📦 Status: ${statusText}`];
  if (order.estimatedDeliveryDate) {
    lines.push("", `📅 Estimated Delivery:\n${formatDate(order.estimatedDeliveryDate)}`);
  } else {
    lines.push("", "The estimated delivery date has not been updated yet.\nWe'll provide the delivery estimate once it is available. 😊");
  }
  if (order.orderStatus === "CONFIRMED" || order.orderStatus === "PROCESSING") {
    lines.push("", "We'll update you when your order is shipped. 😊");
  }
  return lines.join("\n");
}

async function customerOrders(customerId, orderId) {
  if (orderId) return Order.findOne({ customerId, orderId: orderId.toUpperCase() }).lean();
  return Order.find({ customerId }).sort({ createdAt: -1 }).limit(5).lean();
}

module.exports = { canCancelOrder, canTransition, customerOrders, deliveryEstimateDate, deliveryDateText, formatDate, trackingText };
