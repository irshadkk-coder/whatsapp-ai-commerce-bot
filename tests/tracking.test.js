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

test("trackingText includes payment info, status, carrier/tracking for shipped, and estimated delivery", () => {
  const { trackingText } = lifecycleWithOrders([]);
  const shippedOrder = {
    orderId: "ORD-12345678-ABCD",
    productName: "Air Fryer",
    quantity: 1,
    paymentStatus: "PAID",
    orderStatus: "SHIPPED",
    carrier: "Blue Dart",
    trackingNumber: "BD987654321",
    shippedAt: new Date("2026-10-01T10:00:00.000Z"),
    estimatedDeliveryDate: new Date("2026-10-05T00:00:00.000Z"),
  };
  const text = trackingText(shippedOrder);
  assert.match(text, /ORD-12345678-ABCD/);
  assert.match(text, /Air Fryer/);
  assert.match(text, /💳 Payment: Paid/);
  assert.match(text, /🚚 Your order has been shipped/);
  assert.match(text, /Blue Dart/);
  assert.match(text, /BD987654321/);
  assert.match(text, /05 Oct 2026/);
});

test("trackingText handles delivered order with delivered date and hides estimated delivery", () => {
  const { trackingText } = lifecycleWithOrders([]);
  const deliveredOrder = {
    orderId: "ORD-12345678-ABCD",
    productName: "Air Fryer",
    quantity: 2,
    paymentStatus: "COD",
    orderStatus: "DELIVERED",
    deliveredAt: new Date("2026-10-04T12:00:00.000Z"),
    estimatedDeliveryDate: new Date("2026-10-05T00:00:00.000Z"),
  };
  const text = trackingText(deliveredOrder);
  assert.match(text, /💳 Payment: Cash on Delivery/);
  assert.match(text, /🎉 Your order has been delivered/);
  assert.match(text, /Delivered: 04 Oct 2026/);
  assert.doesNotMatch(text, /📅 Estimated Delivery/);
});

test("deliveryDateText shows estimated delivery date and shipping note for confirmed order", () => {
  const { deliveryDateText } = lifecycleWithOrders([]);
  const order = {
    orderId: "ORD-12345678-ABCD",
    productName: "Smart Watch",
    orderStatus: "CONFIRMED",
    estimatedDeliveryDate: new Date("2026-10-08T00:00:00.000Z"),
  };
  const text = deliveryDateText(order);
  assert.match(text, /📦 Delivery Update/);
  assert.match(text, /#ORD-12345678-ABCD/);
  assert.match(text, /📅 Estimated Delivery:\s*08 Oct 2026/);
  assert.match(text, /We'll update you when your order is shipped/);
});

test("deliveryDateText handles missing estimated delivery date with graceful fallback", () => {
  const { deliveryDateText } = lifecycleWithOrders([]);
  const order = {
    orderId: "ORD-12345678-ABCD",
    productName: "Smart Watch",
    orderStatus: "PROCESSING",
  };
  const text = deliveryDateText(order);
  assert.match(text, /The estimated delivery date has not been updated yet/);
  assert.match(text, /We'll update you when your order is shipped/);
});

test("deliveryDateText handles cancelled order gracefully without delivery date", () => {
  const { deliveryDateText } = lifecycleWithOrders([]);
  const order = {
    orderId: "ORD-12345678-ABCD",
    productName: "Smart Watch",
    orderStatus: "CANCELLED",
    estimatedDeliveryDate: new Date("2026-10-08T00:00:00.000Z"),
  };
  const text = deliveryDateText(order);
  assert.match(text, /This order has been cancelled and will not be delivered/);
  assert.doesNotMatch(text, /08 Oct 2026/);
});

test("deliveryDateText handles delivered order", () => {
  const { deliveryDateText } = lifecycleWithOrders([]);
  const order = {
    orderId: "ORD-12345678-ABCD",
    productName: "Smart Watch",
    orderStatus: "DELIVERED",
    deliveredAt: new Date("2026-10-04T12:00:00.000Z"),
  };
  const text = deliveryDateText(order);
  assert.match(text, /🎉 Your order has been delivered on 04 Oct 2026!/);
});

