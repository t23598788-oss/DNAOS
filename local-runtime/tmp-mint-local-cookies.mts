// ใช้กับ PHASE 2 local verify — ใช้ generateLink email OTP จริง ( keyed )
// ผลลัพธ์ = Playwright storageState: local-runtime/tmp-local-login-state.json
// ห้ามพริ้นค่า token/OTP ลง console ทุกกรณี
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const email = "dnaos.tech@gmail.com";

const link = await db.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: "http://localhost:3000/admin" } });
if (link.error || !link.data?.properties) { console.error("MINT FAILED:", link.error?.message ?? "-"); process.exit(1); }
const otp = (link.data.properties as { email_otp?: string }).email_otp;
if (!otp) { console.error("NO_EMAIL_OTP (รุ่น supabase-js ไม่คืน OTP — ยุติตามความจริง)"); process.exit(1); }

// verify ตามข้อที่ supabase-ssr รับ (email OTP — ผ่าน sys token จริง ไม่ผ่าน /auth/confirm)
const { data, error } = await db.auth.verifyOtp({ email, token: otp, type: "email" });
if (error || !data?.session) { console.error("VERIFY_FAILED:", error?.message ?? "-"); process.exit(1); }
const s = data.session!;

const payload = {
  access_token: s.access_token,
  token_type: s.token_type ?? "bearer",
  expires_in: s.expires_in ?? 3600,
  expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600),
  refresh_token: s.refresh_token,
  user: s.user,
};
const cookieVal = "base64-" + Buffer.from(JSON.stringify(payload)).toString("base64");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = match(url, /https:\/\/([a-z0-9]+)\./) ?? "";
if (!ref) { console.error("CANNOT_PARSE_SUPABASE_REF"); process.exit(1); }
function match(text: string, re: RegExp): string | null { return text.match(re)?.[1] ?? null; }
const state = { cookies: [{ name: `sb-${ref}-auth-token`, value: cookieVal, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] };
writeFileSync("local-runtime/tmp-local-login-state.json", JSON.stringify(state, null, 2));
console.log("OK — session (เซสชันเจ้าของจริง) จัดเก็บลง local-runtime/tmp-local-login-state.json · ค่า cookie ไม่แสดงจอ");
