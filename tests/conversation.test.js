const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness, document } = require("./helpers/serverHarness");

function product(overrides = {}) { return { productId: "P-1", name: "Plate Organizer", price: 499, stock: 3, isActive: true, cod: true, category: "Kitchen", ...overrides }; }
function detailsConversation(overrides = {}) { return document({ customerId: "customer-1", whatsappId: "919999999999", status: "BOT_ACTIVE", currentStep: "IDLE", selectedProductId: "P-1", selectedProductName: "Plate Organizer", selectedProductPrice: 499, ...overrides }); }
function deliveryConversation(overrides = {}) { return detailsConversation({ currentStep: "AWAITING_CONFIRMATION", quantity: 1, customerName: "Asha", houseBuilding: "12 Home", area: "MG Road", district: "Kochi", pincode: "682001", ...overrides }); }

test("product details persist viewed product context without Gemini", async () => {
  const h = createHarness(); h.data.products = [product()];
  await h.receive("Plate Organizer");
  assert.equal(h.data.conversation.selectedProductId, "P-1");
  assert.equal(h.data.conversation.selectedProductName, "Plate Organizer");
  assert.match(h.data.replies.at(-1), /Reply YES to order/); assert.equal(h.data.geminiCalls, 0);
});

for (const message of ["YES", "yes", "okay", "ok", "I want it", "I want this", "order it", "order this", "I want to order this", "I need order this product", "I want this product", "I want to buy this item", "I need this product", "YES!", "YES.", "I want this!"]) {
  test(`viewed product intent '${message}' starts the existing delivery flow`, async () => {
    const h = createHarness(); h.data.products = [product()]; h.data.conversation = detailsConversation();
    await h.receive(message);
    assert.equal(h.data.conversation.currentStep, "AWAITING_DELIVERY_DETAILS");
    assert.equal(h.data.conversation.selectedProductId, "P-1");
    assert.ok(h.data.productLookups > 0); assert.equal(h.data.geminiCalls, 0);
  });
}

test("viewed product is reloaded and inactive or out-of-stock products cannot start an order", async () => {
  for (const unavailable of [product({ isActive: false }), product({ stock: 0 })]) {
    const h = createHarness(); h.data.products = [unavailable]; h.data.conversation = detailsConversation();
    await h.receive("YES");
    assert.equal(h.data.conversation.selectedProductId, undefined);
    assert.match(h.data.replies.at(-1), /no longer available/);
  }
});

test("YES is state-aware: confirmation advances to payment method", async () => {
  const h = createHarness(); h.data.products = [product()]; h.data.conversation = deliveryConversation();
  await h.receive("YES");
  assert.equal(h.data.conversation.currentStep, "AWAITING_PAYMENT_METHOD");
  assert.match(h.data.replies.at(-1), /Payment Method/);
});

test("COD and ONLINE use their existing order paths without real payment calls", async () => {
  const cod = createHarness(); cod.data.products = [product()]; cod.data.conversation = deliveryConversation();
  await cod.receive("YES"); await cod.receive("COD");
  assert.equal(cod.data.orders.length, 1); assert.equal(cod.data.orders[0].paymentMethod, "COD"); assert.equal(cod.data.conversation.currentStep, "IDLE");

  const online = createHarness(); online.data.products = [product()]; online.data.conversation = deliveryConversation();
  await online.receive("YES"); await online.receive("ONLINE");
  assert.equal(online.data.orders.length, 1); assert.equal(online.data.orders[0].paymentMethod, "ONLINE"); assert.equal(online.data.conversation.currentStep, "AWAITING_PAYMENT_VERIFICATION");
});

for (const message of ["YES", "I paid", "payment status"]) {
  test(`${message} during payment verification does not mark payment paid`, async () => {
    const h = createHarness(); h.data.products = [product()]; h.data.conversation = deliveryConversation({ currentStep: "AWAITING_PAYMENT_VERIFICATION", pendingOrderId: "order-1" });
    await h.receive(message);
    assert.equal(h.data.conversation.currentStep, "AWAITING_PAYMENT_VERIFICATION");
    assert.equal(h.data.orders.length, 0);
  });
}

