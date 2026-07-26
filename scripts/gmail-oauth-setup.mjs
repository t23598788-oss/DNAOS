// One-time interactive Gmail OAuth setup (owner, 2026-07-26).
// Real bank-notification-email cross-check for the Payment Verification
// Engine (Rule 115 Level 3) needs a real Google refresh token — Google
// requires an actual human login+consent for this, no way around it.
// Run this ONCE, locally, on the owner's own Mac (never in CI/deploy):
//
//   node scripts/gmail-oauth-setup.mjs
//
// Reads GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET from .env.local, opens the
// real Google consent screen in the default browser, and once approved,
// prints the real refresh token to paste into GMAIL_REFRESH_TOKEN in
// .env.local — no dependencies beyond Node's own built-ins.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { exec } from "node:child_process";

function loadEnvLocal() {
  const path = new URL("../.env.local", import.meta.url);
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf-8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnvLocal();
const CLIENT_ID = env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = env.GMAIL_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET in .env.local — set those first.");
  process.exit(1);
}

const PORT = 51789;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
// Read-only scope — this integration only ever needs to READ bank
// notification emails, never send/modify/delete anything in the inbox.
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code&scope=${encodeURIComponent(SCOPE)}` +
  `&access_type=offline&prompt=consent`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("No authorization code received.");
    return;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();

  if (tokens.refresh_token) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
      "<h2>สำเร็จแล้วครับ</h2><p>ปิดหน้านี้ได้เลย ไปดู Refresh Token ในเทอร์มินัลครับ</p>",
    );
    console.log("\n=== สำเร็จ ===");
    console.log("คัดลอกบรรทัดนี้ไปวางแทน GMAIL_REFRESH_TOKEN= ใน .env.local:\n");
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } else {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
      "<h2>ไม่ได้ refresh_token</h2><p>ลองรันสคริปต์นี้ใหม่อีกครั้ง (ต้องเป็นครั้งแรกที่ยินยอมสิทธิ์ให้แอปนี้ ถ้าเคยกด Allow ไปแล้วอาจไม่ส่ง refresh_token มาซ้ำ — ไปที่ myaccount.google.com/permissions เพิกถอนสิทธิ์แอปนี้ก่อนแล้วรันใหม่)</p>",
    );
    console.error("\nไม่ได้ refresh_token — response จริง:", JSON.stringify(tokens, null, 2));
  }
  server.close();
});

server.listen(PORT, () => {
  console.log("เปิดเบราว์เซอร์ให้ล็อกอินเข้า Google แล้วกดยินยอมสิทธิ์...");
  console.log(`ถ้าไม่เปิดเอง ก๊อป URL นี้ไปวางในเบราว์เซอร์เอง:\n${authUrl}\n`);
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${opener} "${authUrl}"`);
});
