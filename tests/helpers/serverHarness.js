const Module = require("module");
const path = require("node:path");

// Each isolated server load registers shutdown listeners. This test-only harness
// intentionally creates many isolated loads, so avoid a misleading warning.
process.setMaxListeners(0);

function document(values) {
  return Object.assign(values, { async save() { this.saved = (this.saved || 0) + 1; return this; } });
}

function createHarness() {
  const data = { products: [], conversation: null, customer: document({ _id: "customer-1", whatsappId: "919999999999" }), replies: [], messages: new Set(), productLookups: 0, geminiCalls: 0, orders: [] };
  const routes = [];
  const app = { disable() {}, use() {}, get() {}, post(pathname, handler) { routes.push({ pathname, handler }); }, listen() { return { close(done) { done(); } }; } };
  const express = () => app;
  express.json = () => () => {}; express.raw = () => () => {};
  const lean = (value) => ({ lean: async () => value });
  const Product = {
    findOne(query) { data.productLookups += 1; return lean(data.products.find((product) => product.productId === query.productId && product.isActive !== false && product.stock > 0) || null); },
    find() { return { sort: () => ({ lean: async () => data.products.filter((product) => product.isActive !== false && product.stock > 0) }) }; },
  };
  const availableProducts = () => data.products.filter((product) => product.isActive !== false && product.stock > 0);
  const productService = {
    async findRelevantProduct(message) {
      const terms = String(message).toLowerCase().match(/[a-z0-9]+/g) || [];
      const ignored = new Set(["i", "want", "to", "the", "a", "an", "need", "order", "buy", "purchase", "get"]);
      const query = terms.filter((term) => !ignored.has(term));
      let best = null; let score = 0;
      for (const candidate of availableProducts()) {
        const candidateTerms = new Set(`${candidate.name} ${candidate.category}`.toLowerCase().match(/[a-z0-9]+/g) || []);
        const candidateScore = query.filter((term) => candidateTerms.has(term)).length;
        if (candidateScore > score) { best = candidate; score = candidateScore; }
      }
      return best;
    },
    async getAvailableProducts() { return availableProducts(); },
    getRequestedCategory(message) { const aliases = { kitchen: "Kitchen", jewellery: "Jewellery", jewelry: "Jewellery", fashion: "Fashion", watch: "Watch", watches: "Watch" }; return (String(message).toLowerCase().match(/[a-z0-9]+/g) || []).map((term) => aliases[term]).find(Boolean) || null; },
    async findCategoryProducts(message) { const category = productService.getRequestedCategory(message); return availableProducts().filter((candidate) => category === "Watch" ? /\\bwatch\\b/i.test(candidate.name) : String(candidate.category).toLowerCase() === String(category).toLowerCase()); },
    availableProductFilter: {},
  };
  const Conversation = {
    findOne() { return { sort: async () => data.conversation }; },
    async findOneAndUpdate(_query, update) { data.conversation ||= document({}); Object.assign(data.conversation, update.$set || {}); return data.conversation; },
    async updateMany() { return {}; },
  };
  const Customer = { async findOneAndUpdate() { return data.customer; }, async updateOne() { return {}; } };
  const Message = { async create(message) { if (data.messages.has(message.whatsappMessageId)) { const error = new Error("duplicate"); error.code = 11000; throw error; } data.messages.add(message.whatsappMessageId); return message; } };
  const Order = { findOne() { return { sort: async () => null }; }, findById: async () => null, async findOneAndUpdate() { return null; } };
  const originalLoad = Module._load;
  const serverPath = path.join(__dirname, "../../server.js");
  const productServicePath = path.join(__dirname, "../../src/utils/productService.js");
  delete require.cache[require.resolve(serverPath)];
  delete require.cache[require.resolve(productServicePath)];
  Module._load = function mockedLoad(request, parent, isMain) {
    const mocks = {
      express, "express-rate-limit": () => () => {},
      "./src/config/database": { connectDatabase: async () => {}, mongoose: { connection: { readyState: 1, close: async () => {} } } },
      "./src/models/Customer": Customer, "./src/models/Conversation": Conversation, "./src/models/Message": Message, "./src/models/Product": Product, "./src/models/Order": Order,
      "./src/services/whatsappService": { sendWhatsAppText: async ({ text }) => { data.replies.push(text); } },
      "./src/services/geminiService": { getGeminiReply: async () => { data.geminiCalls += 1; return "gemini fallback"; } },
      "./src/services/orderService": { createOrder: async (input) => { const order = document({ _id: `order-${data.orders.length + 1}`, ...input, totalAmount: input.product.price * input.conversation.quantity }); data.orders.push(order); return order; } },
      "./src/services/orderLifecycleService": { canCancelOrder: () => true, customerOrders: async () => [], trackingText: () => "tracking" },
      "./src/services/paymentService": { createPaymentLink: async () => ({ id: "link", short_url: "https://payment.test", reference_id: "ref" }), fetchPaymentLink: async () => ({ status: "created" }), verifyWebhookSignature: () => true },
      "./src/utils/productService": productService,
      "./src/routes/adminRoutes": {},
    };
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try { require(serverPath); } finally { Module._load = originalLoad; }
  const webhook = routes.filter((route) => route.pathname === "/webhook").at(-1).handler;
  async function receive(text, id = `message-${data.messages.size + 1}`) {
    const response = { sendStatus(code) { this.status = code; return code; } };
    await webhook({ body: { entry: [{ changes: [{ value: { messages: [{ id, from: data.customer.whatsappId, type: "text", text: { body: text } }] } }] }] } }, response);
    return response;
  }
  return { data, receive };
}

module.exports = { createHarness, document };
