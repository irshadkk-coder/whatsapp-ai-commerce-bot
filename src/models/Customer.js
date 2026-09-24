const { mongoose } = require("../config/database");

const customerSchema = new mongoose.Schema(
  {
    whatsappId: { type: String, required: true, unique: true, index: true },
    name: String,
    houseBuilding: String,
    area: String,
    district: String,
    phone: String,
    address: String,
    landmark: String,
    city: String,
    state: String,
    pincode: String,
    totalOrders: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
  },
  { timestamps: true }
);

customerSchema.index({ updatedAt: -1 });

module.exports = mongoose.model("Customer", customerSchema);
