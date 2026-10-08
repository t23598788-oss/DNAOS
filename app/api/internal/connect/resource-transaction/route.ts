/**
 * POST /api/internal/connect/resource-transaction — machinery/resource bridge
 * (KIS canonical path — BATCH 19/20).
 *
 * ประตูเดียวที่สร้าง resource_transactions — คำขอนี้ →
 * engines/canonical/resource-transaction-write.ts#recordResourceTransaction
 * (canonical writer + validation + idempotency + recordCanonicalAudit).
 * Edge function (kis-webhook) ไม่เขียน DB โดยตรงอีกต่อไป:
 *
 *   KIS email → SendGrid Inbound Parse → functions/v1/kis-webhook
 *     → POST .../resource-transaction → recordResourceTransaction
 *     → public.resource_transactions (+ canonical audit)
 *
 * Auth: RESOURCE_TRANSACTION_INTERNAL_SECRET + header
 * x-resource-transaction-internal-secret (รูปแบบเดียวกับ inbound-source
 * bridge ทั้งหมด) · fail-closed: ไม่มี secret = 503 · ไม่ตรง = 401 ·
 * writer ปฏิเสธ = 422 ok:false (ไม่มี fallback ไม่มีการ insert ตรง).
 *
 * Body: field-by-field (ไม่มี object spread เข้า writer) · actor บังคับ ·
 * money fields ห้ามมาจาก caller — writer คำนวณจาก config authority เอง
 * Envelope { ok, error?, data? } รูปเดียวกับ inbound-source
 */
import { NextResponse } from "next/server";
import { recordResourceTransaction } from "@/engines/canonical/resource-transaction-write";

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface ResourceTransactionRequest {
  source?: string;
  source_event_id?: string;
  resource_id?: string | null;
  resource_label?: string;
  job_id?: string;
  started_at?: string;
  duration_hours?: number;
  evidence_ref?: string;
  received_at?: string;
  actor?: string;
}

export async function POST(req: Request) {
  const secret = process.env.RESOURCE_TRANSACTION_INTERNAL_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "RESOURCE_TRANSACTION_INTERNAL_SECRET not configured" }, { status: 503 });
  }
  if (req.headers.get("x-resource-transaction-internal-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  let body: ResourceTransactionRequest;
  try {
    body = (await req.json()) as ResourceTransactionRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "unparseable JSON body" }, { status: 400 });
  }

  const source = str(body.source);
  const sourceEventId = str(body.source_event_id);
  const resourceLabel = str(body.resource_label);
  const jobId = str(body.job_id);
  const startedAt = str(body.started_at);
  const receivedAt = str(body.received_at);
  const evidenceRef = str(body.evidence_ref);
  const actor = str(body.actor);
  const duration = num(body.duration_hours);
  if (!source || !sourceEventId || !resourceLabel || !jobId || !startedAt || !receivedAt || !evidenceRef || !actor || duration === null) {
    return NextResponse.json({ ok: false, error: "field ไม่ครบ: source, source_event_id, resource_label, job_id, started_at, duration_hours, evidence_ref, received_at, actor" }, { status: 400 });
  }

  try {
    const created = await recordResourceTransaction({
      source,
      source_event_id: sourceEventId,
      resource_id: str(body.resource_id) ?? null,
      resource_label: resourceLabel,
      job_id: jobId,
      started_at: startedAt,
      duration_hours: duration,
      evidence_ref: evidenceRef,
      received_at: receivedAt,
      actor,
    });
    return NextResponse.json({ ok: true, data: created });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "บันทึกรายการทรัพยากรไม่สำเร็จ";
    // canonical writer ปฏิเสธ (config authority / job / duration / time rules)
    // — fail-closed 422, ไม่มี fallback insert
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
