import { getCanonicalDebtForCompany } from "./relationship-qa.ts"
import { sendConnectEventCommand, CONNECT_PROVIDER } from "../../_shared/connect-event.ts"

// Payment Instructions — auto-send (owner, 2026-07-18)
//
// Real bug this fixes: a customer typing "ส่งเลขบัญชีมาด้วยตงครับ" (please
// send the account number) got swallowed by debt-followup.ts's
// tryFollowUpDebtAck — that function treats ANY non-acknowledgment reply
// while awaiting a payment date as the customer's answer, recorded verbatim
// ("บันทึกไว้แล้วว่าจะชำระ 'ส่งเลขบัญชีมาด้วยตงครับ'..."). This detector
// must run BEFORE that check (see handlers/text.ts's ordering) so a genuine
// request for our bank details is recognized for what it is, not silently
// misfiled as a scheduling answer.
//
// Owner's framing: Invoice / Debt Reminder / Payment Instructions / Payment
// Verification are four separate cards with one job each — this is the
// third. Sends real company bank details (core/config/company-settings.ts's
// payment-bank-name/payment-account-number/payment-account-name, already
// used on every printed document — not new/secret data) plus a reference
// number and suggested amount, and logs a distinct
// "แจ้งข้อมูลการชำระเงิน" business_events row so it never blends with the
// debt-reminder or invoice timeline entries.

// Real bug, live 2026-07-30: a customer typed "ขอเลขบชคับ" — the common
// abbreviation "บช" for "บัญชี" — which none of the full-word alternatives
// below matched, so the request fell through to the awaiting-info nag
// (tryCompleteAwaitingEvent) instead of ever reaching this detector. Added
// "เลขบช"/"ขอบช"/"ส่งบช" as their own alternatives rather than trying to
// generalize "บช" alone, since "บช" alone is common enough to false-positive
// on unrelated text (it isn't a real Thai word by itself).
const ACCOUNT_INFO_PATTERN = /(เลขบัญชี|เลขที่บัญชี|บัญชีอะไร|โอนไปบัญชีไหน|ขอบัญชี|ส่งบัญชี|ชื่อบัญชี|ขอเลขที่บัญชี|เลขบช|ขอบช|ส่งบช)/

export function isPaymentInfoRequest(text: string): boolean {
  return ACCOUNT_INFO_PATTERN.test(text)
}

export async function tryBuildPaymentInstructionsReply(supabase: any, userId: string): Promise<string | null> {
  // Same direct-link-first company match every other consumer uses.
  const { data: link } = await supabase
    .from("company_line_links").select("company_id, companies(name)").eq("line_user_id", userId).maybeSingle()
  const company = (link as any)?.companies ? { id: (link as any).company_id, name: (link as any).companies.name } : null
  if (!company) return null

  const { data: configRows } = await supabase
    .from("app_configs")
    .select("title, data")
    .in("title", ["company-name", "payment-bank-name", "payment-account-number", "payment-account-name"])
  const config = Object.fromEntries((configRows ?? []).map((r: any) => [r.title, r.data]))
  const bankName = config["payment-bank-name"]
  const accountNumber = config["payment-account-number"]
  const accountName = config["payment-account-name"]
  if (!bankName || !accountNumber || !accountName) return null // not configured — honest, don't send half-filled instructions

  // The amount is the same canonical debt calculation used by the workspace,
  // debt inquiry, reminder route, and header. Invoice totals are references,
  // not a second balance source.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("invoice_no, total_amount")
    .eq("customer_company_id", company.id)
    .neq("invoice_status", "VOID")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  let referenceLine = ""
  let amountLine = ""
  const currentDebt = await getCanonicalDebtForCompany(supabase, company.id)

  // Real bug, owner-reported 2026-07-30: "พี่หนุ่ม" asked for the account
  // number right after sending a photo of an excavator (KX-033) — this was
  // about an EQUIPMENT rental/management fee for that specific vehicle, not
  // the customer's material/invoice debt. This code used to always attach
  // the generic company debt total regardless of what the payment was
  // actually for — silently wrong here, since "พี่หนุ่ม" isn't a customer
  // with a material debt at all, he's an operator paying a vehicle fee.
  // driver_equipment_permissions (built for the GPS-unlock feature, but a
  // real existing link between a LINE contact and a specific vehicle) is
  // the one place that connects this contact to a vehicle today — if it
  // says this contact is tied to one or more real vehicles, don't guess
  // which fee this is for; ask, instead of attaching an unrelated debt
  // total that just happens to exist for whatever company_line_links
  // matched. Bank details themselves are still safe to send either way —
  // it's the same one company account regardless of what the payment is for.
  const { data: linkedEquipment } = await supabase
    .from("driver_equipment_permissions")
    .select("equipment_assets(name, asset_code)")
    .eq("line_user_id", userId)
    .eq("is_active", true)

  const equipmentNames = (linkedEquipment ?? [])
    .map((r: any) => r.equipment_assets?.name)
    .filter(Boolean)

  if (equipmentNames.length > 0) {
    referenceLine = ""
    amountLine = ""
  } else {
    if (invoice) referenceLine = `อ้างอิง ${invoice.invoice_no}\n`
    if (currentDebt) amountLine = `ยอดคงเหลือ ${currentDebt.totalDue.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท\n`
  }

  const clarifyLine = equipmentNames.length > 0
    ? `\n(พี่เกี่ยวข้องกับรถ ${equipmentNames.join(", ")} — โอนเป็นค่าอะไรครับ เช่น ค่าเช่า/ค่าบริหารจัดการ/ค่าซ่อม จะได้บันทึกยอดให้ถูกต้องครับ)`
    : ""

  const replyText =
    `เรียนลูกค้า\nสามารถชำระเงินได้ที่\n` +
    `ธนาคาร${bankName}\n` +
    `เลขบัญชี ${accountNumber}\n` +
    `ชื่อบัญชี ${accountName}\n` +
    amountLine + referenceLine +
    `หลังโอนแล้วสามารถส่งสลิปกลับมาในแชตนี้ได้ครับ` +
    clarifyLine

  // Timeline event — deliberately separate event_type from "แจ้งชำระเงิน"
  // (debt reminder) and invoice creation, so the three never blend in the
  // partner timeline (owner's own stated goal: one card, one job).
  const todayStr = new Date().toISOString().slice(0, 10)
  const { count } = await supabase
    .from("business_events").select("id", { count: "exact", head: true }).gte("created_at", todayStr)
  const yy = new Date().getFullYear().toString().slice(-2)
  const mm = String(new Date().getMonth() + 1).padStart(2, "0")
  const dd = String(new Date().getDate()).padStart(2, "0")
  const eventCode = `EV${yy}${mm}${dd}-${String((count ?? 0) + 1).padStart(4, "0")}`

  // Capability D: business event mutation goes through the Connect transport
  // boundary → canonical event writer. No direct table write remains here.
  await sendConnectEventCommand("business_event.create", {
    event_code: eventCode,
    event_type: "แจ้งข้อมูลการชำระเงิน",
    event_date: todayStr,
    title: invoice ? `ส่งข้อมูลการชำระเงิน อ้างอิง ${invoice.invoice_no}` : "ส่งข้อมูลการชำระเงิน",
    source_provider: CONNECT_PROVIDER,
    source_external_subject_id: userId,
    partner_id: company.id,
    status: "sent",
    confidence: 1,
  }, `system:${CONNECT_PROVIDER}:payment-instructions`)

  return replyText
}
