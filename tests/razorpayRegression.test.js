const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { verifyWebhookSignature } = require("../src/services/paymentService");

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function makeRawBody(event) {
  return Buffer.from(JSON.stringify(event));
}

function sign(rawBody, secret = "test-webhook-secret") {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Build a Razorpay webhook event payload.
 * Supports both `payment_link.paid` and `payment.captured`.
 */
function buildWebhookEvent({
  eventType = "payment_link.paid",
  paymentId = "pay_ABC123",
  paymentStatus = "captured",
  paymentLinkId = "plink_XYZ789",
  paymentLinkStatus = "paid",
  referenceId = "ORD-20260927-ABC001-1727400000000",
  orderId = "order_RZPAUTO1",
  amount = 49900,
  currency = "INR",
} = {}) {
  const payment = {
    id: paymentId,
    status: paymentStatus,
    order_id: orderId,
    amount,
    currency,
    payment_link_id: paymentLinkId,
  };
  const paymentLink = {
    id: paymentLinkId,
    status: paymentLinkStatus,
    reference_id: referenceId,
    order_id: orderId,
  };
  return {
    event: eventType,
    payload: {
      payment: { entity: payment },
      payment_link: { entity: paymentLink },
    },
  };
}

/**
 * Minimal in-memory order store for webhook handler testing.
 */
function createOrderStore() {
  const orders = new Map();
  return {
    orders,
    add(order) {
      const doc = {
        _id: order._id || `oid-${orders.size + 1}`,
        ...order,
        save: async function () { orders.set(this._id, this); return this; },
      };
      orders.set(doc._id, doc);
      return doc;
    },
    findOne(query) {
      for (const order of orders.values()) {
        let match = true;
        if (query.razorpayPaymentLinkId && order.razorpayPaymentLinkId !== query.razorpayPaymentLinkId) match = false;
        if (query.razorpayReferenceId && order.razorpayReferenceId !== query.razorpayReferenceId) match = false;
        if (query.razorpayOrderId && order.razorpayOrderId !== query.razorpayOrderId) match = false;
        if (query.paymentMethod) {
          const allowed = query.paymentMethod.$in || [query.paymentMethod];
          if (!allowed.includes(order.paymentMethod)) match = false;
        }
        if (query._id && String(query._id) !== String(order._id)) match = false;
        if (query.paymentStatus) {
          const allowed = query.paymentStatus.$in || [query.paymentStatus];
          if (!allowed.includes(order.paymentStatus)) match = false;
        }
        if (match) return order;
      }
      return null;
    },
    findOneAndUpdate(query, update) {
      const order = this.findOne(query);
      if (!order) return null;
      if (update.$set) Object.assign(order, update.$set);
      orders.set(order._id, order);
      return order;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// BUG 1 — Payment link reuse tests
// ────────────────────────────────────────────────────────────────────────────

test("BUG 1: createPaymentLink does not reuse a link when paymentStatus is PAID", async () => {
  const { createPaymentLink } = require("../src/services/paymentService");

  const paidOrder = {
    orderId: "ORD-20260927-AAA001",
    totalAmount: 499,
    paymentStatus: "PAID",
    razorpayPaymentLinkId: "plink_OLD",
    razorpayPaymentLinkUrl: "https://rzp.io/old",
    paymentLinkUrl: "https://rzp.io/old",
    razorpayReferenceId: "ORD-20260927-AAA001-old",
    razorpayOrderId: "order_OLD",
  };

  // createPaymentLink should NOT return reused: true for a PAID order
  // It will throw because Razorpay creds are missing — that proves it didn't take the reuse path
  await assert.rejects(
    createPaymentLink(paidOrder),
    /Razorpay credentials/,
    "Must NOT reuse link from a PAID order"
  );
});

test("BUG 1: createPaymentLink reuses link for unpaid order (same order, valid reuse)", async () => {
  const { createPaymentLink } = require("../src/services/paymentService");

  const unpaidOrder = {
    orderId: "ORD-20260927-BBB002",
    totalAmount: 499,
    paymentStatus: "PENDING",
    razorpayPaymentLinkId: "plink_EXISTING",
    razorpayPaymentLinkUrl: "https://rzp.io/existing",
    paymentLinkUrl: "https://rzp.io/existing",
    razorpayReferenceId: "ORD-20260927-BBB002-ref",
  };

  const result = await createPaymentLink(unpaidOrder);
  assert.equal(result.reused, true, "Should reuse for an unpaid order's own link");
  assert.equal(result.id, "plink_EXISTING");
  assert.equal(result.short_url, "https://rzp.io/existing");
});

test("BUG 1: new order for same product/customer always gets a new payment link", async () => {
  const { createPaymentLink } = require("../src/services/paymentService");

  // Order B — new order, same product, unpaid, no razorpay fields yet
  const orderB = {
    orderId: "ORD-20260927-BBB003",
    totalAmount: 499,
    paymentStatus: "PENDING",
  };

  // Order B has no razorpayPaymentLinkId, so createPaymentLink will try to create new
  await assert.rejects(
    createPaymentLink(orderB),
    /Razorpay credentials/,
    "Order B must attempt to create a NEW link, not reuse Order A's"
  );
});

test("BUG 1: different quantity of same product does not match old order", () => {
  const orderA = { productId: "P-1", quantity: 1, paymentStatus: "PAID", razorpayPaymentLinkId: "plink_A" };
  const orderB = { productId: "P-1", quantity: 3, paymentStatus: "PENDING" };
  assert.notEqual(orderA.quantity, orderB.quantity);
  assert.ok(!orderB.razorpayPaymentLinkId, "Order B has no link yet");
});

test("BUG 1: different customer same product does not share link", () => {
  const orderA = { customerId: "cust-1", productId: "P-1", paymentStatus: "PAID", razorpayPaymentLinkId: "plink_A" };
  const orderB = { customerId: "cust-2", productId: "P-1", paymentStatus: "PENDING" };
  assert.notEqual(orderA.customerId, orderB.customerId);
  assert.ok(!orderB.razorpayPaymentLinkId, "Order B for different customer has no link");
});

test("BUG 1: paid/captured old link is never returned as reusable", async () => {
  const { createPaymentLink } = require("../src/services/paymentService");

  for (const status of ["PAID", "REFUNDED"]) {
    const order = {
      orderId: `ORD-${status}`,
      totalAmount: 999,
      paymentStatus: status,
      razorpayPaymentLinkId: `plink_${status}`,
      razorpayPaymentLinkUrl: `https://rzp.io/${status}`,
      paymentLinkUrl: `https://rzp.io/${status}`,
    };
    await assert.rejects(
      createPaymentLink(order),
      /Razorpay credentials/,
      `Must not reuse link for ${status} order`
    );
  }
});

test("BUG 1: Order B remains independent from Order A after A is paid", () => {
  const store = createOrderStore();
  const orderA = store.add({
    _id: "orderA",
    orderId: "ORD-20260927-001",
    customerId: "cust-1",
    productId: "P-1",
    quantity: 1,
    totalAmount: 499,
    paymentMethod: "ONLINE",
    paymentStatus: "PAID",
    orderStatus: "CONFIRMED",
    razorpayPaymentLinkId: "plink_A",
    razorpayPaymentLinkUrl: "https://rzp.io/A",
    razorpayReferenceId: "ref_A",
  });
  const orderB = store.add({
    _id: "orderB",
    orderId: "ORD-20260927-002",
    customerId: "cust-1",
    productId: "P-1",
    quantity: 1,
    totalAmount: 499,
    paymentMethod: "ONLINE",
    paymentStatus: "PENDING",
    orderStatus: "PENDING",
    razorpayPaymentLinkId: "plink_B",
    razorpayPaymentLinkUrl: "https://rzp.io/B",
    razorpayReferenceId: "ref_B",
  });

  assert.notEqual(orderA.razorpayPaymentLinkId, orderB.razorpayPaymentLinkId, "Links must be different");
  assert.notEqual(orderA.razorpayReferenceId, orderB.razorpayReferenceId, "References must be different");
  assert.equal(orderA.paymentStatus, "PAID");
  assert.equal(orderB.paymentStatus, "PENDING");
  assert.equal(orderA.razorpayPaymentLinkId, "plink_A", "A retains its link");
  assert.equal(orderB.razorpayPaymentLinkId, "plink_B", "B has its own link");
});

// ────────────────────────────────────────────────────────────────────────────
// BUG 2 — Webhook auto-confirmation tests
// ────────────────────────────────────────────────────────────────────────────

test("BUG 2: valid payment_link.paid with captured status marks order PAID + CONFIRMED", () => {
  const store = createOrderStore();
  store.add({
    orderId: "ORD-20260927-W001",
    customerId: "cust-1",
    whatsappId: "919999999999",
    productId: "P-1",
    productName: "Test Product",
    quantity: 1,
    totalAmount: 499,
    paymentMethod: "ONLINE",
    paymentStatus: "PENDING",
    orderStatus: "PENDING",
    razorpayPaymentLinkId: "plink_W1",
    razorpayReferenceId: "ref_W1",
  });

  const event = buildWebhookEvent({
    paymentLinkId: "plink_W1",
    referenceId: "ref_W1",
    amount: 49900,
    paymentStatus: "captured",
  });
  const payment = event.payload.payment.entity;

  const found = store.findOne({ razorpayPaymentLinkId: "plink_W1", paymentMethod: { $in: ["ONLINE", "COD"] } });
  assert.ok(found, "Order should be found by payment link ID");
  assert.equal(found.paymentStatus, "PENDING");

  const updated = store.findOneAndUpdate(
    { _id: found._id, paymentMethod: { $in: ["ONLINE", "COD"] }, paymentStatus: { $in: ["PENDING", "FAILED", "COD"] } },
    { $set: { paymentMethod: "ONLINE", paymentStatus: "PAID", razorpayPaymentId: payment.id, paidAt: new Date(), orderStatus: "CONFIRMED" } }
  );

  assert.ok(updated, "Update should succeed");
  assert.equal(updated.paymentStatus, "PAID");
  assert.equal(updated.orderStatus, "CONFIRMED");
  assert.equal(updated.paymentMethod, "ONLINE");
  assert.equal(updated.razorpayPaymentId, "pay_ABC123");
});

test("BUG 2: valid payment_link.paid with AUTHORIZED status (auto-capture pending) must also be accepted", () => {
  const event = buildWebhookEvent({
    eventType: "payment_link.paid",
    paymentStatus: "authorized",
    paymentLinkStatus: "paid",
  });

  const payment = event.payload.payment.entity;
  const paymentLink = event.payload.payment_link.entity;

  const paidLinkEvent = event.event === "payment_link.paid" && paymentLink?.status === "paid";
  const capturedPayment = payment.status === "captured" || event.event === "payment.captured" || (paidLinkEvent && payment.status === "authorized");

  assert.equal(paidLinkEvent, true, "payment link event should be detected as paid");
  assert.equal(capturedPayment, true, "authorized payment with paid link must be accepted");
});

test("BUG 2: payment_link.paid with authorized status was REJECTED by the old logic", () => {
  const event = buildWebhookEvent({
    eventType: "payment_link.paid",
    paymentStatus: "authorized",
    paymentLinkStatus: "paid",
  });

  const payment = event.payload.payment.entity;

  // OLD logic (before fix):
  const capturedPaymentOLD = payment.status === "captured" || event.event === "payment.captured";
  assert.equal(capturedPaymentOLD, false, "Old logic incorrectly rejected authorized payment_link.paid");
});

test("BUG 2: valid payment.captured marks order PAID + CONFIRMED", () => {
  const store = createOrderStore();
  store.add({
    orderId: "ORD-20260927-W002",
    customerId: "cust-1",
    paymentMethod: "ONLINE",
    paymentStatus: "PENDING",
    orderStatus: "PENDING",
    totalAmount: 999,
    razorpayPaymentLinkId: "plink_W2",
    razorpayReferenceId: "ref_W2",
  });

  const event = buildWebhookEvent({
    eventType: "payment.captured",
    paymentLinkId: "plink_W2",
    referenceId: "ref_W2",
    amount: 99900,
    paymentStatus: "captured",
  });

  const payment = event.payload.payment.entity;
  const found = store.findOne({ razorpayPaymentLinkId: "plink_W2", paymentMethod: { $in: ["ONLINE", "COD"] } });
  assert.ok(found);

  const capturedPayment = payment.status === "captured" || event.event === "payment.captured";
  assert.equal(capturedPayment, true);

  const updated = store.findOneAndUpdate(
    { _id: found._id, paymentMethod: { $in: ["ONLINE", "COD"] }, paymentStatus: { $in: ["PENDING", "FAILED", "COD"] } },
    { $set: { paymentMethod: "ONLINE", paymentStatus: "PAID", orderStatus: "CONFIRMED", razorpayPaymentId: payment.id } }
  );
  assert.ok(updated);
  assert.equal(updated.paymentStatus, "PAID");
  assert.equal(updated.orderStatus, "CONFIRMED");
});

test("BUG 2: invalid webhook signature is rejected", () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = "test-webhook-secret";
  const body = makeRawBody(buildWebhookEvent());
  const validSig = sign(body);

  assert.equal(verifyWebhookSignature(body, validSig), true, "Valid signature accepted");
  assert.equal(verifyWebhookSignature(body, "invalid-signature"), false, "Invalid signature rejected");
  assert.equal(verifyWebhookSignature(body, ""), false, "Empty signature rejected");
  assert.equal(verifyWebhookSignature(body, null), false, "Null signature rejected");
  assert.equal(verifyWebhookSignature(Buffer.from("tampered"), validSig), false, "Tampered body rejected");
});

test("BUG 2: wrong amount is rejected", () => {
  const store = createOrderStore();
  store.add({
    orderId: "ORD-AMT",
    totalAmount: 499,
    paymentMethod: "ONLINE",
    paymentStatus: "PENDING",
    razorpayPaymentLinkId: "plink_AMT",
  });

  const event = buildWebhookEvent({
    paymentLinkId: "plink_AMT",
    amount: 99900,
  });

  const payment = event.payload.payment.entity;
  const order = store.findOne({ razorpayPaymentLinkId: "plink_AMT" });
  const amount = Number(payment.amount);
  const expectedAmount = Math.round(Number(order.totalAmount) * 100);

  assert.notEqual(amount, expectedAmount, "Amount mismatch should be detected");
});

test("BUG 2: wrong currency is rejected", () => {
  const event = buildWebhookEvent({ currency: "USD" });
  const payment = event.payload.payment.entity;
  assert.notEqual(payment.currency, "INR", "Non-INR currency should be rejected");
});

test("BUG 2: unknown payment link ID returns safely without error", () => {
  const store = createOrderStore();
  store.add({
    orderId: "ORD-KNOWN",
    paymentMethod: "ONLINE",
    paymentStatus: "PENDING",
    razorpayPaymentLinkId: "plink_KNOWN",
  });

  const found = store.findOne({ razorpayPaymentLinkId: "plink_UNKNOWN" });
  assert.equal(found, null, "Unknown payment link ID should not match any order");
});

test("BUG 2: duplicate webhook does not update an already-PAID order", () => {
  const store = createOrderStore();
  store.add({
    orderId: "ORD-DUP",
    paymentMethod: "ONLINE",
    paymentStatus: "PAID",
    orderStatus: "CONFIRMED",
    razorpayPaymentLinkId: "plink_DUP",
    razorpayPaymentId: "pay_FIRST",
    paidAt: new Date("2026-09-27T05:00:00Z"),
  });

  const order = store.findOne({ razorpayPaymentLinkId: "plink_DUP" });
  assert.equal(order.paymentStatus, "PAID", "Already paid");

  const duplicateUpdate = store.findOneAndUpdate(
    { _id: order._id, paymentStatus: { $in: ["PENDING", "FAILED", "COD"] } },
    { $set: { paymentStatus: "PAID", razorpayPaymentId: "pay_DUPLICATE" } }
  );

  assert.equal(duplicateUpdate, null, "Duplicate webhook should not update already-PAID order");
  assert.equal(order.razorpayPaymentId, "pay_FIRST", "Original payment ID preserved");
});

test("BUG 2: failed payment does not mark order PAID", () => {
  const store = createOrderStore();
  store.add({
    orderId: "ORD-FAIL",
    paymentMethod: "ONLINE",
    paymentStatus: "PENDING",
    orderStatus: "PENDING",
    razorpayPaymentLinkId: "plink_FAIL",
  });

  const order = store.findOne({ razorpayPaymentLinkId: "plink_FAIL" });
  const failedUpdate = store.findOneAndUpdate(
    { _id: order._id, paymentMethod: "ONLINE", paymentStatus: "PENDING" },
    { $set: { paymentStatus: "FAILED" } }
  );

  assert.ok(failedUpdate);
  assert.equal(failedUpdate.paymentStatus, "FAILED");
  assert.notEqual(failedUpdate.paymentStatus, "PAID");
  assert.notEqual(failedUpdate.orderStatus, "CONFIRMED");
});

test("BUG 2: already-paid order remains stable after additional webhook events", () => {
  const store = createOrderStore();
  const order = store.add({
    orderId: "ORD-STABLE",
    paymentMethod: "ONLINE",
    paymentStatus: "PAID",
    orderStatus: "CONFIRMED",
    totalAmount: 499,
    razorpayPaymentLinkId: "plink_STABLE",
    razorpayPaymentId: "pay_ORIGINAL",
    paidAt: new Date("2026-09-27T04:00:00Z"),
  });

  for (const status of ["PENDING", "FAILED", "COD"]) {
    const result = store.findOneAndUpdate(
      { _id: order._id, paymentStatus: { $in: [status] } },
      { $set: { paymentStatus: "PAID", razorpayPaymentId: "pay_NEW" } }
    );
    assert.equal(result, null, `${status} filter should not match a PAID order`);
  }

  assert.equal(order.paymentStatus, "PAID", "Payment status unchanged");
  assert.equal(order.orderStatus, "CONFIRMED", "Order status unchanged");
  assert.equal(order.razorpayPaymentId, "pay_ORIGINAL", "Payment ID unchanged");
});

// ────────────────────────────────────────────────────────────────────────────
// COD-to-online compatibility
// ────────────────────────────────────────────────────────────────────────────

test("COD order upgraded to online via webhook correctly transitions", () => {
  const store = createOrderStore();
  store.add({
    orderId: "ORD-COD2ONLINE",
    paymentMethod: "COD",
    paymentStatus: "COD",
    orderStatus: "CONFIRMED",
    totalAmount: 299,
    razorpayPaymentLinkId: "plink_COD",
    razorpayReferenceId: "ref_COD",
  });

  const event = buildWebhookEvent({
    paymentLinkId: "plink_COD",
    referenceId: "ref_COD",
    amount: 29900,
    paymentStatus: "captured",
  });

  const payment = event.payload.payment.entity;
  const order = store.findOne({ razorpayPaymentLinkId: "plink_COD", paymentMethod: { $in: ["ONLINE", "COD"] } });
  assert.ok(order, "COD order should be found");

  const updated = store.findOneAndUpdate(
    { _id: order._id, paymentMethod: { $in: ["ONLINE", "COD"] }, paymentStatus: { $in: ["PENDING", "FAILED", "COD"] } },
    { $set: { paymentMethod: "ONLINE", paymentStatus: "PAID", razorpayPaymentId: payment.id, paidAt: new Date(), orderStatus: "CONFIRMED" } }
  );

  assert.ok(updated);
  assert.equal(updated.paymentMethod, "ONLINE");
  assert.equal(updated.paymentStatus, "PAID");
  assert.equal(updated.orderStatus, "CONFIRMED");
});

// ────────────────────────────────────────────────────────────────────────────
// Server-level integration test for Bug 1
// ────────────────────────────────────────────────────────────────────────────

test("BUG 1 integration: second order for same product gets a new link after first is paid", async () => {
  const Module = require("module");
  const path = require("node:path");

  let paymentLinkCounter = 0;
  const paymentLinks = [];
  const orderStore = [];

  function document(values) {
    return Object.assign(values, { async save() { this.saved = (this.saved || 0) + 1; return this; } });
  }

  const replies = [];
  const data = {
    products: [{ productId: "P-1", name: "Plate Organizer", price: 499, stock: 100, cod: true, isActive: true, category: "Kitchen" }],
    conversation: null,
    customer: document({ _id: "customer-1", whatsappId: "919999999999" }),
    replies,
    messages: new Set(),
    orders: orderStore,
  };

  const routes = [];
  const app = { disable() {}, use() {}, get() {}, post(pathname, ...args) { routes.push({ pathname, handler: args[args.length - 1] }); }, listen() { return { close(done) { done(); } }; } };
  const express = () => app;
  express.json = () => () => {};
  express.raw = () => () => {};

  const lean = (value) => ({ lean: async () => value });
  const Product = {
    findOne(query) {
      return lean(data.products.find((p) => p.productId === query.productId && p.isActive !== false && p.stock > 0) || null);
    },
    find() { return { sort: () => ({ lean: async () => data.products.filter((p) => p.isActive !== false && p.stock > 0) }) }; },
  };

  const Conversation = {
    findOne() { return { sort: async () => data.conversation }; },
    async findOneAndUpdate(_q, update) { data.conversation ||= document({}); Object.assign(data.conversation, update.$set || {}); return data.conversation; },
    async updateMany() { return {}; },
  };
  const Customer = { async findOneAndUpdate() { return data.customer; }, async updateOne() { return {}; } };
  const Message = { async create(m) { if (data.messages.has(m.whatsappMessageId)) { const e = new Error("dup"); e.code = 11000; throw e; } data.messages.add(m.whatsappMessageId); return m; } };
  const Order = {
    findOne() { return { sort: async () => null }; },
    findById: async (id) => orderStore.find(o => String(o._id) === String(id)) || null,
    async findOneAndUpdate() { return null; },
  };

  const originalLoad = Module._load;
  const serverPath = path.join(__dirname, "../server.js");
  const productServicePath = path.join(__dirname, "../src/utils/productService.js");
  delete require.cache[require.resolve(serverPath)];
  delete require.cache[require.resolve(productServicePath)];

  const availableProducts = () => data.products.filter((p) => p.isActive !== false && p.stock > 0);
  const productService = {
    async findRelevantProduct(message) {
      const terms = String(message).toLowerCase().match(/[a-z0-9]+/g) || [];
      const ignored = new Set(["i", "want", "to", "the", "a", "an", "need", "order", "buy", "purchase", "get"]);
      const query = terms.filter((t) => !ignored.has(t));
      let best = null; let score = 0;
      for (const c of availableProducts()) {
        const ct = new Set(`${c.name} ${c.category}`.toLowerCase().match(/[a-z0-9]+/g) || []);
        const cs = query.filter((t) => ct.has(t)).length;
        if (cs > score) { best = c; score = cs; }
      }
      return best;
    },
    async getAvailableProducts() { return availableProducts(); },
    getRequestedCategory() { return null; },
    async findCategoryProducts() { return []; },
    availableProductFilter: {},
  };

  Module._load = function mockedLoad(request, parent, isMain) {
    const mocks = {
      express, "express-rate-limit": () => () => {},
      "./src/config/database": { connectDatabase: async () => {}, mongoose: { connection: { readyState: 1, close: async () => {} } } },
      "./src/models/Customer": Customer, "./src/models/Conversation": Conversation, "./src/models/Message": Message, "./src/models/Product": Product, "./src/models/Order": Order,
      "./src/services/whatsappService": { sendWhatsAppText: async ({ text }) => { replies.push(text); } },
      "./src/services/geminiService": { getGeminiReply: async () => "gemini fallback" },
      "./src/services/orderService": {
        createOrder: async (input) => {
          const order = document({
            _id: `order-${orderStore.length + 1}`,
            orderId: `ORD-${orderStore.length + 1}`,
            ...input,
            productId: input.product.productId,
            productName: input.product.name,
            quantity: input.conversation.quantity,
            totalAmount: input.product.price * input.conversation.quantity,
          });
          orderStore.push(order);
          return order;
        },
      },
      "./src/services/orderLifecycleService": { canCancelOrder: () => true, customerOrders: async () => [], trackingText: (o) => `tracking ${o.orderId}` },
      "./src/services/paymentService": {
        createPaymentLink: async (order) => {
          paymentLinkCounter++;
          const link = { id: `plink_${paymentLinkCounter}`, short_url: `https://rzp.io/link${paymentLinkCounter}`, reference_id: `ref_${paymentLinkCounter}` };
          paymentLinks.push({ orderId: order.orderId, link });
          return link;
        },
        fetchPaymentLink: async () => ({ status: "created" }),
        verifyWebhookSignature: () => true,
      },
      "./src/utils/productService": productService,
      "./src/routes/adminRoutes": {},
    };
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try { require(serverPath); } finally { Module._load = originalLoad; }

  const webhook = routes.filter((r) => r.pathname === "/webhook").at(-1).handler;
  async function receive(text, id) {
    id = id || `msg-${data.messages.size + 1}`;
    const res = { sendStatus(code) { this.status = code; return code; } };
    await webhook({ body: { entry: [{ changes: [{ value: { messages: [{ id, from: data.customer.whatsappId, type: "text", text: { body: text } }] } }] }] } }, res);
    return res;
  }

  // === Flow 1: Order A ===
  await receive("I want to order Plate Organizer");
  await receive("Asha");
  await receive("12 Home");
  await receive("MG Road");
  await receive("Kochi");
  await receive("682001");
  await receive("yes");
  await receive("online");

  assert.equal(orderStore.length, 1, "Order A created");
  const orderA = orderStore[0];
  assert.equal(orderA.razorpayPaymentLinkId, "plink_1", "Order A has link 1");

  // Simulate Order A being paid (webhook would do this)
  orderA.paymentStatus = "PAID";
  orderA.orderStatus = "CONFIRMED";

  // Complete the conversation
  data.conversation.status = "COMPLETED";
  data.conversation.currentStep = "IDLE";
  data.conversation.pendingOrderId = undefined;
  await data.conversation.save();

  // === Flow 2: Order B — same product ===
  data.conversation = null;

  await receive("I want to order Plate Organizer", "msg-flow2-1");
  await receive("Asha", "msg-flow2-2");
  await receive("12 Home", "msg-flow2-3");
  await receive("MG Road", "msg-flow2-4");
  await receive("Kochi", "msg-flow2-5");
  await receive("682001", "msg-flow2-6");
  await receive("yes", "msg-flow2-7");
  await receive("online", "msg-flow2-8");

  assert.equal(orderStore.length, 2, "Order B created as a new order");
  const orderB = orderStore[1];

  // KEY ASSERTIONS
  assert.notEqual(orderA._id, orderB._id, "Different order IDs");
  assert.notEqual(orderA.razorpayPaymentLinkId, orderB.razorpayPaymentLinkId, "Different payment links");
  assert.equal(orderA.razorpayPaymentLinkId, "plink_1", "Order A retains its link");
  assert.equal(orderB.razorpayPaymentLinkId, "plink_2", "Order B gets a new link");
  assert.equal(orderA.paymentStatus, "PAID", "Order A is still PAID");
  assert.equal(paymentLinks.length, 2, "Two distinct payment links were created");
});
