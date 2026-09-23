/**
 * GET /api/v1/mcp/contractor/status?ownerId=… — contractor job status (NEW-1, 2026-09-23).
 *
 * Read-only passthrough to the EXISTING job lifecycle (queueRuntime.listJobs /
 * getJob). It adds no status model of its own: the status a contractor sees is
 * exactly the queue's own job status, and ownership is enforced by queueRuntime.
 */
import { NextResponse } from "next/server"
import { authenticate } from "@/app/api/v1/mcp/governance/_lib/auth"
import { listJobs, getJob, QueueError } from "@/app/api/admin/ide/_lib/queueRuntime"

export async function GET(req: Request) {
  const auth = await authenticate(req, "read")
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const ownerId = url.searchParams.get("ownerId")?.trim()
  const jobId = url.searchParams.get("jobId")?.trim()
  if (!ownerId) return NextResponse.json({ error: "ownerId is required" }, { status: 400 })

  try {
    if (jobId) {
      return NextResponse.json({ ok: true, job: getJob(jobId, ownerId) })
    }
    return NextResponse.json({ ok: true, jobs: listJobs(ownerId) })
  } catch (err) {
    if (err instanceof QueueError) {
      return NextResponse.json({ error: err.code, detail: err.message }, { status: err.code === "JOB_NOT_FOUND" ? 404 : 403 })
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
