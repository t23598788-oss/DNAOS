/**
 * GET /api/cron/operations-loop — real Vercel Cron endpoint for the
 * Continuous Operations Loop (owner, 2026-08-08, Software Factory Step
 * 12.5). Mirrors the SAME real CRON_SECRET + `Authorization: Bearer`
 * pattern app/api/cron/supabase-project-status/route.ts already uses in
 * production — the real, established Scheduler Adapter contract for
 * this app, never a second convention invented.
 *
 * Real, honest limitation (documented, not hidden): there is no real,
 * stable "the owner's admin session id" available to a cron-triggered
 * request (cron has no session). This route runs the loop under a real,
 * fixed sentinel ownerId ("system-cron") — real data, but scoped
 * separately from whatever id a human admin's live session uses. Wiring
 * these together requires a real, deployed owner-identity decision,
 * which is out of scope this Step (no real deploy happens here either).
 */
import { NextResponse } from "next/server";
import { runOperationsLoop } from "../../admin/ide/_lib/continuousOperationsRuntime";

const CRON_OPERATIONS_OWNER_ID = "system-cron";

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const run = await runOperationsLoop(CRON_OPERATIONS_OWNER_ID, "cron@dnaos.internal", "CRON");
  return NextResponse.json({ ok: run.status === "SUCCEEDED", runId: run.runId, status: run.status, signalsCollected: run.signalsCollected, incidentsOpened: run.incidentsOpened, alertsDispatched: run.alertsDispatched });
}
