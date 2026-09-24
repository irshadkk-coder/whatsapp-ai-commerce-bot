const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadFresh } = require("./helpers/mockModule");

const products = [
  { productId: "K-1", name: "Stainless Steel Cutting Board", category: "Kitchen", price: 899, stock: 4, isActive: true },
  { productId: "J-1", name: "Premium Necklace", category: "Jewellery", price: 1299, stock: 2, isActive: true },
  { productId: "F-1", name: "Classic Shirt", category: "Fashion", price: 799, stock: 1, isActive: true },
  { productId: "W-1", name: "Silver Watch", category: "Accessories", price: 1499, stock: 1, isActive: true },
  { productId: "OOS", name: "Unavailable Orchid", category: "Kitchen", price: 200, stock: 0, isActive: true },
  { productId: "OFF", name: "Inactive Umbrella", category: "Kitchen", price: 200, stock: 9, isActive: false },
];

function service() {
  const Product = {
    find(filter) {
      const available = products.filter((product) => product.isActive !== false && product.stock > 0);
      return { sort: () => ({ lean: async () => available }) };
    },
  };
  return loadFresh(path.join(__dirname, "../src/utils/productService.js"), { "../models/Product": Product });
}

test("product matching finds exact, partial, and case-insensitive names", async () => {
  const { findRelevantProduct } = service();
  assert.equal((await findRelevantProduct("Stainless Steel Cutting Board")).productId, "K-1");
  assert.equal((await findRelevantProduct("cutting board")).productId, "K-1");
  assert.equal((await findRelevantProduct("PREMIUM NECKLACE")).productId, "J-1");
});

test("product matching excludes inactive and out-of-stock products", async () => {
  const { findRelevantProduct, getAvailableProducts } = service();
  assert.equal(await findRelevantProduct("Unavailable Orchid"), null);
  assert.equal(await findRelevantProduct("Inactive Umbrella"), null);
  assert.deepEqual((await getAvailableProducts()).map(({ productId }) => productId), ["K-1", "J-1", "F-1", "W-1"]);
});

test("category aliases return jewellery, kitchen, fashion, and watches", async () => {
  const { getRequestedCategory, findCategoryProducts } = service();
  assert.equal(getRequestedCategory("show jewelry"), "Jewellery");
  assert.equal((await findCategoryProducts("jewellery")).at(0).productId, "J-1");
  assert.equal((await findCategoryProducts("kitchen")).at(0).productId, "K-1");
  assert.equal((await findCategoryProducts("fashion")).at(0).productId, "F-1");
  assert.equal((await findCategoryProducts("watches")).at(0).productId, "W-1");
});
