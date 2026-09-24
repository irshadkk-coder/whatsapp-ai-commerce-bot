const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

function publicAdmin(admin) {
  return { id: String(admin._id), name: admin.name, email: admin.email, role: admin.role };
}

async function requireAdmin(req, res, next) {
  try {
    const token = req.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token || !process.env.JWT_SECRET) return res.status(401).json({ success: false, message: "Unauthorized" });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "ADMIN") return res.status(403).json({ success: false, message: "Forbidden" });
    const admin = await Admin.findById(payload.adminId);
    if (!admin || !admin.isActive) return res.status(401).json({ success: false, message: "Unauthorized" });
    req.admin = admin;
    next();
  } catch (_) { return res.status(401).json({ success: false, message: "Unauthorized" }); }
}

module.exports = { requireAdmin, publicAdmin };
