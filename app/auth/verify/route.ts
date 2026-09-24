import { NextRequest, NextResponse } from "next/server";

// Email-template entry alias (owner, 2026-09-24): Supabase's default mailer
// templates can target {SiteURL}/auth/verify?token_hash&type=… (when the
// requested redirect isn't allow-listed in the Dashboard) — this repo's
// canonical verifier is /auth/confirm (verifyOtp / exchangeCodeForSession +
// isSafeInternalPath + failure-only rate limit). This route adds NO
// verification logic of its own: it forwards the full query to
// /auth/confirm with a 307 so there is exactly ONE authority that ever
// mints a session from a link. Without this alias those template links
//404'd — one of the three root causes of "10 login attempts, nothing
// happened".
export function GET(req: NextRequest) {
  const qs = new URL(req.url).search;
  return NextResponse.redirect(new URL(`/auth/confirm${qs}`, req.url), 307);
}