const Message = require("../models/Message");

async function sendWhatsAppText({ to, text, customerId }) {
  const response = await fetch(`https://graph.facebook.com/v25.0/${process.env.PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("WhatsApp API request failed:", data?.error?.message || response.status);
    throw new Error("WhatsApp API request failed");
  }
  await Message.create({
    whatsappMessageId: data?.messages?.[0]?.id,
    whatsappId: to,
    customerId,
    direction: "OUTGOING",
    message: text,
    messageType: "text",
  });
  return data;
}

module.exports = { sendWhatsAppText };
