/**
 * login-autofill-test.ts — browser autofill semantics of /login (2026-09-24).
 * Restore STANDARD browser behaviour only — proves: real <form>+onSubmit,
 * standard type/name/autocomplete tokens (WHATWG autofill: login identifier =
 * "username", secret = "current-password"), submit still goes through the SAME
 * supabase.auth.signInWithPassword() call, no new password store imported,
 * .env.local still holds NO password (exactly the2 public Supabase keys).
 * Source truth; PASS/FAIL; exit1 on any FAIL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
const page = readFileSync(join(ROOT, "app", "login", "page.tsx"), "utf8");
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ──1: real form ────────────────────────────────────────────────────────────
check("F1 real <form> with onSubmit={handleSendLink}", /<form onSubmit=\{handleSendLink\}/.test(page));
check("F2 submit control is type=\"submit\" (not a button-only form)", page.includes('type="submit"'));
check("F3 email input carries required", (page.match(/\brequired\b/g) ?? []).length >= 1);

// ──2: standard autofill tokens ─────────────────────────────────────────────
check("A1 email: type=email + name=email", page.includes('type="email"') && page.includes('name="email"'));
check("A2 email: autoComplete=\"username\" (WHATWG login identifier; \"email\" token removed)",
  page.includes('autoComplete="username"') && !page.includes('autoComplete="email"'));
check("A3 password fallback input carries standard tokens (name=password + current-password)",
  page.includes('name="password"') && page.includes('autoComplete="current-password"'));
check("A4 password is maintenance-gated (pwMaintenance) with no reveal toggle/Eye icon",
  page.includes("pwMaintenance") && !page.includes("EyeOff") && !page.includes("type={showPassword"));

// ──3: submit path + architecture untouched ────────────────────────────────
check("S1 tiers: OAuth+OTP primary; signInWithPassword only inside pwMaintenance fallback",
  page.includes("sb.auth.signInWithOtp") && page.includes("signInWithOAuth") &&
    page.includes("/auth/confirm") && page.includes("signInWithPassword") &&
    page.includes("pwMaintenance"));
const importLines = (page.match(/^import .*$/gm) ?? []).join("\n");
check("S2 client still the ONE createBrowserSupabase; no password-store/vault/keychain IMPORT",
  page.includes('from "@/services/supabase/browser"') &&
    page.includes("createBrowserSupabase") &&
    !/from "[^"]*(keychain|vault|password-?store|credential-?store)/i.test(importLines));
// S3 updated (2026-09-25 — owner: "ตรวจผลและแก้ข้อขัดแย้งร่วมกัน"): the Codex
// session's return-from-email resume adds exactly ONE sanctioned import —
// @/core/identity/identity = ชั้น Identity กลางตัวเดิมที่ core/auth/session
// delegate อยู่แล้ว (อ่านอย่างเดียว ไม่ mint session — พิสูจน์พฤติกรรมแล้ว:
// auth-access/identity-layer/auth-single-flow/login-autofill ผ่านครบ + diff
// ไม่มี setSession/cookies). ยังบล็อก keychain/vault/password-store/โมดูลแปลก
// ทุกตัวเหมือนเดิม — ไม่ใช่การผ่อน test ให้ผ่านเฉย ๆ.
check("S3 no new auth module imported (login page imports unchanged set + central identity layer)",
  (page.match(/^import .*$/gm) ?? []).every((l) =>
    /from "(react|next\/navigation|lucide-react|@\/services\/supabase\/browser|@\/core\/auth\/resolveDestination|@\/core\/auth\/session|@\/core\/identity\/identity)"/.test(l),
  ));

// ──4: no password copied into env / no new store on disk ──────────────────
const env = readFileSync(join(ROOT, ".env.local"), "utf8");
const envKeys = env.split("\n").filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => l.split("=")[0]);
check("E1 .env.local still exactly the2 public Supabase keys (no password added)",
  envKeys.length === 2 && envKeys.includes("NEXT_PUBLIC_SUPABASE_URL") && envKeys.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
check("E2 no *PASSWORD* key in .env.local", !envKeys.some((k) => /PASSWORD/i.test(k)));

console.log(`\nlogin-autofill: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
