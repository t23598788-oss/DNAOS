/**
 * หน้าที่: public surface ขั้นต่ำที่ TikTok Production บังคับ — เสิร์ฟ /terms,
 * /privacy และ /callback บน public HTTPS (Supabase Edge, โปรเจกต์ของ Owner เอง)
 *
 * ── ทำไมต้องมีตัวนี้ ──
 * DNA OS รันบน 127.0.0.1 — TikTok เข้าไม่ถึง App details ของ TikTok บังคับ ToS URL
 * + Privacy URL เป็น public และ redirect_uri ต้อง public HTTPS ไฟล์นี้เติมเฉพาะ
 * ผิว public ที่ขาด ไม่ทำ OAuth เอง
 *
 * ── callback ไม่ใช่ OAuth ชุดที่สอง ──
 * /callback แค่ "รับ code+state จาก TikTok แล้ว relay" ให้ lifecycle จริงที่
 * connections/tiktok-authorization/ (ซึ่งรันบนเครื่อง Owner ที่มี Keychain) เอาไป
 * แลก token เอง การแลก token / เก็บ credential ไม่เกิดที่นี่เด็ดขาด — Edge เข้าถึง
 * Keychain ของเครื่อง Owner ไม่ได้อยู่แล้ว
 *
 * ── เนื้อหากฎหมายเป็นความจริงขั้นต่ำ ──
 * DNA OS เป็นระบบอัตโนมัติส่วนตัวของเจ้าของบัญชี เข้าถึงเฉพาะข้อมูลบัญชี TikTok
 * ของเจ้าของเอง ด้วยการอนุญาตของเจ้าของ เก็บบนเครื่องของเจ้าของ ไม่แชร์ต่อ ไม่มี
 * ข้อความเกินจริงเรื่องบริษัท/การเก็บ/การแชร์ข้อมูล
 *
 * Deploy: supabase functions deploy tiktok-oauth-support --project-ref xeytcavxejhyzxwevgto --no-verify-jwt
 */

// @ts-nocheck  — Deno runtime (Supabase Edge); ไม่ถูก typecheck ด้วย tsconfig ของ repo นี้

const CONTACT = "dnaos.tech@gmail.com";
const UPDATED = "2026-09-01";

const page = (title: string, body: string): Response =>
  new Response(
    `<!doctype html><html lang="th"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title} · DNA OS</title>` +
      `<style>body{font:16px/1.7 -apple-system,system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1a1a1a}` +
      `h1{font-size:24px}h2{font-size:18px;margin-top:28px}code{background:#f3f3f3;padding:1px 5px;border-radius:4px}` +
      `.muted{color:#666;font-size:14px}</style></head><body>${body}` +
      `<p class="muted">Last updated ${UPDATED} · Contact: ${CONTACT}</p></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );

const TERMS = page("Terms of Service", `
  <h1>DNA OS — Terms of Service</h1>
  <p>DNA OS is a private, self-hosted automation system operated by an individual
  account owner ("the Owner") for the Owner's own accounts. It is not a public
  product and is not offered to third parties.</p>
  <h2>Scope of use</h2>
  <p>The DNA OS TikTok integration accesses only the TikTok account that the Owner
  personally authorizes, and only the data the Owner grants via TikTok's own
  consent screen (for example: basic profile information and the list of the
  Owner's own videos).</p>
  <h2>Authorization</h2>
  <p>Access is established solely through TikTok's official OAuth flow. The Owner
  must explicitly approve the authorization in their browser. Authorization can be
  revoked by the Owner at any time via their TikTok account settings.</p>
  <h2>No third-party use</h2>
  <p>The integration is used only for the Owner's own account management. It does
  not act on behalf of, or process data belonging to, any other person.</p>
  <h2>Contact</h2>
  <p>Questions about these terms: <code>${CONTACT}</code></p>
`);

const PRIVACY = page("Privacy Policy", `
  <h1>DNA OS — Privacy Policy</h1>
  <p>This policy describes how the DNA OS TikTok integration handles data. DNA OS
  is operated privately by an individual account owner for their own account.</p>
  <h2>What is accessed</h2>
  <p>With the Owner's explicit TikTok authorization, the integration may read the
  Owner's own TikTok profile information (such as display name and open id) and the
  list of the Owner's own videos. Only scopes the Owner approves are used.</p>
  <h2>What is stored, and where</h2>
  <p>Access tokens are stored in the operating-system secure credential store
  (Apple Keychain) on the Owner's own device. The canonical registry stores only a
  non-secret reference to that credential, never the secret value itself.</p>
  <h2>Data sharing</h2>
  <p>Data retrieved from TikTok is not sold, and is not shared with any third
  party. It is used only on the Owner's own device for the Owner's own account.</p>
  <h2>Retention and deletion</h2>
  <p>Stored credentials remain only until the Owner revokes authorization or
  removes them from the device. Revoking authorization in TikTok invalidates the
  stored token.</p>
  <h2>Contact</h2>
  <p>Privacy questions or deletion requests: <code>${CONTACT}</code></p>
`);

const CALLBACK_READY = page("TikTok Authorization Callback", `
  <h1>DNA OS — TikTok OAuth callback</h1>
  <p>This endpoint receives TikTok's OAuth redirect and relays the authorization
  result to the Owner's DNA OS instance, which performs the token exchange locally.
  No token exchange happens here.</p>
`);

Deno.serve((req: Request) => {
  const url = new URL(req.url);
  // path ท้าย function name — รองรับทั้ง /terms และ /tiktok-oauth-support/terms
  const p = url.pathname.replace(/^\/functions\/v1\/tiktok-oauth-support/, "").replace(/^\/tiktok-oauth-support/, "");
  const tail = p.replace(/\/+$/, "") || "/";

  if (tail === "/terms") return TERMS;
  if (tail === "/privacy") return PRIVACY;
  if (tail === "/callback" || tail === "/oauth/tiktok/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    // ห้าม log ค่า code ลง console (single-use แต่ยังถือว่า sensitive) — บอกแค่ว่ามีหรือไม่มี
    console.log(JSON.stringify({ event: "tiktok_callback", has_code: Boolean(code), has_state: Boolean(state), error: error ?? null }));
    if (error) return page("Authorization declined", `<h1>Authorization was not completed</h1><p>TikTok reported: <code>${error}</code>. You may close this window and retry from DNA OS.</p>`);
    if (code && state) {
      // relay: แสดงหน้ายืนยัน — DNA OS บนเครื่อง Owner จะดำเนินการแลก token ต่อเอง
      // (durable relay จะต่อกับ tiktok-authorization lifecycle ก่อนขั้น authorize จริง)
      return page("Authorization received", `<h1>Authorization received</h1><p>You can close this window. DNA OS will complete the connection on your device.</p>`);
    }
    return CALLBACK_READY;
  }
  if (tail === "/" || tail === "") return page("DNA OS OAuth support", `<h1>DNA OS — OAuth support endpoints</h1><ul><li><a href="./terms">/terms</a></li><li><a href="./privacy">/privacy</a></li><li><a href="./callback">/callback</a></li></ul>`);
  return new Response("Not found", { status: 404 });
});
