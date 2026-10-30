import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import {
  getWorkspaceScreenLock,
  recordScreenLockFailure,
  type WorkspaceScreenLockRow,
} from "@/gateway/auth";
import type { AuthedUser } from "./session";

// M031 — THE screen-lock authority (server side only). The browser never
// receives the PIN, its hash, or anything equivalent: it sends the raw PIN to
// /api/auth/pin-unlock and gets back a short-lived HMAC unlock cookie it can
// neither read (httpOnly) nor forge. The real Supabase Auth session remains
// the FIRST credential — the PIN only re-opens the workspace this same user
// already unlocked, like a phone lock: no second login system, no cross-user
// or cross-org transfer.

export const UNLOCK_COOKIE_NAME = "dnaos_screen_unlock";
export const PIN_LENGTH = 6;
export const PIN_RE = /^\d{6}$/;

// Brute-force guard: 5 wrong entries per account → 5-minute lockout, then the
// counter resets on the next successful unlock. Counter + timestamps live in
// workspace_screen_locks (service-role write, RLS-NOPOLICY) so they survive
// redeploy/restart — a browser can't reset them.
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 2;

// The unlock cookie is a BROWSER-SESSION cookie (no Max-Age): closing the
// tab/browser ends the unlocked state — reopen the workspace and the phone
// lock is back, which is exactly the owner's requested behavior. The signed
// expiry backstop is only a freshness bound inside one browser session.
const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;

// "จำ PIN ไม่ได้" fallback: within this window after a primary verification
// (magic link / password / OAuth just completed) the user may reset the PIN
// without entering the old one. Outside the window the only path is primary
// verification again.
export const FRESH_VERIFICATION_MS = 10 * 60 * 1000;

// HMAC over the service-role key — a server-only secret that already rotates
// with the project; nothing user-facing can derive it.
function lockSecret(): Buffer {
  return createHash("sha256")
    .update(`${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}|dnaos-screen-lock-v1`)
    .digest();
}

export function issueUnlockToken(userId: string): string {
  const body = `${userId}.${Date.now() + UNLOCK_TTL_MS}`;
  const mac = createHmac("sha256", lockSecret()).update(body).digest("base64url");
  return `${mac}.${body}`;
}

export function unlockCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

const b64urlOk = (s: string) => /^[A-Za-z0-9_-]+$/.test(s);

export async function isWorkspaceUnlocked(userId: string): Promise<boolean> {
  const raw = (await cookies()).get(UNLOCK_COOKIE_NAME)?.value;
  if (!raw) return false;
  const parts = raw.split(".");
  const [mac, tokenUserId, expStr, ...rest] = parts;
  if (rest.length !== 0 || !mac || !tokenUserId || !expStr) return false;
  if (tokenUserId !== userId || !/^\d+$/.test(expStr) || !b64urlOk(mac)) return false;
  const expected = createHmac("sha256", lockSecret())
    .update(`${tokenUserId}.${expStr}`)
    .digest("base64url");
  if (mac !== expected) return false; // constant-length, fixed strings — race-safe compare not required for a digest over public data
  return Number(expStr) > Date.now();
}

export async function hasWorkspacePin(userId: string): Promise<boolean> {
  return (await getWorkspaceScreenLock(userId)) !== null;
}

// The one funnel check both authorities (requireAuth / requireAuthPage) use:
// true = this user must pass the lock screen before anything protected.
// Users without a PIN are never blocked (M030/M028 accounts keep working
// unchanged); a verified session alone never unlocks someone else's screen.
export async function needsWorkspaceUnlock(user: AuthedUser): Promise<boolean> {
  const row = await getWorkspaceScreenLock(user.id);
  if (!row) return false;
  return !(await isWorkspaceUnlocked(user.id));
}

// ── PIN material (never logged, never stored plaintext) ────────────────────
export function hashPin(pin: string): string {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  const dk = scryptSync(pin, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${dk.toString("hex")}`;
}

export function verifyPinHex(pin: string, stored: string): boolean {
  const [scheme, nStr, rStr, pStr, saltHex, dkHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !dkHex) return false;
  const N = Number(nStr), r = Number(rStr), p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const dk = scryptSync(pin, Buffer.from(saltHex, "hex"), Buffer.from(dkHex, "hex").length, { N, r, p });
  const storedBytes = Buffer.from(dkHex, "hex");
  return dk.length === storedBytes.length && timingSafeEqual(dk, storedBytes);
}

export type UnlockAttempt =
  | { status: "ok" }
  | { status: "bad"; remaining: number }
  | { status: "locked"; retryAt: string }
  | { status: "no_pin" };

export async function verifyPinAttempt(userId: string, pin: string): Promise<UnlockAttempt> {
  const row = await getWorkspaceScreenLock(userId);
  if (!row) return { status: "no_pin" };
  if (row.lockedUntil && Date.parse(row.lockedUntil) > Date.now()) {
    return { status: "locked", retryAt: row.lockedUntil };
  }
  if (verifyPinHex(pin, row.pinHash)) {
    await recordScreenLockFailure(userId, 0, null); // success clears the counter (best effort — row must exist)
    return { status: "ok" };
  }
  const failed = (row.failedAttempts ?? 0) + 1;
  if (failed >= MAX_FAILED_ATTEMPTS) {
    // The threshold miss itself closes the session: report "locked" right on
    // the 5th try, not one attempt later, so the client never sees the pad
    // as merely "wrong" when the account has just been locked.
    const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
    await recordScreenLockFailure(userId, failed, lockedUntil);
    return { status: "locked", retryAt: lockedUntil };
  }
  await recordScreenLockFailure(userId, failed, null);
  return { status: "bad", remaining: Math.max(0, MAX_FAILED_ATTEMPTS - failed) };
}

// Fresh primary verification = the GoTrue session itself was minted recently
// (magic link / password / OAuth just went through). Only then may an
// existing PIN be replaced without re-entering it.
export async function hasFreshPrimaryVerification(): Promise<boolean> {
  const { getServerSupabaseClient } = await import("@/gateway/auth");
  const supabase = await getServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  const lastSignInAt = (data.user as { last_sign_in_at?: string | null } | null)?.last_sign_in_at ?? null;
  const t = lastSignInAt ? Date.parse(lastSignInAt) : NaN;
  return Number.isFinite(t) && Date.now() - t <= FRESH_VERIFICATION_MS;
}

export function lockRowInfo(row: WorkspaceScreenLockRow) {
  return {
    failedAttempts: row.failedAttempts,
    isLocked: !!(row.lockedUntil && Date.parse(row.lockedUntil) > Date.now()),
    lockedUntil: row.lockedUntil,
  };
}
