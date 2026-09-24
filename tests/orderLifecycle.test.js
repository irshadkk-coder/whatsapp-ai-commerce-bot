const test = require("node:test");
const assert = require("node:assert/strict");
const { canCancelOrder, canTransition, deliveryEstimateDate, trackingText } = require("../src/services/orderLifecycleService");

test("order lifecycle permits only valid forward transitions", () => {
  for (const [from, to] of [["PENDING", "CONFIRMED"], ["CONFIRMED", "PROCESSING"], ["PROCESSING", "SHIPPED"], ["SHIPPED", "DELIVERED"]]) assert.equal(canTransition(from, to), true);
  for (const [from, to] of [["SHIPPED", "CANCELLED"], ["DELIVERED", "CANCELLED"], ["CANCELLED", "CONFIRMED"]]) assert.equal(canTransition(from, to), false);
});

test("only pending, confirmed, and processing orders can be cancelled", () => {
  for (const status of ["PENDING", "CONFIRMED", "PROCESSING"]) assert.equal(canCancelOrder({ orderStatus: status }), true);
  for (const status of ["SHIPPED", "DELIVERED", "CANCELLED"]) assert.equal(canCancelOrder({ orderStatus: status }), false);
});

test("tracking includes status and shipment information without external calls", () => {
  const text = trackingText({ orderId: "ORD-1", productName: "Board", quantity: 1, orderStatus: "SHIPPED", carrier: "Carrier", trackingNumber: "TRACK-1", shippedAt: new Date("2026-01-02T00:00:00Z") });
  assert.match(text, /ORD-1/); assert.match(text, /Carrier/); assert.match(text, /TRACK-1/);
});

test("delivery estimate uses the configured safe default", () => {
  delete process.env.DELIVERY_ESTIMATE_DAYS;
  assert.equal(deliveryEstimateDate(new Date("2026-01-01T00:00:00Z")).toISOString().slice(0, 10), "2026-01-06");
});
