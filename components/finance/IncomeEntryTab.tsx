"use client"

import { useCallback, useEffect, useState } from "react"

// Income entry tab (UNIFIED FINANCE ADMIN mission, 2026-10-11) — ฟอร์มกรอกเงิน
// เข้าของ Admin: บันทึกลง canonical receipt_documents ผ่าน POST
// /api/admin/receipt-documents (→ recordInboundSource — canonical inbound
// writer เดียวกับ LINE/upload/email/bank) channel='upload'
//
// RULE (owner): กดบันทึก ≠ ยืนยันเงินเข้า — แถวสร้างสถานะ 'ai_read'
// (คิวตรวจสอบ) รอคนเทียบสลิปกับ bank statement ที่ /admin/receipts แล้วกด
// ยืนยัน (→ confirmReceiptPayment — canonical payment writer เดิม)
// identity = เลือกจากบริษัท/บุคคลที่มีอยู่จริงเท่านั้น (/api/admin/partners)

interface CompanyOption { id: string; name: string; type: string; is_individual?: boolean }

const thb = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const inputCls =
  "w-full text-sm border border-stone-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200"
const labelCls = "block text-xs font-medium text-stone-600 mb-1"

export default function IncomeEntryTab() {
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [date, setDate] = useState("")
  const [companyId, setCompanyId] = useState("")
  const [payerText, setPayerText] = useState("")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState("bank_transfer")
  const [bankAccount, setBankAccount] = useState("")
  const [reference, setReference] = useState("")
  const [invoiceRef, setInvoiceRef] = useState("")
  const [details, setDetails] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/partners")
      .then((r) => r.json())
      .then((d) => setCompanies(d.partners ?? []))
      .catch(() => setCompanies([]))
  }, [])

  const reset = useCallback(() => {
    setDate(""); setCompanyId(""); setPayerText(""); setAmount(""); setMethod("bank_transfer")
    setBankAccount(""); setReference(""); setInvoiceRef(""); setDetails(""); setFile(null)
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setSuccess(null)

    // UX pre-checks เท่านั้น — authority จริงอยู่ที่ server (writer) เสมอ
    const amt = Number(amount)
    if (!date) { setError("ต้องระบุวันที่รับเงิน"); return }
    if (!Number.isFinite(amt) || amt <= 0) { setError("จำนวนเงินต้องมากกว่า 0"); return }
    if (!companyId && !payerText.trim()) { setError("ต้องระบุบริษัท/ผู้โอน อย่างใดอย่างหนึ่ง"); return }

    setBusy(true)
    try {
      // 1) หลักฐานไฟล์ → bucket attachments ของระบบเดิม (/api/admin/upload)
      let mediaPath: string | null = null
      let mediaSize: number | null = null
      let mediaMime: string | null = null
      if (file) {
        const fd = new FormData()
        fd.append("file", file)
        const up = await fetch("/api/admin/upload", { method: "POST", body: fd })
        const upData = await up.json()
        if (!up.ok) { setError(upData.error ?? "อัปโหลดหลักฐานไม่สำเร็จ"); return }
        mediaPath = upData.path
        mediaSize = upData.size ?? null
        mediaMime = upData.type ?? null
      }
      if (!mediaPath) { setError("ต้องแนบหลักฐานสลิป/ใบแจ้งรับเงิน (ไฟล์) เสมอ"); return }

      // 2) สร้างแถวหลักฐานขาเข้า — canonical inbound writer เดิม
      const res = await fetch("/api/admin/receipt-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "upload",
          document_type: "transfer_slip",
          media_path: mediaPath,
          media_size_bytes: mediaSize,
          media_mime_type: mediaMime,
          amount: amt,
          sender_name: payerText.trim() || companies.find((c) => c.id === companyId)?.name || null,
          transaction_datetime: date,
          document_date: date,
          reference_number: reference.trim() || null,
          description: [details.trim(), invoiceRef.trim() ? `อ้างอิงเอกสาร: ${invoiceRef.trim()}` : "", `วิธีรับเงิน: ${method}`, bankAccount.trim() ? `บัญชีรับ: ${bankAccount.trim()}` : ""].filter(Boolean).join(" · ") || null,
          customer_company_id: companyId || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "บันทึกไม่สำเร็จ"); return }

      setSuccess(
        `บันทึกหลักฐานเงินเข้าแล้ว (${thb(amt)} บาท) — อยู่ในสถานะ "รอตรวจสอบ" ยังไม่ถูกยืนยัน/ตัดหนี้อัตโนมัติ · ตรวจสอบที่หน้า สแกน/AI (/admin/receipts) แล้วยืนยันเมื่อเทียบ bank statement แล้วเท่านั้น`,
      )
      reset()
    } catch {
      setError("บันทึกไม่สำเร็จ — ลองใหม่")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <b>ข้อสำคัญ:</b> การกดบันทึกเป็นการบันทึก <b>หลักฐานเงินเข้า</b> เท่านั้น — ระบบจะสร้างรายการสถานะ
        &quot;รอตรวจสอบ&quot; แล้วรอคนเทียบกับ bank statement ที่หน้า <a className="underline" href="/admin/receipts">สแกน/AI</a>
        การยืนยันเงินเข้า/ตัดหนี้เกิดจากการกดยืนยันของผู้มีสิทธิ์เท่านั้น (canonical payment writer)
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
      {success && (
        <div className="mb-4 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          {success} — <a className="underline" href="/admin/receipts">ไปหน้าตรวจสอบ</a>
        </div>
      )}

      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>วันที่รับเงิน *</label>
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>จำนวนเงิน (บาท) *</label>
          <input type="number" step="0.01" min="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>บริษัท/บุคคลผู้โอน (เลือกรายการที่มีอยู่ในระบบ)</label>
          <select className={inputCls} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">— ไม่ระบุ (กรอกชื่อด้านล่างแทน) —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.is_individual ? " (บุคคล)" : ""}</option>
            ))}
          </select>
        </div>
        {!companyId && (
          <div className="sm:col-span-2">
            <label className={labelCls}>ชื่อผู้โอนตามหลักฐาน (ถ้าไม่เลือกรายการระบบ)</label>
            <input className={inputCls} value={payerText} onChange={(e) => setPayerText(e.target.value)} placeholder="ชื่อบริษัท/บุคคลบนสลิป" />
          </div>
        )}
        <div>
          <label className={labelCls}>วิธีรับเงิน</label>
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="bank_transfer">โอนธนาคาร</option>
            <option value="cash">เงินสด</option>
            <option value="qr">พร้อมเพย์ / QR</option>
            <option value="cheque">เช็ค</option>
            <option value="other">อื่นๆ</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>บัญชีรับเงิน (ตามหลักฐาน)</label>
          <input className={inputCls} value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} placeholder="เช่น K-Bank xxx-x-x{x}-x" />
        </div>
        <div>
          <label className={labelCls}>เลขอ้างอิงธุรกรรม (บนสลิป)</label>
          <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction Ref." />
        </div>
        <div>
          <label className={labelCls}>Invoice / เอกสารที่เกี่ยวข้อง</label>
          <input className={inputCls} value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} placeholder="เลขที่ใบแจ้งหนี้ (ถ้ามี)" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>รายละเอียด</label>
          <textarea className={inputCls} rows={2} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="รายละเอียดเพิ่มเติมของรายการรับเงิน" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>หลักฐานแนบ (สลิป/ใบแจ้งรับเงิน) *</label>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" className={inputCls} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
          >
            {busy ? "กำลังบันทึก..." : "บันทึกเป็นหลักฐานเงินเข้า (รอตรวจสอบ)"}
          </button>
        </div>
      </form>
    </div>
  )
}

