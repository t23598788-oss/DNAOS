/**
 * login-autofill-test.ts — email/OTP browser autofill semantics of /login.
 * Proves standard email and one-time-code tokens, real forms, the existing
 * Supabase Auth client, and no OTP persistence or alternate login surface.
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
check("F1 email form submits through handleSendOtp", /<form onSubmit=\{handleSendOtp\}/.test(page));
check("F2 submit control is type=\"submit\" (not a button-only form)", page.includes('type="submit"'));
check("F3 email input carries required", (page.match(/\brequired\b/g) ?? []).length >= 1);

// ──2: standard autofill tokens ─────────────────────────────────────────────
check("A1 email: type=email + name=email", page.includes('type="email"') && page.includes('name="email"'));
check("A2 email: autoComplete=\"username\" (WHATWG login identifier; \"email\" token removed)",
  page.includes('autoComplete="username"') && !page.includes('autoComplete="email"'));
check("A3 OTP input supports six-digit numeric autofill",
  page.includes('autoComplete="one-time-code"') &&
    page.includes('inputMode="numeric"') &&
    page.includes('pattern="[0-9]{6}"') &&
    page.includes('maxLength={6}'));
check("A4 OTP input autofocuses when the verification step opens",
  page.includes("if (step === \"otp\") otpInputRef.current?.focus()"));

// ──3: submit path + architecture untouched ────────────────────────────────
check("S1 send/verify use the existing Supabase Auth client and OTP verifier",
  page.includes("auth.signInWithOtp") && page.includes("auth.verifyOtp") &&
    page.includes('type: "email"') && page.includes("auth.getUser()"));
check("S2 OTP remains transient and login has no alternate provider/password surface",
  !page.includes("localStorage") && !page.includes("sessionStorage") &&
    !page.includes("console.log") && !page.includes("signInWithOAuth") &&
    !page.includes("signInWithPassword"));
const importLines = (page.match(/^import .*$/gm) ?? []).join("\n");
check("S3 client remains the existing createBrowserSupabase; no credential-store import",
  page.includes('from "@/services/supabase/browser"') &&
    page.includes("createBrowserSupabase") &&
    !/from "[^"]*(keychain|vault|password-?store|credential-?store)/i.test(importLines));
check("S4 no new auth module imported (existing Supabase client and Identity Layer only)",
  (page.match(/^import .*$/gm) ?? []).every((l) =>
    /from "(react|next\/navigation|lucide-react|@\/services\/supabase\/browser|@\/core\/auth\/resolveDestination|@\/core\/auth\/session|@\/core\/identity\/identity)"/.test(l),
  ));

console.log(`\nlogin-autofill: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
