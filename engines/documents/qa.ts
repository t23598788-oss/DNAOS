import { supabaseAdmin } from "@/services/supabase/queries"

// DETERMINISTIC DOCUMENT Q&A (owner mission 2026-10-10, LINE BUSINESS AI).
// คำถามธุรกิจเรื่องเอกสารที่มีข้อมูลอยู่จริงต้องตอบได้โดยไม่ต้องใช้ AI —
// engine ตัวนี้อ่านจาก canonical record เท่านั้น (invoices / standalone_documents
// / companies) ไม่เขียนอะไรเลย ไม่สร้างเอกสาร ไม่แตะยอด — เรียกจาก
// cognitive/pipeline.ts ก่อน fallback ไป answerWithAi และผู้เรียกทุกเส้นเป็น
// สิทธิ์ admin/owner เท่านั้น (chat เดิม + LINE owner bridge เดิม)

const THAI_MONTHS: Record<string, number> = {
  "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4, "พฤษภาคม": 5, "มิถุนายน": 6,
  "กรกฎาคม": 7, "สิงหาคม": 8, "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12,
  "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4, "พ.ค.": 5, "มิ.ย.": 6,
  "ก.ค.": 7, "ส.ค.": 8, "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12,
};

const fmt = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v: unknown) => fmt(Number(v ?? 0));
const sliceDate = (v: unknown) => String(v ?? "").slice(0, 10);

interface DocRow {
  id: string
  docNumber: string
  docType: string
  status: string
  total: number
  date: string
  party: string
  table: "invoices" | "standalone_documents"
}

async function findDocByNumber(db: ReturnType<typeof supabaseAdmin>, number: string): Promise<DocRow | null> {
  const { data: inv } = await db
    .from("invoices")
    .select("id, invoice_no, invoice_status, total_amount, invoice_date, companies(name)")
    .eq("invoice_no", number)
    .maybeSingle()
  if (inv) {
    return { id: inv.id, docNumber: inv.invoice_no, docType: "invoice", status: inv.invoice_status,
      total: Number(inv.total_amount ?? 0), date: sliceDate(inv.invoice_date),
      party: (inv.companies as { name?: string } | null)?.name ?? "", table: "invoices" }
  }
  const { data: doc } = await db
    .from("standalone_documents")
    .select("id, document_no, document_type, status, total_amount, document_date, companies(name)")
    .eq("document_no", number)
    .maybeSingle()
  if (doc) {
    return { id: doc.id, docNumber: doc.document_no, docType: doc.document_type, status: doc.status,
      total: Number(doc.total_amount ?? 0), date: sliceDate(doc.document_date),
      party: (doc.companies as { name?: string } | null)?.name ?? "", table: "standalone_documents" }
  }
  return null
}

async function findCompanyByName(db: ReturnType<typeof supabaseAdmin>, name: string) {
  const { data } = await db.from("companies").select("id, name").ilike("name", `%${name.trim()}%`).limit(5)
  const rows = data ?? []
  return rows.length === 1 ? rows[0] : null // เฉพาะที่ match เดียว — ห้ามเดาเมื่อซ้ำ
}

