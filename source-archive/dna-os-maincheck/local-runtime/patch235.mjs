// patch235: material.list + purchase.history readers — node (utf8 safe)
import { readFileSync, writeFileSync } from "node:fs"
const p = "/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/engines/validation/dispatcher.ts"
let s = readFileSync(p, "utf8")
const marker = `  "material.sources": async (p) => {`
const add = `  // DNA-000235: material master + supplier-source (pit_materials) + usage evidence
  "material.list": async (p) => {
    const types = await supabaseAdmin.from("material_types").select("id, name, density_ton_per_cbm").is("deleted_at", null).order("name")
    if (types.error) throw new Error("query error: " + types.error.message)
    const links = await supabaseAdmin.from("pit_materials").select("material_type_id, price, pit_profiles!inner(id, name, latitude, longitude, deleted_at)").is("deleted_at", null).is("pit_profiles.deleted_at", null)
    const jobs = await supabaseAdmin.from("jobs").select("material_type_id").is("deleted_at", null)
    const nameFilter = typeof p.name === "string" ? p.name.trim() : null
    const out = (types.data ?? []).filter((t) => !nameFilter || t.name.includes(nameFilter)).map((t) => {
      const src = (links.data ?? []).filter((l) => l.material_type_id === t.id) as unknown as { price: number; pit_profiles: { id: string; name: string } }[]
      const used = (jobs.data ?? []).filter((j) => j.material_type_id === t.id).length
      const prices = src.map((x) => Number(x.price)).filter((n) => n > 0)
      return { name: t.name, density: t.density_ton_per_cbm, sources: src.length, source_names: src.slice(0, 5).map((x) => x.pit_profiles?.name).filter(Boolean), price_min: prices.length ? Math.min(...prices) : null, price_max: prices.length ? Math.max(...prices) : null, jobs_using: used }
    })
    return { total_types: out.length, materials: out, note: "รายการวัสดุจากระบบจริง (material_types) + แหล่ง/ราคาจาก pit_materials + การใช้งานจริงจาก jobs" }
  },
  // DNA-000235: "ใครเคยซื้อทรายจากเรา" — ต้องมีหลักฐาน transaction จริง ห้ามเดา
  "purchase.history": async (p) => {
    const materialName = typeof p.material === "string" ? p.material.trim() : null
    const companyName = typeof p.company === "string" ? p.company.trim() : null
    const inv = await supabaseAdmin.from("invoices").select("id, invoice_no, invoice_status, invoice_date, total_amount, paid_amount, customer_company_id, companies:customer_company_id(id, name), invoice_items(id, description, qty, unit, line_total)").neq("invoice_status", "VOID").order("invoice_date", { ascending: false }).limit(200)
    if (inv.error) throw new Error("query error: " + inv.error.message)
    const rows = (inv.data ?? []) as unknown as { invoice_no: string; invoice_status: string; invoice_date: string; total_amount: number; paid_amount: number; companies: { id: string; name: string } | null; invoice_items: { description: string; qty: number; unit: string; line_total: number }[] }[]
    const byCompany = companyName ? rows.filter((r) => r.companies?.name?.includes(companyName)) : rows
    if (!materialName) {
      return { invoices: byCompany.map((r) => ({ invoice_no: r.invoice_no, status: r.invoice_status, date: r.invoice_date, company: r.companies?.name ?? "(ไม่ระบุ)", total: r.total_amount, items: r.invoice_items.map((i) => ({ desc: i.description, qty: i.qty, unit: i.unit })) })), total: byCompany.length, note: "ใบแจ้งหนี้ที่ยังใช้งาน (ไม่นับ VOID) จาก invoices + invoice_items จริง" }
    }
    // material match จาก invoice_items.description (LIKE text) — ไม่มี FK วัสดุใน invoice_items
    const matched = byCompany.filter((r) => r.invoice_items.some((i) => i.description?.includes(materialName)))
    if (matched.length === 0) {
      return { PARTIAL_RESULT: true, material, matched_invoices: 0, reason: "invoice_items ไม่มีคอลัมน์ material_type_id — จับคู่จากข้อความ description เท่านั้น และไม่พบรายการที่ระบุ '\${materialName}' ในใบแจ้งหนี้ที่ใช้งานอยู่ (VOID ไม่นับ) ความสัมพันธ์วัสดุ-บิลระดับ master ยังไม่มีในระบบ" } as never
    }
    return { material, matched_invoices: matched.length, evidence: matched.map((r) => ({ invoice_no: r.invoice_no, date: r.invoice_date, company: r.companies?.name, items: r.invoice_items.filter((i) => i.description?.includes(materialName)).map((i) => ({ desc: i.description, qty: i.qty, unit: i.unit, line_total: i.line_total })) })), note: "จับคู่จาก invoice_items.description (ไม่ใช่ FK วัสดุ) — ใช้เป็นหลักฐานเบื้องต้น ตรวจสอบก่อนใช้ตัดสินใจธุรกิจ" }
  },
`
if (s.includes(marker) && !s.includes('"material.list"')) {
  s = s.replace(marker, add + marker)
  writeFileSync(p, s)
  console.log("material.list + purchase.history added")
} else console.log(s.includes('"material.list"') ? "already added" : "MARKER MISMATCH")
