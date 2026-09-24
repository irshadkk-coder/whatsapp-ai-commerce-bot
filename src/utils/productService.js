const Product = require("../models/Product");

// `$in: [true]` retains legacy seeded records while numeric stock is adopted.
const availableProductFilter = { isActive: { $ne: false }, $or: [{ stock: { $gt: 0 } }, { stock: true }] };
const CATEGORY_ALIASES = { kitchen: "Kitchen", jewellery: "Jewellery", jewelry: "Jewellery", fashion: "Fashion", watch: "Watch", watches: "Watch" };

function terms(value) {
  return String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

async function findRelevantProduct(query) {
  const products = await getAvailableProducts();
  const queryTerms = terms(query).filter((term) => !["i", "want", "to", "the", "a", "an", "is", "how", "much", "need", "order", "buy", "purchase", "get"].includes(term));
  let best;
  let bestScore = 0;
  for (const product of products) {
    const productTerms = new Set(terms(`${product.name} ${product.category}`));
    const score = queryTerms.reduce((total, term) => total + (productTerms.has(term) ? 1 : 0), 0);
    if (score > bestScore) {
      best = product;
      bestScore = score;
    }
  }
  return bestScore ? best : null;
}

async function getAvailableProducts() {
  return Product.find(availableProductFilter).sort({ category: 1, name: 1 }).lean();
}

function getRequestedCategory(query) {
  const requested = terms(query).map((term) => CATEGORY_ALIASES[term]).find(Boolean);
  return requested || null;
}

async function findCategoryProducts(query) {
  const requestedCategory = getRequestedCategory(query);
  if (!requestedCategory) return [];
  const products = await getAvailableProducts();
  if (requestedCategory === "Watch") return products.filter((product) => terms(product.name).some((term) => term === "watch"));
  return products.filter((product) => String(product.category).toLowerCase() === requestedCategory.toLowerCase());
}

module.exports = { findRelevantProduct, findCategoryProducts, getAvailableProducts, getRequestedCategory, availableProductFilter };
