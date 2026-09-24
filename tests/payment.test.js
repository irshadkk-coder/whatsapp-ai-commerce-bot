const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { verifyWebhookSignature } = require("../src/services/paymentService");

test("payment verification accepts only a valid HMAC for the exact raw body", () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = "test-secret";
  const body = Buffer.from('{"event":"payment.captured"}');
  const signature = crypto.createHmac("sha256", "test-secret").update(body).digest("hex");
  assert.equal(verifyWebhookSignature(body, signature), true);
  assert.equal(verifyWebhookSignature(body, "invalid"), false);
  assert.equal(verifyWebhookSignature(Buffer.from("{}"), signature), false);
});

test("payment links reject an invalid amount before contacting Razorpay", async () => {
  const { createPaymentLink } = require("../src/services/paymentService");
  await assert.rejects(createPaymentLink({ totalAmount: 0 }), /Invalid payment amount/);
});