/** คำถามเรื่องเอกสารที่ตอบจากข้อมูลจริงได้โดยไม่ต้องใช้ AI → ข้อความตอบ หรือ null ถ้าไม่ใช่คำถามแนวนี้ */
export async function answerDocumentQuestion(message: string): Promise<string | null> {
  const db = supabaseAdmin()
  const text = message.trim()

  // 1) เปิด/ดู เอกสารเฉพาะเลขที่: "เปิดใบแจ้งหนี้ INV-20260718-649", "ดู REC-20260503-323"
  const numberMatch = text.match(/\b(INV|REC|RCP|QT|DO|PO|PV|BOQ|BN)-[0-9A-Za-z-]+\b/i)
  if (numberMatch && /(เปิด|ดู|หา|ค้นหา|ดึง|ขอดู|สรุป|รายละเอียด)/.test(text)) {
    const doc = await findDocByNumber(db, numberMatch[0].toUpperCase())
    if (!doc) return `ไม่พบเอกสารเลขที่ ${numberMatch[0].toUpperCase()} ในระบบครับ`
    return [
      `📄 ${doc.docNumber} (${doc.docType}, สถานะ ${doc.status})`,
      `คู่ค้า: ${doc.party || "-"}`,
      `วันที่ ${doc.date || "-"} · ยอดรวม: ${money(doc.total)} บาท`,
      `เปิดดู/ดาวน์โหลดได้ที่: /admin/documents?id=${doc.id}`,
    ].join("\n")
  }

  // 2) เปรียบเทียบใบแจ้งหนี้สองใบ: "เปรียบเทียบใบแจ้งหนี้ INV-.. กับ INV-.."
  const compareMatch = text.match(/(INV-[0-9A-Za-z-]+)[\s\S]{1,20}(?:กับ|และ|เทียบ|vs\.?)[\s\S]{0,20}(INV-[0-9A-Za-z-]+)/i)
  if (compareMatch && /(เปรียบเทียบ|เทียบ)/.test(text)) {
    const a = await findDocByNumber(db, compareMatch[1].toUpperCase())
    const b = await findDocByNumber(db, compareMatch[2].toUpperCase())
    if (!a || !b) return "ไม่พบใบแจ้งหนี้อย่างน้อย 1 ใบในคำเปรียบเทียบครับ"
    const diff = a.total - b.total
    return [
      `📊 เปรียบเทียบใบแจ้งหนี้`,
      `• ${a.docNumber} (${a.date}) — ${money(a.total)} บาท [${a.status}] · ${a.party || "-"}`,
      `• ${b.docNumber} (${b.date}) — ${money(b.total)} บาท [${b.status}] · ${b.party || "-"}`,
      `ส่วนต่าง: ${money(Math.abs(diff))} บาท${diff === 0 ? " (ยอดเท่ากัน)" : diff > 0 ? ` (${a.docNumber} มากกว่า)` : ` (${b.docNumber} มากกว่า)`}`,
    ].join("\n")
  }

  // 3) ค้นหาใบเสร็จ/ใบรับเงินตามวันที่: "ค้นหาใบเสร็จวันที่ 5 สิงหาคม"
  const dateMatch = text.match(/(?:วันที่|เมื่อ)\s*(\d{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)/)
  if (dateMatch && /(ใบเสร็จ|ใบรับเงิน|receipt)/i.test(text)) {
    const day = Number(dateMatch[1])
    const month = THAI_MONTHS[dateMatch[2]]
    const yearMatch = text.match(/พ\.?ศ\.?\s*(\d{4})|ปี\s*(\d{4})/)
    const be = yearMatch ? Number(yearMatch[1] ?? yearMatch[2]) : new Date().getFullYear() + 543
    const iso = `${be - 543}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    const { data: docs } = await db
      .from("standalone_documents")
      .select("id, document_no, document_type, status, total_amount, document_date, companies(name)")
      .eq("document_type", "receipt")
      .eq("document_date", iso)
      .order("created_at", { ascending: false })
      .limit(10)
    if (!docs?.length) return `ไม่พบใบเสร็จลงวันที่ ${day} ${dateMatch[2]} ${be} ครับ`
    const lines = docs.map((d) => `• ${d.document_no} — ${money(d.total_amount)} บาท [${d.status}] · ${(d.companies as { name?: string } | null)?.name ?? "-"}`)
    return [`🧾 ใบเสร็จวันที่ ${day} ${dateMatch[2]} ${be} พบ ${docs.length} ฉบับ:`, ...lines, "เปิดดูได้ที่ /admin/documents"].join("\n")
  }

  // 4) สรุปเอกสารทั้งหมดของบริษัท: "สรุปเอกสารทั้งหมดของ KT Construction"
  const summaryMatch = text.match(/(?:ของ|ลูกค้า|บริษัท|บจก\.)\s*([^\n?？]{2,60})\s*[?？]?\s*$/)
  if (/(สรุป|สรุปเอกสาร|ทั้งหมด)/.test(text) && summaryMatch) {
    const company = await findCompanyByName(db, summaryMatch[1].replace(/[?？.]\s*$/, ""))
    if (!company) return "ไม่สามารถระบุบริษัทได้ชัดเจนจากรายการที่พิมพ์มาครับ (พบมากกว่า 1 รายหรือไม่พบ — ระบุชื่อเต็มอีกครั้ง)"
    const [inv, docs] = await Promise.all([
      db.from("invoices").select("id, invoice_status, total_amount").eq("customer_company_id", company.id),
      db.from("standalone_documents").select("id, document_type, status, total_amount").eq("customer_company_id", company.id),
    ])
    const activeInv = (inv.data ?? []).filter((i) => i.invoice_status !== "VOID")
    const voidInv = (inv.data ?? []).filter((i) => i.invoice_status === "VOID")
    const activeDocs = (docs.data ?? []).filter((d) => d.status !== "void")
    const byType: Record<string, { n: number; sum: number }> = {}
    for (const d of activeDocs) {
      const t = d.document_type ?? "อื่น ๆ"
      byType[t] = byType[t] ?? { n: 0, sum: 0 }
      byType[t].n += 1
      byType[t].sum += Number(d.total_amount ?? 0)
    }
    const invSum = activeInv.reduce((s, i) => s + Number(i.total_amount ?? 0), 0)
    return [
      `📋 สรุปเอกสารของ ${company.name}`,
      `ใบแจ้งหนี้: ${activeInv.length} ฉบับ (ยอดรวม ${money(invSum)} บาท) · VOID ${voidInv.length} ฉบับ`,
      ...Object.entries(byType).map(([t, v]) => `${t}: ${v.n} ฉบับ (ยอดรวม ${money(v.sum)} บาท)`),
      `ดูรายละเอียดทั้งหมดที่ /admin/documents?company=${encodeURIComponent(company.name)}`,
    ].join("\n")
  }

  return null
}
