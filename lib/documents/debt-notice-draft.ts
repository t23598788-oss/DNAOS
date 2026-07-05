import { getDebtTrackingById, getFirstInvoiceForPartner } from "@/lib/supabase/queries"
import { calcDebtTrackingSummary } from "@/lib/v3-engines/debt/tracking"
import { createEmptyDocumentDraft, mapPartnerToCustomer, toThaiDate, type DocumentDraftInput } from "@/lib/documents/document-editor"

export async function buildDebtNoticeDraft(id: string): Promise<DocumentDraftInput | undefined> {
  try {
    const tracking = await getDebtTrackingById(id)
    const partner = tracking.partners as unknown as { id: string; name: string; phone?: string; address?: string; tax_id?: string; contact_name?: string } | null
    const firstInvoice = await getFirstInvoiceForPartner(tracking.partner_id, tracking.customer_name)
    const summary = calcDebtTrackingSummary({
      principalAmount: Number(tracking.principal_amount ?? 0),
      feeRate: Number(tracking.fee_rate ?? 0),
      interestStartAt: tracking.interest_start_at,
    })

    const draft = createEmptyDocumentDraft("debt_notice")
    draft.partnerId = tracking.partner_id ?? ""
    draft.customer = partner ? mapPartnerToCustomer(partner) : { ...draft.customer, name: tracking.customer_name }
    draft.reference = firstInvoice?.document_number ?? ""
    draft.note = `อ้างอิงยอดหนี้จากระบบติดตามหนี้ เริ่มคิดดอกเบี้ยตั้งแต่ ${toThaiDate(tracking.interest_start_at?.split("T")[0] ?? "")}`
    draft.vatEnabled = false
    draft.debt = {
      principal: summary.principalAmount,
      fee: summary.feeAmount,
      daysOverdue: summary.daysElapsed,
      interestRate: summary.interestRate,
      interestAccrued: summary.interestAmount,
      penalty: summary.penaltyAmount,
      defaultDate: toThaiDate(summary.defaultDate),
    }
    draft.rows = [
      { description: "เงินต้น", qty: 1, unit: "รายการ", unitPrice: summary.principalAmount },
      { description: `ค่าธรรมเนียม ${summary.feeRate}%`, qty: 1, unit: "รายการ", unitPrice: summary.feeAmount },
      { description: `ดอกเบี้ย ${(summary.interestRate * 100).toFixed(0)}%/ปี (${summary.daysElapsed} วัน)`, qty: 1, unit: "รายการ", unitPrice: summary.interestAmount },
    ]
    if (summary.penaltyAmount > 0) {
      draft.rows.push({
        description: `ค่าปรับ/ค่าติดตามทวงถาม (เกินกำหนด ${summary.daysOverdue} วัน)`,
        qty: 1,
        unit: "รายการ",
        unitPrice: summary.penaltyAmount,
      })
    }
    return draft
  } catch {
    return undefined
  }
}
