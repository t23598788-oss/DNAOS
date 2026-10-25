import { NextRequest, NextResponse } from "next/server";
import { handleCanonicalJobRequest } from "@/app/api/admin/ide/_lib/canonicalJobTransportRuntime";

// IntegrPASS 6 (G2) — internal canonical job transport endpoint.
// Auth reuses the EXISTING internal-secret header pattern (same shape as
// app/api/internal/line/command and app/api/internal/equipment/telemetry).
// No queue/state/approval/cost system is created here; the request is handed to the
// canonical job transport runtime which runs the SAME adapter → SAME canonical writer.
export async function POST(req: NextRequest) {
  const secret = process.env.CANONICAL_JOB_INTERNAL_SECRET;
  if (!secret || req.headers.get("x-canonical-job-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const response = await handleCanonicalJobRequest(payload);
  const status = response.status.startsWith("BLOCKED") ? 422 : response.status === "PENDING_APPROVAL" ? 202 : 200;
  // response contract only — never echo the request payload (no secrets in logs/responses)
  return NextResponse.json(response, { status });
}
