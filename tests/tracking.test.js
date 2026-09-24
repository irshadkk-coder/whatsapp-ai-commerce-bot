const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadFresh } = require("./helpers/mockModule");

function lifecycleWithOrders(orders) {
  const Order = {
    findOne(query) { return { lean: async () => orders.find((order) => order.customerId === query.customerId && order.orderId === query.orderId) || null }; },
    find(query) { return { sort: () => ({ limit: () => ({ lean: async () => orders.filter((order) => order.customerId === query.customerId).slice(0, 5) }) }) }; },
  };
  return loadFresh(path.join(__dirname, "../src/services/orderLifecycleService.js"), { "../models/Order": Order });
}

test("tracking returns only the requesting customer's order and rejects foreign IDs", async () => {
  const { customerOrders } = lifecycleWithOrders([{ customerId: "customer-a", orderId: "ORD-A", orderStatus: "SHIPPED" }, { customerId: "customer-b", orderId: "ORD-B", orderStatus: "DELIVERED" }]);
  assert.equal((await customerOrders("customer-a", "ord-a")).orderId, "ORD-A");
  assert.equal(await customerOrders("customer-a", "ORD-B"), null);
});

test("tracking lists one or several orders for only the matching customer", async () => {
  const { customerOrders } = lifecycleWithOrders([{ customerId: "customer-a", orderId: "ORD-1" }, { customerId: "customer-a", orderId: "ORD-2" }, { customerId: "customer-b", orderId: "ORD-3" }]);
  assert.deepEqual((await customerOrders("customer-a")).map((order) => order.orderId), ["ORD-1", "ORD-2"]);
});
