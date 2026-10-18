// Sends today's quote from Grandma Somsri to everyone who added her LINE Official Account.
// Not scheduled: the daily cron was removed to save LINE message quota, so call it by hand when you want to send.
//
// Environment variables (set in Vercel → Settings → Environment Variables):
//   LINE_CHANNEL_ACCESS_TOKEN  long-lived token from LINE Developers → Messaging API
//   CRON_SECRET                any long random string; send it as "Authorization: Bearer …" when calling
//
// GET /api/morning?dry=1 (with the same Authorization header) returns the message without sending it.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SITE = "https://yai-somsri.vercel.app";
const OPENERS = [
  "อรุณสวัสดิ์จ้ะหลานรัก ยายมีคำคมเช้านี้มาฝาก",
  "ตื่นแล้วเหรอลูก ก่อนออกจากบ้าน ยายฝากคำนี้ไว้นะ",
  "เช้านี้ยายนึกถึงหลานเลย เลยเอาคำนี้มาฝาก",
  "อรุณสวัสดิ์จ้ะ กินข้าวเช้าด้วยนะ แล้วอ่านคำนี้ของยาย",
  "หลานยาย วันใหม่มาแล้ว ยายเก็บคำนี้ไว้ให้",
  "ยายรดน้ำต้นไม้เสร็จแล้ว แวะมาส่งคำคมให้หลานจ้ะ",
  "ตื่นมาเจอกันอีกวันแล้วนะลูก นี่คำคมของวันนี้",
  "ดื่มน้ำสักแก้วก่อนนะลูก แล้วรับคำคมจากยายไป"
];

// The quotes live in index.html (const QUOTES = [...]); the nightly task keeps adding to that list.
function loadQuotes() {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const block = html.match(/const QUOTES = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error("QUOTES list not found in index.html");
  return [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]).filter(Boolean);
}

function todaysMessage() {
  const quotes = loadQuotes();
  // Day number in Thailand time (UTC+7): one quote per day, in order, so nobody gets a repeat until the list runs out
  const day = Math.floor((Date.now() + 7 * 3600e3) / 86400e3);
  const quote = quotes[day % quotes.length];
  const opener = OPENERS[day % OPENERS.length];
  return {
    type: "flex",
    altText: `${opener}: “${quote}”`.slice(0, 400),
    contents: {
      type: "bubble",
      hero: { type: "image", url: `${SITE}/line/morning.jpg`, size: "full", aspectRatio: "20:13", aspectMode: "cover",
              action: { type: "uri", uri: `${SITE}/?source=line-morning` } },
      body: {
        type: "box", layout: "vertical", spacing: "md", backgroundColor: "#fffaf2",
        contents: [
          { type: "text", text: opener, size: "sm", color: "#7b6a60", wrap: true },
          { type: "text", text: `“${quote}”`, size: "xl", weight: "bold", color: "#33251f", wrap: true },
          { type: "text", text: "— ยายสมศรี", size: "sm", color: "#ad9e94", align: "end" }
        ]
      },
      footer: {
        type: "box", layout: "vertical", backgroundColor: "#fffaf2",
        contents: [{ type: "button", style: "primary", color: "#33251f", height: "sm",
                     action: { type: "uri", label: "มาหายาย", uri: `${SITE}/?source=line-morning` } }]
      }
    }
  };
}

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: "CRON_SECRET is not set" });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "unauthorized" });

  let message;
  try { message = todaysMessage(); } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
  if (req.query && req.query.dry) return res.status(200).json({ dryRun: true, message });

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: "LINE_CHANNEL_ACCESS_TOKEN is not set" });

  const r = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      // LINE ignores a repeat with the same key, so a retried call never sends twice
      "X-Line-Retry-Key": crypto.randomUUID()
    },
    body: JSON.stringify({ messages: [message] })
  });
  const detail = await r.text();
  if (!r.ok) return res.status(502).json({ error: "LINE broadcast failed", status: r.status, detail });
  return res.status(200).json({ sent: true, altText: message.altText });
};
