import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/services/supabase/server";

// Handles magic-link / OTP-based sign-in (backup login path, 2026-07-14).
// Admin-generated links (supabaseAdmin().auth.admin.generateLink) redirect
// here with token_hash + type instead of a PKCE `code`, so this uses
// verifyOtp — the counterpart the anon signInWithOtp() flow needs too, so
// both paths land on the same route.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/account/change-password";

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=invalid_link", origin));
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    console.log("[TRACE-LOGIN] /auth/confirm: verifyOtp failed", { message: error.message });
    return NextResponse.redirect(new URL("/login?error=invalid_link", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
