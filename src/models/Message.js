const { mongoose } = require("../config/database");

const messageSchema = new mongoose.Schema(
  {
    whatsappMessageId: { type: String, unique: true, sparse: true, index: true },
    whatsappId: { type: String, required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    direction: { type: String, enum: ["INCOMING", "OUTGOING"], required: true },
    message: { type: String, required: true },
    messageType: { type: String, default: "text" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

messageSchema.index({ customerId: 1, whatsappId: 1, createdAt: 1 });

module.exports = mongoose.model("Message", messageSchema);
