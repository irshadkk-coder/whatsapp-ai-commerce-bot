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
  const lines = ["📦 Order Tracking", "", `Order: #${order.orderId}`, `Product: ${order.productName}`, `Quantity: ${order.quantity}`, "", `Status: ${statusText}`];
  if (order.shippedAt) lines.push(`Shipped: ${formatDate(order.shippedAt)}`);
  if (order.estimatedDeliveryDate) lines.push(`Estimated delivery: ${formatDate(order.estimatedDeliveryDate)}`);
  if (order.orderStatus === "SHIPPED") { lines.push(`Carrier: ${order.carrier || "Not available yet."}`, `Tracking ID: ${order.trackingNumber || "Not available yet."}`); }
  return lines.join("\n");
}

async function customerOrders(customerId, orderId) {
  if (orderId) return Order.findOne({ customerId, orderId: orderId.toUpperCase() }).lean();
  return Order.find({ customerId }).sort({ createdAt: -1 }).limit(5).lean();
}

module.exports = { canCancelOrder, canTransition, customerOrders, deliveryEstimateDate, formatDate, trackingText };