test("delivery fields progress sequentially and invalid pincodes do not advance", async () => {
  const h = createHarness(); h.data.products = [product()]; h.data.conversation = detailsConversation({ currentStep: "AWAITING_DELIVERY_DETAILS", deliveryField: "NAME", quantity: 1 });
  for (const value of ["Asha", "12 Home", "MG Road", "Kochi"]) await h.receive(value);
  assert.equal(h.data.conversation.deliveryField, "PINCODE");
  for (const invalid of ["123", "12345", "1234567", "abcdef"]) { await h.receive(invalid); assert.equal(h.data.conversation.currentStep, "AWAITING_DELIVERY_DETAILS"); assert.equal(h.data.conversation.deliveryField, "PINCODE"); }
  await h.receive("682001"); assert.equal(h.data.conversation.currentStep, "AWAITING_CONFIRMATION");
});

test("duplicate WhatsApp message IDs are processed once", async () => {
  const h = createHarness(); h.data.products = [product()]; h.data.conversation = detailsConversation();
  await h.receive("YES", "duplicate-1"); const replyCount = h.data.replies.length;
  await h.receive("YES", "duplicate-1"); assert.equal(h.data.replies.length, replyCount);
});

test("human-required conversations do not automatically reply", async () => {
  const h = createHarness(); h.data.conversation = detailsConversation({ status: "HUMAN_REQUIRED" });
  await h.receive("hello"); assert.equal(h.data.replies.length, 0);
});

test("generic and category catalog requests bypass Gemini", async () => {
  const h = createHarness(); h.data.products = [product(), product({ productId: "J-1", name: "Premium Necklace", category: "Jewellery" })];
  await h.receive("show products"); assert.match(h.data.replies.at(-1), /Plate Organizer/);
  await h.receive("show jewellery"); assert.match(h.data.replies.at(-1), /Premium Necklace/);
  assert.equal(h.data.geminiCalls, 0);
});

test("EDIT selects and changes a field before producing an updated summary", async () => {
  const h = createHarness(); h.data.products = [product()]; h.data.conversation = deliveryConversation();
  await h.receive("EDIT"); assert.equal(h.data.conversation.currentStep, "AWAITING_EDIT_SELECTION");
  await h.receive("1"); assert.equal(h.data.conversation.editingField, "NAME");
  await h.receive("Meera"); assert.equal(h.data.conversation.customerName, "Meera"); assert.equal(h.data.conversation.currentStep, "AWAITING_CONFIRMATION");
});

test("invalid edited quantity remains in edit mode", async () => {
  const h = createHarness(); h.data.products = [product()]; h.data.conversation = deliveryConversation({ currentStep: "AWAITING_EDIT_VALUE", editingField: "QUANTITY" });
  await h.receive("0"); assert.equal(h.data.conversation.currentStep, "AWAITING_EDIT_VALUE");
  await h.receive("-1"); assert.equal(h.data.conversation.currentStep, "AWAITING_EDIT_VALUE");
});

for (const message of ["cancel order", "I don't want this", "I don't want this product"]) {
  test(`delivery cancellation '${message}' resets the active draft without consuming a field`, async () => {
    const h = createHarness(); h.data.products = [product()]; h.data.conversation = detailsConversation({ currentStep: "AWAITING_DELIVERY_DETAILS", deliveryField: "NAME", quantity: 1 });
    await h.receive(message);
    assert.equal(h.data.conversation.currentStep, "IDLE"); assert.equal(h.data.conversation.status, "CANCELLED");
    assert.equal(h.data.conversation.customerName, undefined); assert.match(h.data.replies.at(-1), /cancelled/);
  });
}

for (const message of ["I want another product", "need another product", "need other product", "change product", "different product", "show products"]) {
  test(`delivery product-change '${message}' clears the draft and shows catalogue`, async () => {
    const h = createHarness(); h.data.products = [product()]; h.data.conversation = detailsConversation({ currentStep: "AWAITING_DELIVERY_DETAILS", deliveryField: "NAME", quantity: 1 });
    await h.receive(message);
    assert.equal(h.data.conversation.currentStep, "IDLE"); assert.equal(h.data.conversation.status, "BOT_ACTIVE");
    assert.equal(h.data.conversation.selectedProductId, undefined); assert.equal(h.data.conversation.customerName, undefined);
    assert.match(h.data.replies.at(-1), /Plate Organizer/); assert.equal(h.data.geminiCalls, 0);
  });
}

