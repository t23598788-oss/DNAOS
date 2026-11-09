/**
 * Driver-facing auth — the ONE implementation of the driver token check
 * (2026-11-09).
 *
 * Both driver endpoints use it:
 *   POST /api/driver/tracking        (accept a job / advance a stage)
 *   GET  /api/driver/available-jobs  (the job board)
 *
 * Contract (unchanged from the tracking route it was extracted from):
 *   - header  x-driver-token
 *   - secret  process.env.DRIVER_TRACKING_SECRET
 *   - unset secret  -> 503 (fail-closed: an unconfigured deployment never opens
 *                     the driver surface)
 *   - missing token -> 401
 *   - wrong token   -> 401
 *
 * Both sides are SHA-256'd before comparison so the compared buffers are always
 * 32 bytes: timingSafeEqual neither throws on a length mismatch nor leaks the
 * secret's length through timing.
 *
 * TODO: Replace shared secret with per-driver tokens when driver provisioning
 * exists.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export type DriverAuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Verify the driver token on an incoming request. Never throws. */
export function requireDriverToken(request: Request): DriverAuthResult {
  const expectedToken = process.env.DRIVER_TRACKING_SECRET;
  if (!expectedToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "driver tracking not configured" },
        { status: 503 },
      ),
    };
  }

  const providedToken = request.headers.get("x-driver-token");
  if (!providedToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "missing driver token" },
        { status: 401 },
      ),
    };
  }

  if (!tokenMatches(providedToken, expectedToken)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "invalid driver token" },
        { status: 401 },
      ),
    };
  }

  return { ok: true };
}
