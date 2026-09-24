require("dotenv").config();

const WABA_ID = "1124708129904986";
const TOKEN = process.env.WHATSAPP_TOKEN;

async function subscribe() {
  const response = await fetch(
    `https://graph.facebook.com/v26.0/${WABA_ID}/subscribed_apps`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
      },
    }
  );

  const data = await response.json();

  console.log("Meta response:");
  console.log(JSON.stringify(data, null, 2));
}

subscribe();