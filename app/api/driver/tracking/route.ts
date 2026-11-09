// Driver tracking API (2026-11-09).
//
// The driver app (or the simulation harness) calls this endpoint for every
// step of a job. Each action maps to exactly one tracking-worker call, so a
// single POST advances the job by exactly one status and writes exactly one
// event — the stream can never skip a stage.
//
//   POST /api/driver/tracking
//   { "jobId": "...", "action": "accept", "truckId": "...", "driverId": "...",
//     "metadata": { "lat": 13.75, "lng": 100.5, "note": "..." } }

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/queries";
import {
  acceptJob,
  updateJobStatus,
  type TruckEventMetadata,
  type TruckJobStatus,
} from "@/engines/integration-gateway/workers/truck-tracker";

/** action -> the status it advances the job to (undefined = accept). */
const ACTION_STATUS: Record<string, TruckJobStatus> = {
  en_route_pickup: "EN_ROUTE_TO_PICKUP",
  picked_up: "PICKED_UP",
  en_route_customer: "EN_ROUTE_TO_CUSTOMER",
  at_site: "AT_SITE",
  delivered: "DELIVERED",
};

interface TrackingBody {
  jobId?: unknown;
  action?: unknown;
  truckId?: unknown;
  driverId?: unknown;
  metadata?: unknown;
}

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: TrackingBody;
  try {
    body = (await request.json()) as TrackingBody;
  } catch {
    return badRequest("invalid JSON body");
  }

  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const action = typeof body.action === "string" ? body.action : "";
  const truckId = typeof body.truckId === "string" ? body.truckId : "";
  const driverId = typeof body.driverId === "string" ? body.driverId : "";
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as TruckEventMetadata)
      : {};

  if (!jobId) return badRequest("jobId is required");
  if (action !== "accept" && !ACTION_STATUS[action]) {
    return badRequest(
      `unknown action "${action}" (expected accept, ${Object.keys(ACTION_STATUS).join(", ")})`,
    );
  }
  if (action === "accept" && (!truckId || !driverId)) {
    return badRequest("truckId and driverId are required to accept a job");
  }

  const db = supabaseAdmin();

  try {
    const job =
      action === "accept"
        ? await acceptJob(jobId, truckId, driverId, { db })
        : await updateJobStatus(
            jobId,
            ACTION_STATUS[action],
            metadata,
            driverId || "system",
            { db },
          );

    return NextResponse.json({ ok: true, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /invalid transition|already accepted/.test(message)
      ? 409
      : /not found/.test(message)
        ? 404
        : 400;

    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
