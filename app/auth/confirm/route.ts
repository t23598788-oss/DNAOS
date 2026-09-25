import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/services/supabase/server";
import { isSafeInternalPath } from "@/core/auth/resolveDestination";

// THE single authentication entry for emailed links (promoted from "backup
// path" by the owner's one-flow directive, 2026-09-24): /login sends a
// Supabase magic link (signInWithOtp), the click lands HERE with token_hash +
// type (magiclink | recovery | signup | …), verifyOtp sets the session
// server-side, then redirects through the SAME isSafeInternalPath ?next=
// guard → /app role-bounce → workspace. Recovery uses this identical route —
// one flow, one way in.

// Per-IP sliding-window limiter against token_hash brute-forcing (TASK-001,
// DNA-000072). In-memory only — resets per server instance, not shared across
// serverless regions/cold-starts, so this is defense-in-depth on top of
// Supabase's own token expiry/single-use enforcement, not a hard guarantee.
// No existing rate-limit utility in the repo to extend (checked per Rule
// 103), and this is the only endpoint that needs one, so kept local rather
// than building a shared abstraction for a single caller.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const failuresByIp = new Map<string, number[]>();

// Failure-only sliding window (fix, 2026-09-24): the OLD limiter pushed a
// timestamp on EVERY /auth/confirm hit — including a user's own VALID link
// clicks — so anyone who touched the endpoint 5+ times in 10 minutes (one
// real Owner run was 10 attempts) got bounced to ?error=too_many_attempts
// even with a perfectly valid link, and the old login page showed NO error
// for it (silent lockout). Now only FAILED verifications count, and a
// success clears the bucket. Supabase still enforces token expiry/single-use
// server-side — this stays defense-in-depth only.
function pruneFailures(ip: string): number[] {
  const now = Date.now();
  const list = (failuresByIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  failuresByIp.set(ip, list);
  return list;
}
function isRateLimited(ip: string): boolean {
  return pruneFailures(ip).length > MAX_ATTEMPTS;
}
function recordFailure(ip: string): void {
  const list = pruneFailures(ip);
  list.push(Date.now());
  failuresByIp.set(ip, list);
}
function clearFailures(ip: string): void {
  failuresByIp.delete(ip);
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code"); // PKCE return from provider OAuth (Google/Apple/Microsoft)
  const providerError = searchParams.get("error"); // provider denied / not configured in Dashboard
  const next = searchParams.get("next") ?? "/app";
  // ?next= is attacker-controllable: `new URL("//evil.com", origin)` resolves
  // to https://evil.com (protocol-relative). Guard through the SAME
  // isSafeInternalPath authority resolveDestination uses; unsafe → default.
  const safeNext = isSafeInternalPath(next) ? next : "/app"; // /app = role-bounce entry (PWA start_url)

  if (providerError) {
    const errorCode = searchParams.get("error_code");
    const target = new URL("/login", origin);
    target.searchParams.set("error", errorCode === "otp_expired" ? "invalid_link" : "oauth_denied");
    target.searchParams.set("next", safeNext);
    return NextResponse.redirect(target);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.redirect(new URL("/login?error=too_many_attempts", origin));
  }

  const supabase = await createServerSupabase();

  // Provider OAuth (PKCE return from Google/Apple/Microsoft): SAME one
  // verifier entry — exchange the code, then the identical safe-next redirect.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      recordFailure(ip);
      return NextResponse.redirect(new URL("/login?error=invalid_link", origin));
    }
    clearFailures(ip);
    return NextResponse.redirect(new URL(safeNext, origin));
  }

  if (!tokenHash || !type) {
    // Nothing was guessed here (no oracle) — redirect WITHOUT counting.
    return NextResponse.redirect(new URL("/login?error=invalid_link", origin));
  }

  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    recordFailure(ip);
    return NextResponse.redirect(new URL("/login?error=invalid_link", origin));
  }
  clearFailures(ip);
  return NextResponse.redirect(new URL(safeNext, origin));
}
