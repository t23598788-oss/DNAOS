/**
 * auth-single-flow-test.ts — ONE authentication flow invariant (2026-09-24).
 * Owner directive: email → emailed verification/recovery link → session →
 * workspace, using the existing Supabase Auth, ONE /login page, no separate
 * owner/admin/developer auth paths; users don't mainly remember passwords.
 * Source truth: walks app/ proving no leftover password path, the single
 * entry, the shared confirm verifier, and the retired auto-login tombstone.
 * PASS/FAIL; exit1 on any FAIL.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}
const read = (p: string) => readFileSync(p, "utf8");
const appFiles = walk(join(ROOT, "app"));
const login = read(join(ROOT, "app", "login", "page.tsx"));
const confirm = read(join(ROOT, "app", "auth", "confirm", "route.ts"));
const autoLogin = read(join(ROOT, "app", "api", "auth", "auto-login", "route.ts"));
const logout = read(join(ROOT, "app", "api", "auth", "logout", "route.ts"));

// ──1: zero leftover password auth anywhere in app/ ─────────────────────────
const pwHits = appFiles.filter((f) => read(f).includes("signInWithPassword"));
check("signInWithPassword ONLY as /login maintenance fallback (exactly1 hit, that file)",
  pwHits.length === 1 && pwHits[0].replace(/\\/g, "/").endsWith("app/login/page.tsx"),
  pwHits.join(", "));
const resetHits = appFiles.filter((f) => /resetPasswordForEmail|reauthenticate\(/.test(read(f)));
check("no separate password-recovery path (recovery = the same emailed link)", resetHits.length === 0, resetHits.join(", "));

// ──2: the ONE entry ────────────────────────────────────────────────────────
check("login = signInWithOtp + signInWithOAuth (google/apple/azure=Microsoft) → /auth/confirm",
  login.includes("signInWithOtp") && login.includes("signInWithOAuth") &&
    login.includes("/auth/confirm") && login.includes('"Microsoft"') &&
    ["google", "apple", "azure"].every((p) => login.includes(`"${p}"`)));
check("password = maintenance-only (pwMaintenance toggle + standard tokens)",
  login.includes("pwMaintenance") && login.includes('name="password"') &&
    login.includes('autoComplete="current-password"') && login.includes("pwInputRef"));
const otpPages = appFiles.filter((f) => f.endsWith("page.tsx") && read(f).includes("signInWithOtp"));
check("exactly ONE page calls signInWithOtp (/login)",
  otpPages.length === 1 && otpPages[0].replace(/\\/g, "/").endsWith("app/login/page.tsx"),
  otpPages.join(", "));
const callers = appFiles.filter((f) => read(f).includes('"/api/auth/auto-login"'));
check("zero callers of auto-login left in app/", callers.length === 0, callers.join(", "));

// ──3: confirm = verifier for magiclink | recovery | …, safe next, /app ─────
check("confirm = THE verifier: verifyOtp + PKCE exchange + safe-next + /app default + failure-only limiter",
  confirm.includes("verifyOtp") && confirm.includes("exchangeCodeForSession") &&
    confirm.includes("isSafeInternalPath(next)") && confirm.includes('?? "/app"') &&
    confirm.includes("clearFailures") && confirm.includes("recordFailure"));
check("confirm accepts any EmailOtpType (login + recovery share ONE route)", confirm.includes("EmailOtpType"));

// ──4: retired second path ──────────────────────────────────────────────────
check("auto-login tombstoned410 AUTH_PATH_RETIRED (no env-password mint)",
  autoLogin.includes("AUTH_PATH_RETIRED") && autoLogin.includes("status: 410") &&
    !autoLogin.includes("signInWithPassword"));

// ──4b: one identity, many providers (owner, 2026-09-24) ───────────────────
const oauthPages = appFiles.filter((f) => f.endsWith("page.tsx") && read(f).includes("signInWithOAuth"));
check("exactly ONE page offers provider OAuth (/login): google+apple+azure(Microsoft)",
  oauthPages.length === 1 && oauthPages[0].replace(/\\/g, "/").endsWith("app/login/page.tsx") &&
    ["google", "apple", "azure"].every((p) => login.includes(`"${p}"`)) &&
    login.includes('"Microsoft"'),
  oauthPages.join(", "));
const verifyRoute = read(join(ROOT, "app", "auth", "verify", "route.ts"));
check("/auth/verify = email-template alias forwarding to THE /auth/confirm (no second verifier)",
  verifyRoute.includes("/auth/confirm") && !verifyRoute.includes(".verifyOtp(") &&
    !verifyRoute.includes(".exchangeCodeForSession("));
const sessionSrc = read(join(ROOT, "core", "auth", "session.ts"));
const identitySrc = read(join(ROOT, "core", "identity", "identity.ts"));
check("resolution chain lives in THE Identity Layer (session delegates; email fallback inside)",
  sessionSrc.includes("resolveIdentityContext") &&
    identitySrc.includes('field: "email"') && identitySrc.includes("resolvedBy"));
const fedMigration = read(join(ROOT, "supabase", "migrations", "20260927000001_identity_email_federation.sql"));
check("migration: email UNIQUE + trigger keeps ONE profile per human + email-resolution RLS read",
  fedMigration.includes("profiles_email_lower_key") && fedMigration.includes("lower(p.email)") &&
    fedMigration.includes("profiles_select_same_email"));

// ──5: session lifecycle untouched ──────────────────────────────────────────
check("logout still the one signOut", logout.includes("auth.signOut()"));

console.log(`\nauth-single-flow: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
