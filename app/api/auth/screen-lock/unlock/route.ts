// M031, owner directives 4+7+8: UNLOCK — POST /api/auth/screen-lock/unlock
// body: { pin } — verified SERVER-side against the scrypt hash (never a
// browser-only screen hide). Brute force is capped server-side by
// verifyPinAttempt (5 misses → 2-minute account lockout persisted in the DB,
// not in the browser). Success mints the short-lived HMAC unlock cookie.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthedUser } from "@/core/auth/session";
import {
  PIN_RE,
  verifyPinAttempt,
  issueUnlockToken,
  UNLOCK_COOKIE_NAME,
  unlockCookieOptions,
} from "@/core/auth/screen-lock";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getAuthedUser();
  if (!user) {
    // Dead session → the PIN cannot restore it (directive 7): back through
    // Supabase Auth (the primary verifier) is the only path.
    return NextResponse.json(
      { ok: false, error: "session_expired" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { pin?: unknown };
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!PIN_RE.test(pin)) {
    return NextResponse.json({ ok: false, error: "pin_missing" }, { status: 400 });
  }

  const result = await verifyPinAttempt(user.id, pin);
  if (result.status === "no_pin") {
    // No PIN on record → nothing to lock with; the caller (page) already
    // skips the lock screen for such users. Treat like success.
    return NextResponse.json({ ok: true, noPin: true });
  }

  if (result.status === "locked") {
    const retryAfter = Math.max(
      5,
      Math.ceil((Date.parse(result.retryAt) - Date.now()) / 1000)
    );
    return NextResponse.json(
      { ok: false, error: "too_many_attempts", attemptsLeft: 0, retryAfterSeconds: retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  if (result.status === "bad") {
    return NextResponse.json(
      { ok: false, error: "invalid_pin", attemptsLeft: result.remaining },
      { status: 401 }
    );
  }

  (await cookies()).set(
    UNLOCK_COOKIE_NAME,
    issueUnlockToken(user.id),
    unlockCookieOptions()
  );
  return NextResponse.json({ ok: true });
}
