/**
 * auth-single-flow-test.ts — ONE authentication flow invariant (2026-09-24).
 * Owner directive: email → numeric email OTP → existing Supabase session →
 * Workspace, using one /login path and no separate authentication engine.
 * Source truth: checks the OTP UI/verifier contract, identity resolution,
 * shared legacy callback and retired auto-login tombstone.
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
const authConfig = read(join(ROOT, "supabase", "config.toml"));
const magicLinkTemplate = read(join(ROOT, "supabase", "templates", "magic_link.html"));
const autoLogin = read(join(ROOT, "app", "api", "auth", "auto-login", "route.ts"));
const logout = read(join(ROOT, "app", "api", "auth", "logout", "route.ts"));

// ──1: Login is email OTP only ──────────────────────────────────────────────
const pwHits = appFiles.filter((f) => read(f).includes("signInWithPassword"));
check("no password sign-in on app routes", pwHits.length === 0,
  pwHits.join(", "));
const resetHits = appFiles.filter((f) => /resetPasswordForEmail|reauthenticate\(/.test(read(f)));
check("no separate password-recovery path", resetHits.length === 0, resetHits.join(", "));

// ──2: the ONE entry ────────────────────────────────────────────────────────
check("login exposes only the existing Supabase email OTP flow",
  login.includes("signInWithOtp") && login.includes('type: "email"') &&
    login.includes("shouldCreateUser: false") &&
    login.includes("verifyOtp") && !login.includes("signInWithOAuth") &&
    !login.includes("signInWithPassword"));
check("numeric OTP input supports six digits and browser autofill",
  login.includes('autoComplete="one-time-code"') &&
    login.includes('inputMode="numeric"') &&
    login.includes('pattern="[0-9]{6}"') &&
    login.includes('maxLength={6}'));
check("local Supabase email config sends the numeric OTP template",
  /otp_length\s*=\s*6/.test(authConfig) &&
    authConfig.includes("[auth.email.template.magic_link]") &&
    authConfig.includes("content_path = \"./supabase/templates/magic_link.html\"") &&
    magicLinkTemplate.includes("{{ .Token }}") &&
    !magicLinkTemplate.includes("{{ .ConfirmationURL }}"));
check("OTP verification confirms persisted Supabase user and canonical profile",
  login.includes("data.session") && login.includes("supabase.auth.getUser()") &&
    login.includes("resolveIdentityContext(user"));
check("existing valid session redirects to safe destination without another OTP",
  login.includes("window.location.replace(getLoginDestination(nextPath))") &&
    login.includes('"/workspace"'));
const otpPages = appFiles.filter((f) => f.endsWith("page.tsx") && read(f).includes("signInWithOtp"));
check("exactly ONE page calls signInWithOtp (/login)",
  otpPages.length === 1 && otpPages[0].replace(/\\/g, "/").endsWith("app/login/page.tsx"),
  otpPages.join(", "));
const callers = appFiles.filter((f) => read(f).includes('"/api/auth/auto-login"'));
check("zero callers of auto-login left in app/", callers.length === 0, callers.join(", "));

// ──3: legacy callback remains for existing links/provider sessions ─────────
check("confirm keeps legacy email-link and PKCE callbacks with safe-next and limiter",
  confirm.includes("verifyOtp") && confirm.includes("exchangeCodeForSession") &&
    confirm.includes("isSafeInternalPath(next)") &&
    confirm.includes("clearFailures") && confirm.includes("recordFailure"));
check("confirm accepts existing EmailOtpType callbacks", confirm.includes("EmailOtpType"));

// ──4: retired second path ──────────────────────────────────────────────────
check("auto-login tombstoned410 AUTH_PATH_RETIRED (no env-password mint)",
  autoLogin.includes("AUTH_PATH_RETIRED") && autoLogin.includes("status: 410") &&
    !autoLogin.includes("signInWithPassword"));

// ──4b: provider identity/config remains available outside the Login UI ──────
check("Login UI no longer exposes provider buttons",
  !login.includes("signInWithOAuth"));
check("/auth/confirm still supports provider PKCE return", confirm.includes("exchangeCodeForSession"));
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
