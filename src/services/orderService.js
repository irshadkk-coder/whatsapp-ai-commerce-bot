const crypto = require("crypto");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { deliveryEstimateDate } = require("./orderLifecycleService");

function buildOrderId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `ORD-${date}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function validOrderInput(conversation, product) {
  return product?.productId &&
    Number.isSafeInteger(conversation.quantity) && conversation.quantity > 0 &&
    ["customerName", "houseBuilding", "area", "district"].every((field) => typeof conversation[field] === "string" && conversation[field].trim()) &&
    /^\d{6}$/.test(conversation.pincode || "") &&
    typeof conversation.whatsappId === "string" && conversation.whatsappId.trim();
}

function insufficientStockError(availableStock) {
  const error = new Error(`Requested quantity is unavailable. Available stock: ${availableStock}.`);
  error.code = "INSUFFICIENT_STOCK";
  error.availableStock = availableStock;
  return error;
}

async function createOrder({ customer, conversation, product, paymentMethod = "COD", paymentStatus = "COD", orderStatus = "CONFIRMED" }) {
  if (!validOrderInput(conversation, product)) {
    throw new Error("Cannot create an order with incomplete or invalid delivery details.");
  }
  // This conditional update both reloads the product and reserves its stock. Two
  // concurrent requests cannot both pass because MongoDB applies the predicate
  // and decrement atomically.
  const reservedProduct = await Product.findOneAndUpdate(
    { productId: product.productId, isActive: { $ne: false }, stock: { $gte: conversation.quantity } },
    { $inc: { stock: -conversation.quantity } },
    { new: true }
  ).lean();
  if (!reservedProduct) {
    const currentProduct = await Product.findOne({ productId: product.productId }).lean();
    throw insufficientStockError(Math.max(0, Number(currentProduct?.stock) || 0));
  }
  try {
    return await Order.create({
      orderId: buildOrderId(), customerId: customer._id, whatsappId: customer.whatsappId,
      productId: reservedProduct.productId, productName: reservedProduct.name, quantity: conversation.quantity,
      price: reservedProduct.price, totalAmount: reservedProduct.price * conversation.quantity, customerName: conversation.customerName,
      houseBuilding: conversation.houseBuilding, area: conversation.area, district: conversation.district,
      address: conversation.address, landmark: conversation.landmark, pincode: conversation.pincode, paymentMethod,
      paymentStatus, orderStatus, estimatedDeliveryDate: deliveryEstimateDate(),
    });
  } catch (error) {
    // Keep stock and orders consistent if persistence fails after the reservation.
    await Product.updateOne({ productId: reservedProduct.productId }, { $inc: { stock: conversation.quantity } });
    throw error;
  }
}

module.exports = { createOrder };
