/**
 * POST /api/internal/connect/expense — Connect money-OUT bridge
 * (LINE financial-edge removal · D3 deferred work landed, owner 2026-09-24).
 *
 * เส้นเดียวที่ provider tier (Deno) สร้าง/ขยับค่าใช้จ่ายและคำขอจ่ายเงิน —
 * แทนการเขียน company_expenses / partner_payable_requests ตรง 5 จุด:
 *   External Provider → Connect normalization → POST .../expense
 *     → engines/canonical/expense-write.ts → public.* (+ canonical audit)
 *
 * Rule 72 ไม่เปลี่ยน: คำขอเริ่มเป็น pending เสมอ (writer เป็นเจ้าของ status) ·
 * การขยับ status รับเฉพาะ closed vocabulary + row-filtered update (fail-closed)
 * · เงินออกทุกแถวมี audit — ไม่มี approval ใหม่ถูกสร้างที่ bridge นี้
 *
 * Auth: one secret per bridge — EXPENSE_INTERNAL_SECRET + header
 * x-expense-internal-secret (รูปเดียวกับ payment-confirm/inbound-source) ·
 * fail-closed: ไม่มี secret = 503 · ไม่ตรง = 401 · writer ปฏิเสธ = 422 ·
 * release ต้องตั้งคู่ two-sided (Next + Supabase secrets คู่กับ DNA_OS_APP_URL)
 * — ไม่งั้น flows ฝั่ง LINE นี้ log error แล้วดำเนินการต่อแบบไม่มีแถวใหม่
 * โดย design (ไม่มีการเขียนตรง fallback)
 *
 * Envelope { ok, error?, data? } แบบเดียวกับ connect/event + payment-confirm
 */
import { NextResponse } from "next/server";
import {
  recordCompanyExpense,
  requestPartnerPayable,
  transitionPartnerPayable,
  type PayableTransitionTarget,
} from "@/engines/canonical/expense-write";

const COMMANDS = ["expense.record", "payable.request", "payable.transition"] as const;
type Command = (typeof COMMANDS)[number];

const TRANSITION_TARGETS: PayableTransitionTarget[] = ["owner_acknowledged", "completed", "paid_confirmed"];

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export async function POST(req: Request) {
  const secret = process.env.EXPENSE_INTERNAL_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "EXPENSE_INTERNAL_SECRET not configured" }, { status: 503 });
  }
  if (req.headers.get("x-expense-internal-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  let body: { command?: string; actor?: string; payload?: Record<string, unknown> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "unparseable JSON body" }, { status: 400 });
  }

  const command = str(body.command) as Command | null;
  const actor = str(body.actor);
  if (!command || !COMMANDS.includes(command as Command)) {
    return NextResponse.json({ ok: false, error: `command ต้องเป็นหนึ่งใน ${COMMANDS.join(", ")}` }, { status: 400 });
  }
  if (!actor) return NextResponse.json({ ok: false, error: "actor is required" }, { status: 400 });
  const p = obj(body.payload) ?? {};

  try {
    switch (command) {
      case "expense.record": {
        const documentType = str(p.document_type);
        const amount = numOrNull(p.amount);
        if (!documentType || amount === null) {
          return NextResponse.json({ ok: false, error: "document_type และ amount ต้องระบุ" }, { status: 400 });
        }
        const result = await recordCompanyExpense({
          document_type: documentType,
          amount,
          vendor_name: str(p.vendor_name),
          expense_date: str(p.expense_date),
          receipt_document_id: str(p.receipt_document_id),
          submitted_by_line_user_id: str(p.submitted_by_line_user_id),
          submitted_by_name: str(p.submitted_by_name),
          submitted_by_role: str(p.submitted_by_role),
          actor,
          provenance: obj(p.provenance),
        });
        return NextResponse.json({ ok: true, data: result });
      }
      case "payable.request": {
        const partnerName = str(p.partner_name);
        const amount = numOrNull(p.amount);
        if (!partnerName || amount === null) {
          return NextResponse.json({ ok: false, error: "partner_name และ amount ต้องระบุ" }, { status: 400 });
        }
        const result = await requestPartnerPayable({
          partner_company_id: str(p.partner_company_id),
          partner_name: partnerName,
          partner_line_user_id: str(p.partner_line_user_id),
          amount,
          description: str(p.description),
          business_event_id: str(p.business_event_id),
          actor,
          provenance: obj(p.provenance),
        });
        return NextResponse.json({ ok: true, data: result });
      }
      case "payable.transition": {
        const payableId = str(p.payable_id);
        const to = str(p.to) as PayableTransitionTarget | null;
        if (!payableId || !to || !TRANSITION_TARGETS.includes(to)) {
          return NextResponse.json({ ok: false, error: "payable_id และ to (owner_acknowledged/completed/paid_confirmed) ต้องระบุ" }, { status: 400 });
        }
        const result = await transitionPartnerPayable({
          payable_id: payableId,
          to,
          paid_line_event_id: str(p.paid_line_event_id),
          bank_email_verified: p.bank_email_verified === true,
          actor,
          provenance: obj(p.provenance),
        });
        return NextResponse.json({ ok: true, data: result });
      }
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "บันทึกเงินออกไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
