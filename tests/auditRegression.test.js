const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const adminRoutes = fs.readFileSync(path.join(__dirname, "../src/routes/adminRoutes.js"), "utf8");

test("payment-verification state has no YES-to-PAID transition", () => {
  const paymentState = server.slice(server.indexOf('if (conversation.currentStep === "AWAITING_PAYMENT_VERIFICATION")'), server.indexOf('if (conversation.currentStep === "AWAITING_PAYMENT_METHOD")'));
  assert.doesNotMatch(paymentState, /paymentStatus\s*=\s*["']PAID/);
  assert.doesNotMatch(paymentState, /orderStatus\s*=\s*["']CONFIRMED/);
});

test("payment webhook handling retains explicit failure and retry paths", () => {
  assert.match(server, /event\.event === "payment\.failed"/);
  assert.match(server, /paymentStatus:\s*"FAILED"/);
  const paymentState = server.slice(server.indexOf('if (conversation.currentStep === "AWAITING_PAYMENT_VERIFICATION")'), server.indexOf('if (conversation.currentStep === "AWAITING_PAYMENT_METHOD")'));
  assert.match(paymentState, /isPaymentRetryRequest\(text\)/);
});

test("[KNOWN ISSUE] failed ONLINE link then COD cannot create a second order", () => {
  const paymentMethod = server.slice(server.indexOf('if (conversation.currentStep === "AWAITING_PAYMENT_METHOD")'), server.indexOf('if (conversation.currentStep === "AWAITING_EDIT_SELECTION")'));
  assert.match(paymentMethod, /if \(order\) .*paymentMethod.*COD/s, "existing pending ONLINE order should be reused or cancelled before COD is created");
});

test("admin cannot confirm an unpaid pending online order", () => {
  const lifecycleRoute = adminRoutes.slice(adminRoutes.indexOf('router.patch("/orders/:id/status"'));
  assert.match(lifecycleRoute, /paymentStatus.*PAID[\s\S]*PENDING.*CONFIRMED|PENDING.*CONFIRMED[\s\S]*paymentStatus.*PAID/, "admin transition must guard payment status before PENDING to CONFIRMED");
});
