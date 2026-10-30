import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ANY_AUTHENTICATED } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";

// M030 (2026-10-31): the ONE place that records "this account set its own
// password through the Supabase Auth API". The password itself never passes
// through here — the client sets it with supabase.auth.updateUser (GoTrue),
// and this route only flips the profiles.password_set_at timestamp so
// /auth/confirm knows the account no longer needs first-time password setup.
// The service-role client writes the row: no new UPDATE policy on profiles,
// so the RLS posture is unchanged and the role column stays untouchable.
export async function POST() {
  const auth = await requireAuth(ANY_AUTHENTICATED);
  if (auth instanceof NextResponse) return auth;

  const { error } = await supabaseAdmin()
    .from("profiles")
    .update({ password_set_at: new Date().toISOString() })
    .eq("id", auth.canonicalProfileId ?? auth.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
