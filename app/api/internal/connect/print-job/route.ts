import { NextResponse } from "next/server"
import { createPrintJob, updatePrintJob } from "@/engines/canonical/print-job-write"

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

export async function POST(req: Request) {
  const secret = process.env.CONNECT_INTERNAL_SECRET
  if (!secret) return NextResponse.json({ ok: false, error: "CONNECT_INTERNAL_SECRET not configured" }, { status: 503 })
  if (req.headers.get("x-connect-internal-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "ไม่ได้รับอนุญาต" }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: "unparseable JSON body" }, { status: 400 })
  }

  const command = str(body.command)
  const actor = str(body.actor)
  if (!actor) return NextResponse.json({ ok: false, error: "actor is required" }, { status: 400 })

  try {
    if (command === "print_job.create") {
      const p = (body.payload ?? {}) as Record<string, unknown>
      const lineUserId = str(p.line_user_id)
      const mediaPath = str(p.media_path)
      const documentKind = str(p.document_kind)
      if (!lineUserId || !mediaPath || !documentKind) {
        return NextResponse.json({ ok: false, error: "field ไม่ครบ" }, { status: 400 })
      }
      const result = await createPrintJob({
        line_user_id: lineUserId,
        media_path: mediaPath,
        document_kind: documentKind,
        copies: typeof p.copies === "number" ? p.copies : 1,
        status: str(p.status) ?? "pending_payment",
      })
      return NextResponse.json({ ok: true, data: result })
    }

    if (command === "print_job.update") {
      const p = (body.payload ?? {}) as Record<string, unknown>
      const jobId = str(p.job_id)
      if (!jobId) return NextResponse.json({ ok: false, error: "job_id is required" }, { status: 400 })
      const fields = (p.fields ?? {}) as Record<string, unknown>
      const patch: Record<string, unknown> = {}
      if (fields.copies !== undefined) patch.copies = fields.copies
      if (fields.amount_expected !== undefined) patch.amount_expected = numOrNull(fields.amount_expected)
      if (fields.payment_method !== undefined) patch.payment_method = str(fields.payment_method)
      if (fields.status !== undefined) patch.status = str(fields.status)
      if (fields.paid_at !== undefined) patch.paid_at = str(fields.paid_at)
      if (fields.amount_paid !== undefined) patch.amount_paid = numOrNull(fields.amount_paid)
      const result = await updatePrintJob(jobId, patch as any)
      return NextResponse.json({ ok: true, data: result })
    }

    return NextResponse.json({ ok: false, error: `unknown command: ${String(command)}` }, { status: 400 })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "operation failed"
    return NextResponse.json({ ok: false, error: message }, { status: 422 })
  }
}
