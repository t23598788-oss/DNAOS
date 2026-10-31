/**
 * identity-layer-test.ts — central Identity Layer invariants (2026-09-24).
 * Owner design:1 human =1 canonical user/profile; linked identities from many
 * providers WITHOUT duplicate users; provider/account/token complexity stays
 * BEHIND the Identity Layer; /login reveals none of it; runtime resolves
 * session → identity → connection server-side; a password is NEVER shared
 * across providers (each OAuth camp keeps its own session/token).
 * Source truth only — PASS/FAIL; exit1 on any FAIL.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
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

const identitySrc = read("core/identity/identity.ts");
const sessionSrc = read("core/auth/session.ts");
const loginRaw = read("app/login/page.tsx");
const confirmSrc = read("app/auth/confirm/route.ts");
const verifySrc = read("app/auth/verify/route.ts");
const loaderSrc = read("core/connector-loader.ts");
const m0927 = read("supabase/migrations/20260927000001_identity_email_federation.sql");
const mBase = read("supabase/migrations/20260708000001_profiles_roles.sql");

// ──1: canonical user = ONE profile (no duplicates across providers) ────────
check("C1 canonical: email-UNIQUE + trigger same-email keeps THE original row",
  m0927.includes("profiles_email_lower_key") && m0927.includes("lower(p.email)") &&
    m0927.includes("return new;"));
check("C2 canonical anchored to auth.users (profiles.id FK) in base migration",
  mBase.includes("references auth.users(id)"));

// ──2: linked identities — one module, one reader ───────────────────────────
check("I1 layer exists: extractLinkedIdentities + resolveIdentityContext exported",
  identitySrc.includes("export function extractLinkedIdentities") &&
    identitySrc.includes("export async function resolveIdentityContext"));
const allFiles = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "core")), ...walk(join(ROOT, "services"))];
const rawIdentityReaders = allFiles.filter((f) => readFileSync(f, "utf8").includes("user.identities"));
check("I2 user.identities read ONLY inside the Identity Layer (single reader)",
  rawIdentityReaders.length === 1 && rawIdentityReaders[0].replace(/\\/g, "/").endsWith("core/identity/identity.ts"),
  rawIdentityReaders.join(", "));
check("I3 identifiers only — layer reads no env/secret (no process.env / SERVICE_ROLE)",
  !identitySrc.includes("process.env") && !identitySrc.includes("SERVICE_ROLE"));

// ──3: runtime resolves session → identity → connection (server-side) ───────
check("R1 getAuthedUser DELEGATES the chain + exposes identities/canonicalProfileId",
  sessionSrc.includes("resolveIdentityContext") && sessionSrc.includes("identities: ctx.identities") &&
    sessionSrc.includes("canonicalProfileId") &&
    sessionSrc.includes("identities?: LinkedIdentity[]"));
check("R2 email fallback lives IN the layer (id → email → same row)",
  identitySrc.includes('field: "email"') && identitySrc.includes("resolvedBy") &&
    sessionSrc.includes("resolveIdentityContext"));
check("R3 connections stay behind core/connector-loader; /login never references it",
  loaderSrc.includes("requireConnector") && !loginRaw.includes("connector-loader") &&
    !loginRaw.includes("requireConnector"));

// ──4: /login reveals NO connection complexity ──────────────────────────────
const loginCode = loginRaw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
check("L1 login (comment-stripped): no connector/credential/secret/env leakage",
  !/connector|credential|secret|process\.env|\.env|service[_ -]?role/i.test(loginCode),
  (loginCode.match(/connector|credential|secret|process\.env|\.env|service[_ -]?role/i) ?? []).join(","));

// ──5: password NEVER spread to providers ───────────────────────────────────
check("P1 /login uses numeric email OTP only",
  loginRaw.includes("signInWithOtp") &&
    loginRaw.includes('type: "email"') &&
    !loginRaw.includes("signInWithPassword") &&
    !loginRaw.includes("signInWithOAuth"));
check("P2 OAuth identity callback remains supported outside the Login UI",
  !loginRaw.includes("signInWithOAuth") && confirmSrc.includes("exchangeCodeForSession"));
check("P3 provider login UI is hidden without changing identity mapping or PKCE callback",
  !loginRaw.includes("signInWithOAuth") &&
    identitySrc.includes("resolveIdentityContext") &&
    confirmSrc.includes("exchangeCodeForSession"));

// ──6: one verifier still holds everything together ─────────────────────────
check("V1 ONE verifier /auth/confirm (magic link + PKCE) and /auth/verify only forwards",
  confirmSrc.includes("verifyOtp") && confirmSrc.includes("exchangeCodeForSession") &&
    verifySrc.includes("/auth/confirm") && !verifySrc.includes(".verifyOtp("));

console.log(`\nidentity-layer: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
