/**
 * POST /api/v1/mcp/contractor/evidence-submit — contractor result/evidence intake
 * (NEW-1, 2026-09-23).
 *
 * The App-side half that ACCEPTS a contractor's result. It:
 *   - validates the response against the Universal Worker Contract's own status
 *     vocabulary (re-exported, never copied)
 *   - verifies every evidence reference through changeSetRuntime's existing
 *     verifier (DECISION/PROBLEM refs) — evidence that cannot be verified is
 *     reported back as rejected, never silently accepted
 *   - finalizes the queue job through queueRuntime's existing finalizer
 * It never writes business tables and never applies a change — applying stays
 * with the canonical authority (codeWorkerRuntime / canonical writers).
 */
import { NextResponse } from "next/server"
import { authenticate } from "@/app/api/v1/mcp/governance/_lib/auth"
import { finalizeWorkerInvokeJob } from "@/app/api/admin/ide/_lib/queueRuntime"
import { verifyEvidenceReference } from "@/app/api/admin/ide/_lib/changeSetRuntime"
import type { WorkerResponse, WorkerResponseStatus } from "@/app/api/admin/ide/_lib/workerContract"

const ALLOWED_STATUS: readonly WorkerResponseStatus[] = [
  "SUCCEEDED",
  "PARTIAL",
  "BLOCKED",
  "TIMEOUT",
  "FAILED",
  "NOT_CONFIGURED",
  "NOT_SUPPORTED",
  "UNKNOWN",
]

interface SubmitBody {
  ownerId?: string
  jobId?: string
  workerResponse?: Partial<WorkerResponse>
  evidenceRefs?: { kind: "DECISION" | "PROBLEM"; refId: string }[]
}

export async function POST(req: Request) {
  const auth = await authenticate(req, "governance:propose")
  if (!auth.ok) return auth.response

  let body: SubmitBody
  try {
    body = (await req.json()) as SubmitBody
  } catch {
    return NextResponse.json({ error: "unparseable JSON body" }, { status: 400 })
  }

  const ownerId = body.ownerId?.trim()
  const jobId = body.jobId?.trim()
  const status = body.workerResponse?.status
  if (!ownerId || !jobId || !status) {
    return NextResponse.json({ error: "ownerId, jobId and workerResponse.status are required" }, { status: 400 })
  }
  if (!ALLOWED_STATUS.includes(status)) {
    return NextResponse.json({ error: `unknown WorkerResponse status: ${status}` }, { status: 400 })
  }

  const verified: { kind: string; refId: string }[] = []
  const rejected: { kind: string; refId: string }[] = []
  for (const ref of body.evidenceRefs ?? []) {
    if (verifyEvidenceReference(ref.kind, ref.refId)) verified.push(ref)
    else rejected.push(ref)
  }

  // A result whose own evidence is unverifiable cannot be reported as SUCCEEDED.
  const effectiveStatus: WorkerResponseStatus = rejected.length > 0 && status === "SUCCEEDED" ? "PARTIAL" : status
  finalizeWorkerInvokeJob(jobId, ownerId, {
    ok: effectiveStatus === "SUCCEEDED",
    result: body.workerResponse?.output ?? null,
    error: effectiveStatus === "SUCCEEDED" ? null : (body.workerResponse?.error ?? `status=${effectiveStatus}`),
  })

  return NextResponse.json({
    ok: true,
    accepted: rejected.length === 0,
    status: effectiveStatus,
    verifiedEvidence: verified,
    rejectedEvidence: rejected,
    note:
      rejected.length > 0
        ? "some evidence references could not be verified — status downgraded to PARTIAL, nothing was applied"
        : "evidence verified; applying any change remains the canonical authority's job, not the contractor's",
  })
}
