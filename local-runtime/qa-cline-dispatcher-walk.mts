// OWNER → CLINE → CAPABILITY DISPATCHER → BUSINESS READER (Leg B, read-only)
// npx tsx local-runtime/qa-cline-dispatcher-walk.ts — no Ollama, no new agent
import { dispatch } from "../engines/validation/dispatcher"

const results: { id: string; ok: boolean; detail: string }[] = []
const mark = (id: string, ok: boolean, detail: string) => {
  results.push({ id, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} — ${detail}`)
}

// B1 — บริษัท: partner.list (companies summary ผ่าน dispatcher)
let t = Date.now()
const partners = await dispatch("partner.list", {})
const partnerRows = partners.ok && Array.isArray(partners.data) ? (partners.data as Record<string, unknown>[]) : []
mark("B1 partner.list (บริษัท)", partners.ok && partnerRows.length > 0, `${Date.now() - t}ms → ${partnerRows.length} ราย เช่น "${String(partnerRows[0]?.name ?? partnerRows[0]?.partner_name ?? "?")}"`)

// B2 — เอกสาร: document.list (canonical documents ผ่าน dispatcher)
t = Date.now()
const docs = await dispatch("document.list", {})
const docRows = docs.ok && Array.isArray(docs.data) ? (docs.data as Record<string, unknown>[]) : []
const byType = new Map<string, number>()
for (const d of docRows) byType.set(String(d.document_type ?? "?"), (byType.get(String(d.document_type ?? "?")) ?? 0) + 1)
mark("B2 document.list (เอกสาร)", docs.ok && docRows.length > 0, `${Date.now() - t}ms → ${docRows.length} ฉบับ (${[...byType.entries()].map(([k, v]) => `${k}:${v}`).join(" ")})`)

// B3 — หนี้ค้าง (business read)
t = Date.now()
const debts = await dispatch("debt.list", {})
const debtRows = debts.ok && Array.isArray(debts.data) ? (debts.data as Record<string, unknown>[]) : []
mark("B3 debt.list (หนี้ค้าง)", debts.ok, `${Date.now() - t}ms → ${debtRows.length} ราย`)

// B4 — ประวัติกิจกรรมจริงของคู่ค้า: partner.timeline กับคู่ค้าที่ "มีธุรกรรมจริง"
// จริง (เลือกจากรายการ invoice.list แรกที่มี partner_id — บริษัท ช.ธวัชชัยการช่าง)
t = Date.now()
const inv = await dispatch("invoice.list", {})
const invRows = inv.ok && Array.isArray(inv.data) ? (inv.data as { partner_id?: string; party_name?: string }[]) : []
const withPartner = invRows.find((r) => typeof r.partner_id === "string" && r.partner_id.length > 0)
if (withPartner?.partner_id) {
  const tl = await dispatch("partner.timeline", { partner_id: withPartner.partner_id })
  const data = tl.ok && tl.data && typeof tl.data === "object" ? (tl.data as { timeline?: unknown[]; summary?: unknown }) : null
  mark("B4 partner.timeline (ประวัติกิจกรรมจริง)", tl.ok && Boolean(data) && (data?.timeline?.length ?? 0) > 0, `${Date.now() - t}ms → "${withPartner.party_name}" timeline รายการ = ${data?.timeline?.length ?? 0}`)
} else {
  mark("B4 partner.timeline (ประวัติกิจกรรมจริง)", false, "invoice.list ไม่มีแถวที่มี partner_id")
}

// B5 — ยืนยัน dispatcher ไม่มีเส้นทางเขียน: คำสั่งนอก registry ต้องถูกปฏิเสธ
t = Date.now()
const bogus = await dispatch("partner.delete", {})
mark("B5 write-command rejected", !bogus.ok, `${Date.now() - t}ms → ${JSON.stringify(bogus).slice(0, 120)}`)

console.log("\nLEG-B RESULT:", results.filter((r) => r.ok).length + "/" + results.length, "PASS")
process.exit(results.every((r) => r.ok) ? 0 : 1)
