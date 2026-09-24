const Razorpay = require("razorpay");
const crypto = require("crypto");

function razorpayClient() {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) throw new Error("Razorpay credentials are not configured.");
  return new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
}

function safeRazorpayError(error) {
  // The Razorpay SDK normalizes API failures to { statusCode, error }.
  // Keep the axios fallbacks for compatibility with a future SDK version.
  return {
    status: error?.statusCode ?? error?.response?.status,
    data: error?.error ?? error?.response?.data,
    message: error?.message,
    responseKeys: Object.keys(error?.error ?? error?.response?.data ?? {}),
  };
}

function safePaymentLinkResponse(link) {
  return {
    responseKeys: Object.keys(link || {}),
    id: link?.id,
    orderId: link?.order_id,
    referenceId: link?.reference_id,
    shortUrlPresent: Boolean(link?.short_url),
    status: link?.status,
  };
}

async function createPaymentLink(order) {
  const amount = Math.round(Number(order.totalAmount) * 100);
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Invalid payment amount.");
  const existingUrl = order.razorpayPaymentLinkUrl || order.paymentLinkUrl;
  if (order.paymentStatus !== "PAID" && order.razorpayPaymentLinkId && existingUrl) {
    return {
      id: order.razorpayPaymentLinkId,
      short_url: existingUrl,
      reference_id: order.razorpayReferenceId,
      status: "created",
      razorpayOrderId: order.razorpayOrderId,
      reused: true,
    };
  }
  const razorpayReferenceId = order.razorpayReferenceId || `${order.orderId}-${Date.now()}`;
  let link;
  try {
    link = await razorpayClient().paymentLink.create({
      amount,
      currency: "INR",
      accept_partial: false,
      reference_id: razorpayReferenceId,
      description: `Payment for ${order.orderId}`,
      notify: { sms: false, email: false },
      notes: { internal_order_id: order.orderId },
    });
  } catch (error) {
    console.error("Razorpay payment link creation failed", safeRazorpayError(error));
    const description = error?.error?.description || error?.response?.data?.error?.description || error?.message;
    if (error?.error?.code === "BAD_REQUEST_ERROR" && /reference_id/i.test(description || "")) {
      throw new Error(`Razorpay rejected the payment-link reference: ${description}`);
    }
    throw error;
  }
  // The Razorpay Node SDK resolves with response.data, not the axios response.
  // Payment Link API fields are on the returned entity itself. order_id is optional.
  if (!link?.id || !link?.short_url || link?.status !== "created") {
    console.error("Razorpay returned an unexpected payment-link response", safePaymentLinkResponse(link));
    throw new Error("Razorpay did not return a usable payment link.");
  }
  return { id: link.id, short_url: link.short_url, reference_id: link.reference_id, status: link.status, razorpayOrderId: link.order_id };
}

async function fetchPaymentLink(paymentLinkId) {
  try {
    return await razorpayClient().paymentLink.fetch(paymentLinkId);
  } catch (error) {
    console.error("Razorpay payment link fetch failed", safeRazorpayError(error));
    throw error;
  }
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature || !Buffer.isBuffer(rawBody)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

module.exports = { createPaymentLink, fetchPaymentLink, verifyWebhookSignature };
