// patch235b: purchase.history ทุกชั้น — node (utf8 safe)
import { readFileSync, writeFileSync } from "node:fs"
const root = "/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/"
// 1) dispatcher QUERY_MAP
const dp = root + "engines/validation/dispatcher.ts"
let d = readFileSync(dp, "utf8")
const dm = `  "material.sources": async (p) => {`
const add = `  // DNA-000235: "ใครเคยซื้อทรายจากเรา" — ต้องมีหลักฐาน transaction จริง ห้ามเดา (VOID ไม่นับ)
  "purchase.history": async (p) => {
    const materialName = typeof p.material === "string" ? p.material.trim() : null
    const companyName = typeof p.company === "string" ? p.company.trim() : null
    const inv = await supabaseAdmin.from("invoices").select("id, invoice_no, invoice_status, invoice_date, total_amount, paid_amount, companies:customer_company_id(id, name), invoice_items(id, description, qty, unit, line_total)").neq("invoice_status", "VOID").order("invoice_date", { ascending: false }).limit(200)
    if (inv.error) throw new Error("query error: " + inv.error.message)
    type InvRow = { invoice_no: string; invoice_status: string; invoice_date: string; total_amount: number; companies: { id: string; name: string } | null; invoice_items: { description: string; qty: number; unit: string; line_total: number }[] }
    const rows = (inv.data ?? []) as unknown as InvRow[]
    const byCompany = companyName ? rows.filter((r) => r.companies?.name?.includes(companyName)) : rows
    if (!materialName) {
      return { total: byCompany.length, invoices: byCompany.map((r) => ({ invoice_no: r.invoice_no, status: r.invoice_status, date: r.invoice_date, company: r.companies?.name ?? "(ไม่ระบุ)", total: r.total_amount, items: r.invoice_items.map((i) => ({ desc: i.description, qty: i.qty, unit: i.unit })) })), note: "ใบแจ้งหนี้ที่ใช้งาน (ไม่นับ VOID) จาก invoices + invoice_items จริง" }
    }
    const matched = byCompany.filter((r) => r.invoice_items.some((i) => i.description?.includes(materialName)))
    if (matched.length === 0) {
      return { PARTIAL_RESULT: true, material: materialName, matched_invoices: 0, reason: "invoice_items ไม่มีคอลัมน์ material_type_id — จับคู่จากข้อความ description เท่านั้น และไม่พบรายการที่ระบุวัสดุนี้ในใบแจ้งหนี้ที่ใช้งาน (VOID ไม่นับ) ความสัมพันธ์วัสดุ-บิลระดับ master ยังไม่มีในระบบ" }
    }
    return { material: materialName, matched_invoices: matched.length, evidence: matched.map((r) => ({ invoice_no: r.invoice_no, date: r.invoice_date, company: r.companies?.name, items: r.invoice_items.filter((i) => i.description?.includes(materialName)).map((i) => ({ desc: i.description, qty: i.qty, unit: i.unit, line_total: i.line_total })) })), note: "จับคู่จาก invoice_items.description (ไม่ใช่ FK วัสดุ) — หลักฐานเบื้องต้น ตรวจสอบก่อนใช้ตัดสินใจ" }
  },
`
if (d.includes(dm) && !d.includes('"purchase.history"')) { d = d.replace(dm, add + dm); writeFileSync(dp, d); console.log("dispatcher ok") } else console.log("dispatcher:", d.includes('"purchase.history"') ? "already" : "MISMATCH")
// 2) registry
const rp = root + "registry/command-registry.json"
const r = JSON.parse(readFileSync(rp, "utf8"))
const cmd = r.commands || r
if (!cmd["purchase.history"]) {
  cmd["purchase.history"] = { name: "purchase.history", description: "ค้นประวัติซื้อขายจากใบแจ้งหนี้จริง (company/material filter, ไม่นับ VOID)", authority: "canonical", requires_confirmation: false, input: { company: {}, material: {} } }
  writeFileSync(rp, JSON.stringify(r, null, 2) + "\n"); console.log("registry ok")
} else console.log("registry: already")
// 3) dispatcher route whitelist
const wp = root + "app/api/v1/mcp/business/dispatch/route.ts"
let w = readFileSync(wp, "utf8")
if (!w.includes('"purchase.history"')) {
  w = w.replace(/(\s+)"material\.sources",/, `$1"material.sources",\n$1"purchase.history",`)
  writeFileSync(wp, w); console.log("whitelist ok")
} else console.log("whitelist: already")
// 4) worker ALLOWED
const wkp = root + "local-runtime/cline-worker/worker.mjs"
let wk = readFileSync(wkp, "utf8")
if (!wk.includes("'purchase.history'")) {
  wk = wk.replace(`'material.sources',`, `'material.sources', 'purchase.history',`)
  writeFileSync(wkp, wk); console.log("worker ok")
} else console.log("worker: already")
