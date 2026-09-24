const { mongoose } = require("../config/database");

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    whatsappId: { type: String, required: true },
    productId: { type: String, required: true },
    productName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    customerName: String,
    houseBuilding: String,
    area: String,
    district: String,
    address: String,
    landmark: String,
    city: String,
    state: String,
    pincode: String,
    paymentMethod: { type: String, enum: ["COD", "ONLINE"], default: "COD" },
    paymentStatus: { type: String, enum: ["PENDING", "COD", "PAID", "FAILED", "REFUNDED"], default: "COD" },
    razorpayOrderId: { type: String, sparse: true, unique: true },
    razorpayPaymentId: { type: String, sparse: true, unique: true },
    razorpayPaymentLinkId: { type: String, sparse: true, unique: true },
    razorpayPaymentLinkUrl: String,
    razorpayReferenceId: { type: String, sparse: true, unique: true },
    paymentLinkUrl: String,
    paidAt: Date,
    estimatedDeliveryDate: Date,
    carrier: { type: String, trim: true, maxlength: 120 },
    trackingNumber: { type: String, trim: true, maxlength: 120 },
    shippedAt: Date,
    deliveredAt: Date,
    orderStatus: { type: String, enum: ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"], default: "CONFIRMED" },
  },
  { timestamps: true }
);

orderSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model("Order", orderSchema);
