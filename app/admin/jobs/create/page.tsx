'use client'

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { WORKFLOWS, TX_TYPE_LABELS, TX_TYPE_ORDER, type TxType } from "@/lib/transactions/workflows"

interface Partner {
  id: string
  name: string
  phone?: string | null
  partner_type_label?: string | null
}

function fmtMoney(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const TX_TYPE_DESC: Record<TxType, string> = {
  sale:      "ขายสินค้า / บริการให้ลูกค้า",
  purchase:  "สั่งซื้อจากผู้จัดหา",
  contract:  "รับจ้างทำงาน / โครงการ",
  service:   "ให้บริการ (รายครั้ง/รายเดือน)",
  rental:    "ให้เช่าทรัพย์สิน",
  transport: "รับงานขนส่ง",
}

export default function JobCreatePage() {
  const router = useRouter()

  // form state
  const [txType, setTxType] = useState<TxType>("sale")
  const [partnerId, setPartnerId] = useState("")
  const [supplierId, setSupplierId] = useState("")
  const [projectName, setProjectName] = useState("")
  const [title, setTitle] = useState("")
  const [netAmount, setNetAmount] = useState("")
  const [vatEnabled, setVatEnabled] = useState(false)
  const [note, setNote] = useState("")

  // data
  const [partners, setPartners] = useState<Partner[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/partners")
      .then((r) => r.json())
      .then((d) => setPartners(d.partners ?? []))
      .catch(() => {})
  }, [])

  const workflow = WORKFLOWS[txType]
  const selectedPartner = partners.find((p) => p.id === partnerId)
  const amountNum = parseFloat(netAmount) || 0
  const vatAmount = vatEnabled ? Math.round(amountNum * 7) / 100 : 0
  const totalAmount = amountNum + vatAmount

  const needsSupplier = txType === "purchase" || txType === "contract"
  const showSupplier = needsSupplier || txType === "transport"

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!partnerId) { setError("กรุณาเลือกคู่ค้า"); return }

    setSaving(true)
    setError(null)

    try {
      const partnerName = selectedPartner?.name ?? ""
      const autoTitle = title.trim() || (projectName.trim() ? projectName.trim() : `${workflow.label} — ${partnerName}`)

      const payload = {
        tx_type: txType,
        partner_id: partnerId,
        supplier_id: supplierId || undefined,
        title: autoTitle,
        project_name: projectName || undefined,
        net_amount: amountNum || undefined,
        vat_amount: vatAmount || undefined,
      }

      const res = await fetch("/api/admin/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "บันทึกไม่สำเร็จ")

      router.push(`/admin/jobs/${data.transaction.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด")
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-stone-50">
      {/* Header */}
      <div className="px-6 py-3 bg-white border-b border-stone-200 shrink-0 flex items-center gap-3">
        <a href="/admin/jobs" className="text-xs text-stone-400 hover:text-stone-600 transition">← งานทั้งหมด</a>
        <span className="text-stone-300">/</span>
        <span className="text-sm font-semibold text-stone-700">สร้างงานใหม่</span>
        <div className="flex-1" />
        <button
          form="job-form"
          type="submit"
          disabled={saving || !partnerId}
          className="text-xs font-semibold px-4 py-2 rounded-xl bg-stone-900 text-white hover:bg-stone-800 transition disabled:opacity-40"
        >
          {saving ? "กำลังบันทึก..." : "บันทึกงาน →"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3">
              <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">ประเภทงาน</div>
              <div className="mt-1 text-sm font-bold text-stone-800">{TX_TYPE_LABELS[txType]}</div>
              <div className="text-[10px] text-stone-400 mt-0.5">{TX_TYPE_DESC[txType]}</div>
            </div>
            <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3">
              <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">คู่ค้า</div>
              <div className="mt-1 text-sm font-bold text-stone-800 truncate">
                {selectedPartner?.name ?? "ยังไม่เลือก"}
              </div>
              <div className="text-[10px] text-stone-400 mt-0.5">
                {selectedPartner?.phone ?? selectedPartner?.partner_type_label ?? "—"}
              </div>
            </div>
            <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3">
              <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">ยอดรวม</div>
              <div className="mt-1 text-sm font-bold text-stone-800">
                {totalAmount > 0 ? `฿${fmtMoney(totalAmount)}` : "—"}
              </div>
              <div className="text-[10px] text-stone-400 mt-0.5">
                {vatEnabled && vatAmount > 0 ? `รวม VAT ฿${fmtMoney(vatAmount)}` : "ยังไม่ระบุ"}
              </div>
            </div>
            <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3">
              <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">เอกสารที่ต้องสร้าง</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {workflow.expected_docs.map((d) => (
                  <span key={d.doc_type} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${d.required ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-500"}`}>
                    {d.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Workflow steps preview */}
          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-5 py-3">
            <div className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider mb-2">ลำดับขั้นตอน</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {workflow.steps.map((step, i) => (
                <span key={step.event} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-indigo-300 text-xs">→</span>}
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${i === 0 ? "bg-indigo-600 text-white" : "bg-indigo-100 text-indigo-600"}`}>
                    {step.label}
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* Form */}
          <form id="job-form" onSubmit={handleSubmit} className="space-y-5">

            {/* tx_type */}
            <section className="bg-white border border-stone-200 rounded-2xl px-5 py-4">
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">ประเภทงาน</div>
              <div className="flex gap-2 flex-wrap">
                {TX_TYPE_ORDER.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTxType(t)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${txType === t ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"}`}
                  >
                    {TX_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-xs text-stone-400">{TX_TYPE_DESC[txType]}</div>
            </section>

            {/* Partner */}
            <section className="bg-white border border-stone-200 rounded-2xl px-5 py-4">
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
                {txType === "purchase" ? "ผู้จัดหา / Vendor" : "คู่ค้าหลัก"}
              </div>
              <select
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                required
                className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-stone-500 bg-stone-50"
              >
                <option value="">— เลือกคู่ค้า —</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.partner_type_label ? ` (${p.partner_type_label})` : ""}</option>
                ))}
              </select>
              {selectedPartner && (
                <div className="mt-2 text-xs text-stone-400 flex gap-3">
                  {selectedPartner.phone && <span>{selectedPartner.phone}</span>}
                  <a href={`/admin/partners/${selectedPartner.id}`} className="text-blue-500 hover:underline">ดู Timeline →</a>
                </div>
              )}
            </section>

            {/* Supplier (optional, for purchase/contract/transport) */}
            {showSupplier && (
              <section className="bg-white border border-stone-200 rounded-2xl px-5 py-4">
                <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
                  ผู้จัดหา / ซัพพลายเออร์ {!needsSupplier && "(ถ้ามี)"}
                </div>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-stone-500 bg-stone-50"
                >
                  <option value="">— ไม่ระบุ / เลือกทีหลัง —</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </section>
            )}

            {/* Job info */}
            <section className="bg-white border border-stone-200 rounded-2xl px-5 py-4 space-y-4">
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider">ข้อมูลงาน</div>
              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1.5">ชื่อโครงการ / รหัสงาน</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="เช่น KKN-2026-001, งานปูพื้น ซ.ลาดพร้าว 71"
                  className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-stone-500 bg-stone-50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1.5">ชื่องาน / หัวเรื่อง (เจาะจง)</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`ปล่อยว่างเพื่อให้ระบบสร้างให้ เช่น "${workflow.label} — ${selectedPartner?.name ?? "ชื่อคู่ค้า"}"`}
                  className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-stone-500 bg-stone-50"
                />
              </div>
            </section>

            {/* Financial */}
            <section className="bg-white border border-stone-200 rounded-2xl px-5 py-4 space-y-4">
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider">การเงิน (ประมาณการ)</div>
              <div className="flex gap-4 items-end flex-wrap">
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-xs font-semibold text-stone-600 mb-1.5">ยอดประมาณการ (บาท)</label>
                  <input
                    type="number"
                    value={netAmount}
                    onChange={(e) => setNetAmount(e.target.value)}
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-stone-500 bg-stone-50"
                  />
                </div>
                <label className="flex items-center gap-2 pb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={vatEnabled}
                    onChange={(e) => setVatEnabled(e.target.checked)}
                    className="w-4 h-4 accent-stone-800"
                  />
                  <span className="text-xs font-semibold text-stone-600">มี VAT 7%</span>
                </label>
              </div>
              {vatEnabled && amountNum > 0 && (
                <div className="text-xs text-stone-500 flex gap-4">
                  <span>ราคาก่อน VAT: ฿{fmtMoney(amountNum)}</span>
                  <span>VAT 7%: ฿{fmtMoney(vatAmount)}</span>
                  <span className="font-semibold text-stone-800">รวม: ฿{fmtMoney(totalAmount)}</span>
                </div>
              )}
            </section>

            {/* Note */}
            <section className="bg-white border border-stone-200 rounded-2xl px-5 py-4">
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">หมายเหตุ / รายละเอียดเพิ่มเติม</div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="เงื่อนไขพิเศษ, วันส่งมอบ, ข้อตกลงอื่น ๆ"
                className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-stone-500 bg-stone-50 resize-none"
              />
            </section>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">{error}</div>
            )}

            {/* Submit */}
            <div className="flex justify-end pb-8">
              <button
                type="submit"
                disabled={saving || !partnerId}
                className="px-6 py-3 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 transition disabled:opacity-40"
              >
                {saving ? "กำลังสร้างงาน..." : "บันทึกงาน และดำเนินการต่อ →"}
              </button>
            </div>

          </form>
        </div>
      </div>
    </div>
  )
}