test("delivery tracking intent is not consumed as a field and preserves the draft", async () => {
  const h = createHarness(); h.data.products = [product()]; h.data.conversation = detailsConversation({ currentStep: "AWAITING_DELIVERY_DETAILS", deliveryField: "NAME", quantity: 1 });
  await h.receive("track my order");
  assert.equal(h.data.conversation.currentStep, "AWAITING_DELIVERY_DETAILS"); assert.equal(h.data.conversation.deliveryField, "NAME"); assert.equal(h.data.conversation.customerName, undefined);
  assert.match(h.data.replies.at(-1), /couldn't find any orders/);
});

for (const state of ["AWAITING_EDIT_SELECTION", "AWAITING_EDIT_VALUE"]) {
  test(`priority intents are not consumed by ${state}`, async () => {
    const h = createHarness(); h.data.products = [product()]; h.data.conversation = deliveryConversation({ currentStep: state, editingField: state === "AWAITING_EDIT_VALUE" ? "NAME" : null });
    await h.receive("need another product");
    assert.equal(h.data.conversation.currentStep, "IDLE"); assert.equal(h.data.conversation.selectedProductId, undefined); assert.match(h.data.replies.at(-1), /Plate Organizer/);
  });

  test(`cancellation is not consumed by ${state}`, async () => {
    const h = createHarness(); h.data.products = [product()]; h.data.conversation = deliveryConversation({ currentStep: state, editingField: state === "AWAITING_EDIT_VALUE" ? "NAME" : null });
    await h.receive("I don't want this");
    assert.equal(h.data.conversation.currentStep, "IDLE"); assert.equal(h.data.conversation.status, "CANCELLED"); assert.equal(h.data.conversation.customerName, undefined);
  });

  test(`tracking is not consumed by ${state}`, async () => {
    const h = createHarness(); h.data.products = [product()]; h.data.conversation = deliveryConversation({ currentStep: state, editingField: state === "AWAITING_EDIT_VALUE" ? "NAME" : null });
    await h.receive("track my order");
    assert.equal(h.data.conversation.currentStep, state); assert.equal(h.data.conversation.customerName, "Asha"); assert.match(h.data.replies.at(-1), /couldn't find any orders/);
  });
}

test('numeric selection selects first product', async () => {
  const h = createHarness(); 
  h.data.products = [product({ name: 'A' }), product({ productId: 'B-2', name: 'B' })];
  await h.receive('1');
  assert.equal(h.data.conversation.currentStep, 'AWAITING_DELIVERY_DETAILS');
  assert.equal(h.data.conversation.selectedProductId, 'P-1');
});

test('numeric selection selects second product', async () => {
  const h = createHarness(); 
  h.data.products = [product({ name: 'A' }), product({ productId: 'B-2', name: 'B' })];
  await h.receive('2');
  assert.equal(h.data.conversation.currentStep, 'AWAITING_DELIVERY_DETAILS');
  assert.equal(h.data.conversation.selectedProductId, 'B-2');
});

test('numeric selection out of bounds returns invalid option', async () => {
  const h = createHarness(); 
  h.data.products = [product({ name: 'A' })];
  await h.receive('2');
  assert.match(h.data.replies.at(-1), /invalid option/);
});

test('numeric input during delivery does not accidentally select a product', async () => {
  const h = createHarness(); 
  h.data.products = [product({ name: 'A' }), product({ productId: 'B-2', name: 'B' })];
  h.data.conversation = detailsConversation({ currentStep: 'AWAITING_DELIVERY_DETAILS', deliveryField: 'PINCODE' });
  await h.receive('682001');
  assert.equal(h.data.conversation.selectedProductId, 'P-1');
  assert.equal(h.data.conversation.pincode, '682001');
});

