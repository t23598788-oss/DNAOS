"use client"

import { useCallback, useEffect, useState } from "react"
import PayablesPanel from "./PayablesPanel"

// Expense entry tab (UNIFIED FINANCE ADMIN mission, 2026-10-11) — ฟอร์มกรอก
// เงินออกของ Admin: บันทึกลง canonical Cost Ledger (company_expenses) ผ่าน
// POST /api/admin/company-expenses → expense-write#recordCompanyExpense
// (writer เดียวกับ LINE chat / subscription sync — ไม่มีระบบ Manual แยก)
// หลักฐานไฟล์ไปลง receipt_documents (bucket attachments) แบบเดียวกับที่
// LINE ทำ แล้ว anchor ด้วย receipt_document_id
// หมายเหตุ: แถวค่าใช้จ่ายนี้คือ "บิล/ใบกำกับที่จ่ายจริงแล้ว" (evidence) —
// คำขอจ่ายเงินพาร์ตเนอร์ที่ยังไม่จ่ายอยู่ที่ PayablesPanel (Rule 72)

interface ExpenseItem {
  id: string
  document_type: string
  amount: number | null
  vendor_name: string | null
  expense_date: string | null
  source: string | null
  created_at: string
}

const thb = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const date10 = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : "-")

const inputCls =
  "w-full text-sm border border-stone-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200"
const labelCls = "block text-xs font-medium text-stone-600 mb-1"

export default function ExpenseEntryTab() {
  const [items, setItems] = useState<ExpenseItem[]>([])
  const [date, setDate] = useState("")
  const [vendor, setVendor] = useState("")
  const [docType, setDocType] = useState("tax_invoice")
  const [amount, setAmount] = useState("")
  const [preVat, setPreVat] = useState("")
  const [vat, setVat] = useState("")
  const [taxNo, setTaxNo] = useState("")
  const [notes, setNotes] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/company-expenses?limit=15").catch(() => null)
    const data = res && res.ok ? await res.json() : { items: [] }
    setItems(data.items ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setSuccess(null)
    const amt = Number(amount)
    if (!date) { setError("ต้องระบุวันที่ค่าใช้จ่าย"); return }
    if (!Number.isFinite(amt) || amt <= 0) { setError("จำนวนเงินต้องมากกว่า 0"); return }
    if (!vendor.trim()) { setError("ต้องระบุชื่อผู้รับเงิน/ร้านค้า"); return }

    setBusy(true)
    try {
      // 1) หลักฐานใบเสร็จ/ใบกำกับ → receipt_documents (แนวทางเดียวกับ LINE)
      let receiptId: string | null = null
      if (file) {
        const fd = new FormData()
        fd.append("file", file)
        const up = await fetch("/api/admin/upload", { method: "POST", body: fd })
        const upData = await up.json()
        if (!up.ok) { setError(upData.error ?? "อัปโหลดหลักฐานไม่สำเร็จ"); return }
        const docRes = await fetch("/api/admin/receipt-documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "upload",
            document_type: docType === "other" ? "receipt" : docType,
            media_path: upData.path,
            media_size_bytes: upData.size ?? null,
            media_mime_type: upData.type ?? null,
            vendor_name: vendor.trim(),
            document_date: date,
            description: `หลักฐานค่าใช้จ่าย (admin): ${vendor.trim()}`,
          }),
        })
        const docData = await docRes.json()
        if (!docRes.ok) { setError(docData.error ?? "บันทึกหลักฐานไม่สำเร็จ"); return }
        receiptId = docData?.receipt_document?.receipt_document_id ?? null
      }

      // 2) บันทึกลง Cost Ledger — canonical expense writer
      const res = await fetch("/api/admin/company-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_type: docType,
          amount: amt,
          vendor_name: vendor.trim(),
          expense_date: date,
          amount_pre_vat: preVat ? Number(preVat) : null,
          vat_amount: vat ? Number(vat) : null,
          tax_invoice_no: taxNo.trim() || null,
          notes: notes.trim() || null,
          receipt_document_id: receiptId,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "บันทึกค่าใช้จ่ายไม่สำเร็จ"); return }

      setSuccess(`บันทึกค่าใช้จ่าย ${thb(amt)} บาท (${vendor.trim()}) ลง Cost Ledger แล้ว`)
      setDate(""); setVendor(""); setAmount(""); setPreVat(""); setVat(""); setTaxNo(""); setNotes(""); setFile(null)
      await load()
    } catch {
      setError("บันทึกไม่สำเร็จ — ลองใหม่")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-4 text-xs text-stone-600 bg-stone-100 border border-stone-200 rounded-lg p-3">
        บันทึกบิล/ใบกำกับภาษีที่ <b>จ่ายจริงแล้ว</b> ลง Cost Ledger เดียวกับที่ LINE chat และระบบตรวจเมลใช้อยู่
        (ไม่มีบัญชี Manual แยก) — ถ้ายังไม่ได้จ่าย ใช้ &quot;คำขอจ่ายพาร์ตเนอร์&quot; ด้านล่างแทน
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
      {success && <div className="mb-4 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">{success}</div>}

      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>วันที่ *</label>
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>ผู้รับเงิน / ร้านค้า *</label>
          <input className={inputCls} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="ชื่อผู้ขายบนบิล" />
        </div>
        <div>
          <label className={labelCls}>หมวดค่าใช้จ่าย (ชนิดเอกสาร)</label>
          <select className={inputCls} value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="tax_invoice">ใบกำกับภาษี</option>
            <option value="invoice">ใบแจ้งหนี้</option>
            <option value="receipt">ใบเสร็จ</option>
            <option value="fuel_bill">บิลน้ำมัน</option>
            <option value="other">อื่นๆ</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>จำนวนเงินรวม (บาท) *</label>
          <input type="number" step="0.01" min="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>ยอดก่อน VAT</label>
          <input type="number" step="0.01" min="0" className={inputCls} value={preVat} onChange={(e) => setPreVat(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>VAT</label>
          <input type="number" step="0.01" min="0" className={inputCls} value={vat} onChange={(e) => setVat(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>เลขที่ใบกำกับภาษี/เอกสารอ้างอิง</label>
          <input className={inputCls} value={taxNo} onChange={(e) => setTaxNo(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>ไฟล์หลักฐาน</label>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" className={inputCls} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>หมายเหตุ</label>
          <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className="px-4 py-2 text-sm font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition disabled:opacity-50">
            {busy ? "กำลังบันทึก..." : "บันทึกรายจ่าย (Cost Ledger)"}
          </button>
        </div>
      </form>

      {items.length > 0 && (
        <div className="mt-6">
          <div className="text-xs font-semibold text-stone-600 mb-2">รายจ่ายล่าสุด (ทุก channel — line_chat / ระบบ / admin)</div>
          <div className="border border-stone-200 rounded-lg divide-y divide-stone-100 bg-white">
            {items.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="text-stone-800">{it.vendor_name ?? "-"}</span>
                  <span className="text-xs text-stone-400 ml-2">{it.document_type} · {date10(it.expense_date)} · {it.source ?? "line_chat"}</span>
                </div>
                <div className="font-semibold whitespace-nowrap">{it.amount !== null ? `${thb(it.amount)} ฿` : "-"}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        <PayablesPanel />
      </div>
    </div>
  )
}
