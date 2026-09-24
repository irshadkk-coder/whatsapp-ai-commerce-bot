const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness, document } = require("./helpers/serverHarness");

function product(overrides = {}) { return { productId: "K-1", name: "Plate Organizer", category: "Kitchen", price: 500, stock: 10, isActive: true, cod: true, ...overrides }; }
function detailsConversation(overrides = {}) { return document({ status: "BOT_ACTIVE", currentStep: "AWAITING_DELIVERY_DETAILS", selectedProductId: "K-1", selectedProductName: "Plate Organizer", selectedProductPrice: 500, quantity: 1, paymentMethod: "COD", whatsappId: "919999999999", ...overrides }); }

test("multiline input parsing intelligently assigns unambiguous lines", async () => {
  const h = createHarness(); h.data.products = [product()];
  h.data.conversation = detailsConversation({ deliveryField: "NAME" });
  
  await h.receive("Irshad\nKannadiparamba\n670605");
  
  const c = h.data.conversation;
  assert.equal(c.customerName, "Irshad", "Name should be parsed from first line");
  assert.equal(c.pincode, "670605", "Pincode should be parsed strictly");
  assert.equal(c.houseBuilding, undefined, "House/Building must not be guessed");
  assert.equal(c.area, undefined, "Area must not be guessed");
  assert.equal(c.currentStep, "AWAITING_DELIVERY_DETAILS", "Should still wait for missing fields");
  assert.equal(c.deliveryField, "HOUSE_BUILDING", "Should prompt for the next missing field");
});

test("explicit complete labeled form assigns all fields correctly", async () => {
  const h = createHarness(); h.data.products = [product()];
  h.data.conversation = detailsConversation({ deliveryField: "NAME" });
  
  await h.receive("Name: Irshad\nHouse/Building: Kotterikandi house\nArea/Place: Kannadiparamba\nDistrict: Kannur\nPincode: 670605");
  
  const c = h.data.conversation;
  assert.equal(c.customerName, "Irshad");
  assert.equal(c.houseBuilding, "Kotterikandi house");
  assert.equal(c.area, "Kannadiparamba");
  assert.equal(c.district, "Kannur");
  assert.equal(c.pincode, "670605");
  assert.equal(c.currentStep, "AWAITING_CONFIRMATION", "All fields provided, should proceed to confirmation");
});

test("pincode with spaces normalizes to 6 digits", async () => {
  const h = createHarness(); h.data.products = [product()];
  h.data.conversation = detailsConversation({ deliveryField: "PINCODE", customerName: "A", houseBuilding: "B", area: "C", district: "D" });
  
  await h.receive("670 605");
  
  const c = h.data.conversation;
  assert.equal(c.pincode, "670605");
  assert.equal(c.currentStep, "AWAITING_CONFIRMATION");
});

test("normal names containing spaces must NOT be incorrectly split", async () => {
  const h = createHarness(); h.data.products = [product()];
  h.data.conversation = detailsConversation({ deliveryField: "NAME" });
  
  await h.receive("Muhammed Irshad");
  
  const c = h.data.conversation;
  assert.equal(c.customerName, "Muhammed Irshad", "Full name should be preserved");
  assert.equal(c.deliveryField, "HOUSE_BUILDING");
});

test("1-to-1 exact mapping of remaining fields", async () => {
  const h = createHarness(); h.data.products = [product()];
  h.data.conversation = detailsConversation({ deliveryField: "NAME" });
  
  await h.receive("Irshad\nKotterikandi\nKannadiparamba\nKannur\n670605");
  
  const c = h.data.conversation;
  assert.equal(c.customerName, "Irshad");
  assert.equal(c.houseBuilding, "Kotterikandi");
  assert.equal(c.area, "Kannadiparamba");
  assert.equal(c.district, "Kannur");
  assert.equal(c.pincode, "670605");
  assert.equal(c.currentStep, "AWAITING_CONFIRMATION");
});

test("normal one-field-per-message flow works", async () => {
  const h = createHarness(); h.data.products = [product()];
  h.data.conversation = detailsConversation({ deliveryField: "NAME" });
  
  await h.receive("Irshad");
  assert.equal(h.data.conversation.deliveryField, "HOUSE_BUILDING");
  await h.receive("Kotterikandi");
  assert.equal(h.data.conversation.deliveryField, "AREA");
});

test('same-line delivery input assigns NAME and PINCODE correctly', async () => {
  const h = createHarness(); h.data.products = [product()];
  h.data.conversation = detailsConversation({ deliveryField: 'NAME' });
  await h.receive('irshad 670604');
  const c = h.data.conversation;
  assert.equal(c.customerName, 'irshad');
  assert.equal(c.pincode, '670604');
});

test('same-line delivery input assigns multi-word NAME and PINCODE correctly', async () => {
  const h = createHarness(); h.data.products = [product()];
  h.data.conversation = detailsConversation({ deliveryField: 'NAME' });
  await h.receive('Muhammed Irshad 670604');
  const c = h.data.conversation;
  assert.equal(c.customerName, 'Muhammed Irshad');
  assert.equal(c.pincode, '670604');
});

