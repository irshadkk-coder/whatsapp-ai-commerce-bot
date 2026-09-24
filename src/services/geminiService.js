const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function getGeminiReply(userMessage, products) {
  const productInfo = products.map((product) => `ID: ${product.productId}\nName: ${product.name}\nPrice: ₹${product.price}\nCOD: ${product.cod ? "Available" : "Not available"}\nStock: ${product.stock ? "Available" : "Out of stock"}\nCategory: ${product.category}\nDescription: ${product.description}`).join("\n\n");
  try {
    const result = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: `You are a concise WhatsApp sales assistant. Use only this database product data; never invent products, prices, stock, COD, or order status. Do not collect order details or confirm orders: the application handles orders.\n\nRelevant products:\n${productInfo || "No matching product found."}\n\nCustomer message: ${userMessage}`,
    });
    return result.text || "Sorry, I'm having trouble processing that right now. Please try again.";
  } catch (error) {
    console.error("Gemini request failed:", error.message);
    return "Sorry, I'm having trouble processing that right now. Please try again.";
  }
}

module.exports = { getGeminiReply };
