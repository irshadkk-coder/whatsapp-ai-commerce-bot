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
});
