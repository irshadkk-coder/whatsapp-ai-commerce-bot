require("dotenv").config();
const products = require("./products");
const { connectDatabase, mongoose } = require("./src/config/database");
const Product = require("./src/models/Product");

async function seed() {
  try {
    await connectDatabase();
    const operations = products.map((product) => ({
      updateOne: {
        filter: { productId: product.id },
        // Demo data may create missing products, but it must never replace values
        // that an administrator has changed in MongoDB.
        update: { $setOnInsert: { productId: product.id, name: product.name, price: product.price, cod: product.cod, stock: Number.isSafeInteger(product.stock) ? product.stock : (product.stock ? 1 : 0), category: product.category, description: product.description, isActive: true } },
        upsert: true,
      },
    }));
    await Product.bulkWrite(operations);
    console.log(`Products seeded successfully: ${products.length}`);
  } finally {
    await mongoose.connection.close();
    console.log("Database connection closed");
  }
}

seed().catch((error) => { console.error("Seeding failed:", error.message); process.exitCode = 1; });
