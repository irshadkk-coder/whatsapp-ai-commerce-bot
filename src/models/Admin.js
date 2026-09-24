const { mongoose } = require("../config/database");

const adminSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["ADMIN"], default: "ADMIN" },
  isActive: { type: Boolean, default: true },
  lastLoginAt: Date,
}, { timestamps: true });

module.exports = mongoose.model("Admin", adminSchema);
