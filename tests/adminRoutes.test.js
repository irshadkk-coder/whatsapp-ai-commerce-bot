const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFresh } = require("./helpers/mockModule");

test("Admin order status tests", async (t) => {
  let savedOrder = null;
  const mockOrder = {
    _id: "order-1",
    paymentMethod: "ONLINE",
    paymentStatus: "PENDING",
    orderStatus: "PENDING",
    save: async function() { savedOrder = this; return this; }
  };

  const { canTransition, deliveryEstimateDate, formatDate } = require("../src/services/orderLifecycleService");

  const adminRoutes = loadFresh("../../src/routes/adminRoutes.js", {
    "../models/Order": {
      findById: async (id) => (id === mockOrder._id ? mockOrder : null)
    },
    "../models/Admin": {},
    "../models/Customer": {},
    "../models/Conversation": {},
    "../models/Message": {},
    "../models/Product": {},
    "../services/whatsappService": { sendWhatsAppText: async () => {} },
    "../services/orderLifecycleService": { canTransition, deliveryEstimateDate, formatDate },
    "../middleware/adminAuth": { requireAdmin: (req, res, next) => next(), publicAdmin: (admin) => admin },
  });

  const patchHandler = adminRoutes.stack.find(l => l.route && l.route.path === '/orders/:id/status' && l.route.methods.patch).route.stack[0].handle;
  const shippingHandler = adminRoutes.stack.find(l => l.route && l.route.path === '/orders/:id/shipping' && l.route.methods.patch).route.stack[0].handle;

  function createRes() {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.body = data; return res; };
    return res;
  }

  await t.test("1. ONLINE + PENDING payment: admin tries PENDING -> CONFIRMED => rejected", async () => {
    mockOrder.paymentMethod = "ONLINE";
    mockOrder.paymentStatus = "PENDING";
    mockOrder.orderStatus = "PENDING";
    savedOrder = null;

    const req = { params: { id: "order-1" }, body: { status: "CONFIRMED" } };
    const res = createRes();
    
    await patchHandler(req, res);
    
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.success, false);
    assert.equal(savedOrder, null, "Order should not be saved");
    assert.equal(mockOrder.orderStatus, "PENDING", "Order should remain PENDING");
  });

  await t.test("2. ONLINE + FAILED payment: admin tries PENDING -> CONFIRMED => rejected", async () => {
    mockOrder.paymentMethod = "ONLINE";
    mockOrder.paymentStatus = "FAILED";
    mockOrder.orderStatus = "PENDING";
    savedOrder = null;

    const req = { params: { id: "order-1" }, body: { status: "CONFIRMED" } };
    const res = createRes();
    
    await patchHandler(req, res);
    
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.success, false);
    assert.equal(savedOrder, null, "Order should not be saved");
  });

  await t.test("3. ONLINE + PAID: admin confirms => allowed according to existing lifecycle", async () => {
    mockOrder.paymentMethod = "ONLINE";
    mockOrder.paymentStatus = "PAID";
    mockOrder.orderStatus = "PENDING";
    savedOrder = null;

    const req = { params: { id: "order-1" }, body: { status: "CONFIRMED" } };
    const res = createRes();
    
    await patchHandler(req, res);
    
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(savedOrder.orderStatus, "CONFIRMED", "Order should be saved and CONFIRMED");
    assert.equal(savedOrder.paymentStatus, "PAID", "paymentStatus should not be modified");
  });

  await t.test("4. COD + COD: admin confirms => existing behavior still works", async () => {
    mockOrder.paymentMethod = "COD";
    mockOrder.paymentStatus = "COD";
    mockOrder.orderStatus = "PENDING";
    savedOrder = null;

    const req = { params: { id: "order-1" }, body: { status: "CONFIRMED" } };
    const res = createRes();
    
    await patchHandler(req, res);
    
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(savedOrder.orderStatus, "CONFIRMED");
  });

  await t.test("5. Admin cannot modify paymentStatus through the order-status endpoint", async () => {
    mockOrder.paymentMethod = "COD";
    mockOrder.paymentStatus = "COD";
    mockOrder.orderStatus = "PENDING";
    savedOrder = null;

    const req = { params: { id: "order-1" }, body: { status: "CONFIRMED", paymentStatus: "PAID" } };
    const res = createRes();
    
    await patchHandler(req, res);
    
    assert.equal(res.statusCode, 200);
    assert.equal(savedOrder.paymentStatus, "COD", "paymentStatus must not be modifiable via this endpoint");
  });

  await t.test("6. Admin cannot mark an unpaid ONLINE order as PAID", async () => {
    mockOrder.paymentMethod = "ONLINE";
    mockOrder.paymentStatus = "PENDING";
    mockOrder.orderStatus = "PENDING";
    savedOrder = null;

    const req = { params: { id: "order-1" }, body: { status: "CONFIRMED", paymentStatus: "PAID" } };
    const res = createRes();
    
    await patchHandler(req, res);
    
    assert.equal(res.statusCode, 409);
    assert.equal(savedOrder, null);
    assert.equal(mockOrder.paymentStatus, "PENDING", "paymentStatus must not be modified");
  });

  await t.test("7. Existing lifecycle tests remain passing (e.g. canceling)", async () => {
    mockOrder.paymentMethod = "ONLINE";
    mockOrder.paymentStatus = "PENDING";
    mockOrder.orderStatus = "PENDING";
    savedOrder = null;

    const req = { params: { id: "order-1" }, body: { status: "CANCELLED" } };
    const res = createRes();
    
    await patchHandler(req, res);
    
    assert.equal(res.statusCode, 200);
    assert.equal(savedOrder.orderStatus, "CANCELLED");
  });

  await t.test("8. Admin can set shipping fields (carrier, trackingNumber, estimatedDeliveryDate)", async () => {
    mockOrder.carrier = undefined;
    mockOrder.trackingNumber = undefined;
    mockOrder.estimatedDeliveryDate = undefined;
    mockOrder.orderStatus = "CONFIRMED";
    mockOrder.paymentStatus = "PAID";
    savedOrder = null;

    const req = {
      params: { id: "order-1" },
      body: { carrier: "Blue Dart", trackingNumber: "BD12345", estimatedDeliveryDate: "2026-10-15" }
    };
    const res = createRes();
    await shippingHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(savedOrder.carrier, "Blue Dart");
    assert.equal(savedOrder.trackingNumber, "BD12345");
    assert.equal(savedOrder.estimatedDeliveryDate.toISOString().slice(0, 10), "2026-10-15");
    assert.equal(savedOrder.orderStatus, "CONFIRMED", "orderStatus must not change");
    assert.equal(savedOrder.paymentStatus, "PAID", "paymentStatus must not change");
  });

  await t.test("9. Admin can clear estimatedDeliveryDate", async () => {
    mockOrder.estimatedDeliveryDate = new Date("2026-10-15T00:00:00.000Z");
    savedOrder = null;

    const req = { params: { id: "order-1" }, body: { estimatedDeliveryDate: "" } };
    const res = createRes();
    await shippingHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(savedOrder.estimatedDeliveryDate, null);
  });

  await t.test("10. Invalid estimatedDeliveryDate format is rejected", async () => {
    savedOrder = null;
    const req = { params: { id: "order-1" }, body: { estimatedDeliveryDate: "15-10-2026" } };
    const res = createRes();
    await shippingHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(savedOrder, null);
  });

  await t.test("11. Carrier or trackingNumber exceeding 120 chars is rejected", async () => {
    savedOrder = null;
    const req = { params: { id: "order-1" }, body: { carrier: "a".repeat(121) } };
    const res = createRes();
    await shippingHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(savedOrder, null);
  });

  await t.test("12. Empty shipping request with no fields returns 400", async () => {
    savedOrder = null;
    const req = { params: { id: "order-1" }, body: {} };
    const res = createRes();
    await shippingHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(savedOrder, null);
  });

  await t.test("13. Shipping update for non-existent order returns 404", async () => {
    const req = { params: { id: "non-existent" }, body: { carrier: "DHL" } };
    const res = createRes();
    await shippingHandler(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.success, false);
  });
});

