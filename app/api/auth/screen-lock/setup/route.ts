// M031, owner directive 3: FIRST-TIME PIN set — POST /api/auth/screen-lock/setup
// body: { pin } (6 digits; the /account/first-pin UI already made the user
// enter it twice). The server re-validates shape, requires a FRESH primary
// verification (directive 1: Supabase Auth stays THE verifier — the PIN never
// replaces it) and stores only the scrypt hash (directive 6).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthedUser } from "@/core/auth/session";
import {
  PIN_RE,
  hasWorkspacePin,
  hasFreshPrimaryVerification,
  issueUnlockToken,
  UNLOCK_COOKIE_NAME,
  unlockCookieOptions,
  hashPin,
} from "@/core/auth/screen-lock";
import { upsertWorkspaceScreenLock } from "@/gateway/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "primary_verification_required" },
      { status: 401 }
    );
  }

  if (!(await hasFreshPrimaryVerification())) {
    // Only someone who JUST completed primary verification (magic link /
    // OAuth confirmation) may create a PIN — never an unlocked-only session.
    return NextResponse.json(
      { ok: false, error: "primary_verification_required" },
      { status: 403 }
    );
  }

  if (await hasWorkspacePin(user.id)) {
    return NextResponse.json({ ok: false, error: "pin_exists" }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { pin?: unknown };
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!PIN_RE.test(pin)) {
    return NextResponse.json({ ok: false, error: "pin_invalid" }, { status: 400 });
  }

  // DB: only the hash — the plaintext PIN never persists anywhere.
  await upsertWorkspaceScreenLock(user.id, hashPin(pin));

  // First unlock happens implicitly: issue the unlock cookie now so the new
  // user lands IN the workspace instead of being quizzed on a PIN they just
  // set (matches the phone-onboarding feel, directive 4).
  (await cookies()).set(
    UNLOCK_COOKIE_NAME,
    issueUnlockToken(user.id),
    unlockCookieOptions()
  );

  return NextResponse.json({ ok: true });
}
