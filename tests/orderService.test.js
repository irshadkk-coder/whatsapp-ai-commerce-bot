const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadFresh } = require("./helpers/mockModule");

const customer = { _id: "customer-1", whatsappId: "919999999999" };
const product = { productId: "P-1", name: "Plate Organizer", price: 499, stock: 10 };
const conversation = { whatsappId: customer.whatsappId, quantity: 1, customerName: "Asha", houseBuilding: "12 Home", area: "MG Road", district: "Kochi", pincode: "682001", address: "12 Home, MG Road, Kochi, 682001" };

function orderService(created, storedProduct = { ...product }) {
  const Product = {
    findOneAndUpdate(filter, update) {
      const matches = storedProduct.productId === filter.productId && storedProduct.isActive !== false && storedProduct.stock >= filter.stock.$gte;
      if (matches) storedProduct.stock += update.$inc.stock;
      return { lean: async () => matches ? { ...storedProduct } : null };
    },
    findOne(filter) { return { lean: async () => storedProduct.productId === filter.productId ? { ...storedProduct } : null }; },
    async updateOne(_filter, update) { storedProduct.stock += update.$inc.stock; },
  };
  const service = loadFresh(path.join(__dirname, "../src/services/orderService.js"), {
    "../models/Order": { async create(order) { created.push(order); return order; } },
    "../models/Product": Product,
  });
  return { ...service, storedProduct };
}

test("quantity 1 reserves stock and uses the current database product snapshot", async () => {
  const created = []; const { createOrder, storedProduct } = orderService(created, { ...product, name: "Current Plate Organizer", price: 599 });
  const order = await createOrder({ customer, conversation, product: { ...product, name: "Stale name", price: 1 } });
  assert.equal(order.productId, "P-1"); assert.equal(created.length, 1);
  assert.equal(order.productName, "Current Plate Organizer"); assert.equal(order.price, 599); assert.equal(order.totalAmount, 599); assert.equal(storedProduct.stock, 9);
});

test("order creation rejects invalid quantity and invalid delivery data", async () => {
  const { createOrder } = orderService([]);
  await assert.rejects(createOrder({ customer, conversation: { ...conversation, quantity: 0 }, product }));
  await assert.rejects(createOrder({ customer, conversation: { ...conversation, pincode: "123" }, product }));
});

test("quantity equal to current stock succeeds and reaches zero without becoming negative", async () => {
  const created = []; const { createOrder, storedProduct } = orderService(created);
  await createOrder({ customer, conversation: { ...conversation, quantity: 10 }, product });
  assert.equal(created.length, 1); assert.equal(storedProduct.stock, 0);
});

for (const [quantity, stock] of [[11, 10], [1, 0]]) {
  test(`quantity ${quantity} with stock ${stock} is rejected without creating an order`, async () => {
    const created = []; const { createOrder, storedProduct } = orderService(created, { ...product, stock });
    await assert.rejects(createOrder({ customer, conversation: { ...conversation, quantity }, product }), /Available stock/);
    assert.equal(created.length, 0); assert.equal(storedProduct.stock, stock); assert.ok(storedProduct.stock >= 0);
  });
}

test("zero and negative quantities are rejected before reserving stock", async () => {
  for (const quantity of [0, -1]) {
    const created = []; const { createOrder, storedProduct } = orderService(created);
    await assert.rejects(createOrder({ customer, conversation: { ...conversation, quantity }, product }));
    assert.equal(created.length, 0); assert.equal(storedProduct.stock, 10);
  }
});

test("concurrent requests cannot reserve the same stock twice", async () => {
  const created = []; const { createOrder, storedProduct } = orderService(created);
  const attempts = await Promise.allSettled([
    createOrder({ customer, conversation: { ...conversation, quantity: 10 }, product }),
    createOrder({ customer, conversation: { ...conversation, quantity: 10 }, product }),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
  assert.equal(created.length, 1); assert.equal(storedProduct.stock, 0); assert.ok(storedProduct.stock >= 0);
});
