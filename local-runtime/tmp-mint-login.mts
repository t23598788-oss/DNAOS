import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

// BASE รับจาก env ได้ (ค่าเริ่ม dev localhost:3000 เดิม) — prod ใช้ MINT_BASE ชี้ domain ที่ deploy จริง
const BASE = (process.env.MINT_BASE ?? "http://localhost:3000").replace(/\/+$/, "");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const link = await db.auth.admin.generateLink({
  type: "magiclink",
  email: "dnaos.tech@gmail.com",
  options: { redirectTo: `${BASE}/admin`, },
});
if (link.error || !link.data?.properties?.hashed_token) {
  console.error("MINT FAILED:", link.error?.message ?? JSON.stringify(link.data).slice(0, 300));
  process.exit(1);
}
// เข้าผ่าน flow เดิมของระบบ (app/auth/confirm — verifyOtp ฝั่ง server + ตั้ง cookie localhost)
const confirmUrl = `${BASE}/auth/confirm?token_hash=${link.data.properties.hashed_token}&type=magiclink&next=%2Fadmin%2Ffinance`;
writeFileSync("local-runtime/qa-login.url", confirmUrl + "\n");
console.log("OK token_hash →", confirmUrl.split("token_hash=")[1]?.slice(0, 12));
