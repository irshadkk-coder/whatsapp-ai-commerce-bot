require("dotenv").config();
const bcrypt = require("bcrypt");
const { connectDatabase, mongoose } = require("./src/config/database");
const Admin = require("./src/models/Admin");

async function seedAdmin() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error("ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD are required.");
  await connectDatabase();
  const existing = await Admin.findOne({ email: ADMIN_EMAIL.trim().toLowerCase() });
  if (!existing) await Admin.create({ name: ADMIN_NAME, email: ADMIN_EMAIL, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12), role: "ADMIN" });
  console.log(existing ? "Admin already exists." : "Admin created.");
  await mongoose.disconnect();
}
seedAdmin().catch((error) => { console.error("Admin seed error:", error.message); process.exit(1); });
