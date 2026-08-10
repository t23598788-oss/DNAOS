/**
 * GET /api/admin/system-reality — real, live Owner System Reality Report
 * (owner, 2026-08-10, Capability Roadmap #57 "OWNER SYSTEM REALITY
 * REPORT", STEP 4+5, registry/TASK_QUEUE.json TASK-053 follow-on,
 * Constitution Rule 252 — dispatched to CODE_WORKER). ADMIN_TIER, same
 * requireAuth() convention as every other app/api/admin/* route.
 *
 * This route is pure wiring: it calls buildOwnerSystemRealityReport()
 * (app/api/admin/system-reality/_lib/ownerLanguage.ts), which itself
 * calls the real, already-built, already-tested (26/26)
 * buildSystemRealityModel() (app/api/admin/ide/_lib/systemRealityRuntime
 * .ts, STEP 2+3, TASK-053, read-only from here) — no new fact is
 * computed in this file. SCOPE DISCIPLINE (this task's own explicit
 * instruction): STEP 4+5 only — a one-time fetch-on-mount page, no
 * realtime/polling wiring (STEP 6) and no Gap Loop integration (STEP 7),
 * both separate, later tasks.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { buildOwnerSystemRealityReport } from "./_lib/ownerLanguage";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const report = await buildOwnerSystemRealityReport();
  return NextResponse.json({ ok: true, report });
}
