const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness, document } = require("./helpers/serverHarness");

function product() { return { productId: "P-1", name: "Plate Organizer", price: 499, stock: 3, isActive: true, cod: true, category: "Kitchen" }; }

test("payment status question with no recent orders", async () => {
  const h = createHarness(); 
  h.data.products = [product()];
  h.data.mockCustomerOrders = [];
  
  await h.receive("payment status");
  assert.match(h.data.replies.at(-1), /couldn't find any recent orders/);
});

test("payment status question with pending payment", async () => {
  const h = createHarness(); 
  h.data.products = [product()];
  h.data.mockCustomerOrders = [{ orderId: "ORD-1", paymentStatus: "PENDING" }];
  
  await h.receive("did my payment go through");
  assert.match(h.data.replies.at(-1), /not yet been verified/);
  assert.equal(h.data.geminiCalls, 0);
});

test("payment status question with successful payment", async () => {
  const h = createHarness(); 
  h.data.products = [product()];
  h.data.mockCustomerOrders = [{ orderId: "ORD-2", paymentStatus: "PAID", productName: "Plate Organizer", quantity: 1, totalAmount: 499 }];
  
  await h.receive("payment successful");
  assert.match(h.data.replies.at(-1), /Payment Successful!/);
  assert.equal(h.data.geminiCalls, 0);
});

test("payment status question with failed payment", async () => {
  const h = createHarness(); 
  h.data.products = [product()];
  h.data.mockCustomerOrders = [{ orderId: "ORD-3", paymentStatus: "FAILED" }];
  
  await h.receive("I paid");
  assert.match(h.data.replies.at(-1), /payment attempt failed/);
  assert.equal(h.data.geminiCalls, 0);
});

test("payment status question with multiple orders", async () => {
  const h = createHarness(); 
  h.data.products = [product()];
  h.data.mockCustomerOrders = [{ orderId: "ORD-1", paymentStatus: "PENDING" }, { orderId: "ORD-2", paymentStatus: "PAID" }];
  
  await h.receive("payment done");
  assert.match(h.data.replies.at(-1), /Your recent orders/);
  assert.match(h.data.replies.at(-1), /ORD-1/);
  assert.match(h.data.replies.at(-1), /ORD-2/);
  assert.equal(h.data.geminiCalls, 0);
});

test("order confirmed question uses deterministic tracking", async () => {
  const h = createHarness(); 
  h.data.products = [product()];
  h.data.mockCustomerOrders = [{ orderId: "ORD-1" }];
  
  await h.receive("is my order confirmed");
  assert.match(h.data.replies.at(-1), /tracking ORD-1/);
  assert.equal(h.data.geminiCalls, 0);
});

test("payment status question while AWAITING_PAYMENT_VERIFICATION resolves via intent", async () => {
  const h = createHarness(); 
  h.data.products = [product()];
  h.data.conversation = document({ customerId: "customer-1", whatsappId: "919999999999", status: "BOT_ACTIVE", currentStep: "AWAITING_PAYMENT_VERIFICATION", pendingOrderId: "ORD-1" });
  h.data.mockCustomerOrders = [{ orderId: "ORD-1", paymentStatus: "PENDING" }];
  
  await h.receive("payment successful");
  assert.match(h.data.replies.at(-1), /not yet been verified/);
  // Intent did not change paymentStatus to PAID
  assert.equal(h.data.orders.length, 0);
});
