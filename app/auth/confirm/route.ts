import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/services/supabase/server";

// Handles magic-link / OTP-based sign-in (backup login path, 2026-07-14).
// Admin-generated links (supabaseAdmin().auth.admin.generateLink) redirect
// here with token_hash + type instead of a PKCE `code`, so this uses
// verifyOtp — the counterpart the anon signInWithOtp() flow needs too, so
// both paths land on the same route.

// Per-IP sliding-window limiter against token_hash brute-forcing (TASK-001,
// DNA-000072). In-memory only — resets per server instance, not shared across
// serverless regions/cold-starts, so this is defense-in-depth on top of
// Supabase's own token expiry/single-use enforcement, not a hard guarantee.
// No existing rate-limit utility in the repo to extend (checked per Rule
// 103), and this is the only endpoint that needs one, so kept local rather
// than building a shared abstraction for a single caller.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const attemptsByIp = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const attempts = (attemptsByIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  attempts.push(now);
  attemptsByIp.set(ip, attempts);
  return attempts.length > MAX_ATTEMPTS;
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/account/change-password";

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.redirect(new URL("/login?error=too_many_attempts", origin));
  }

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=invalid_link", origin));
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    return NextResponse.redirect(new URL("/login?error=invalid_link", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
