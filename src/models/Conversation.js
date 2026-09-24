const { mongoose } = require("../config/database");

const conversationSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    whatsappId: { type: String, required: true },
    status: { type: String, enum: ["BOT_ACTIVE", "HUMAN_REQUIRED", "RESOLVED", "COMPLETED", "CANCELLED"], default: "BOT_ACTIVE" },
    // Legacy steps remain valid so an in-progress conversation can be migrated safely.
    currentStep: { type: String, enum: ["IDLE", "AWAITING_QUANTITY", "AWAITING_NAME", "AWAITING_ADDRESS", "AWAITING_LANDMARK", "AWAITING_PINCODE", "AWAITING_DELIVERY_DETAILS", "AWAITING_CONFIRMATION", "AWAITING_EDIT_SELECTION", "AWAITING_EDIT_VALUE", "AWAITING_PAYMENT_METHOD", "AWAITING_PAYMENT_VERIFICATION"], default: "IDLE" },
    deliveryField: { type: String, enum: ["NAME", "HOUSE_BUILDING", "AREA", "DISTRICT", "PINCODE", null], default: null },
    editingField: { type: String, enum: ["NAME", "HOUSE_BUILDING", "AREA", "DISTRICT", "PINCODE", "QUANTITY", null], default: null },
    pendingOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    selectedProductId: String,
    selectedProductName: String,
    selectedProductPrice: Number,
    quantity: Number,
    customerName: String,
    houseBuilding: String,
    area: String,
    district: String,
    address: String,
    landmark: String,
    pincode: String,
    paymentMethod: { type: String, default: "COD" },
    internalNotes: [{
      text: { type: String, required: true, trim: true, maxlength: 2000 },
      createdBy: { adminId: String, name: String },
      createdAt: { type: Date, default: Date.now },
    }],
  },
  { timestamps: true }
);

conversationSchema.index({ whatsappId: 1, status: 1 });
conversationSchema.index({ updatedAt: -1 });
module.exports = mongoose.model("Conversation", conversationSchema);
