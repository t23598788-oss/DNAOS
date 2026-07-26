'use client'

import { useEffect, useState, useCallback } from "react"
import { formatMoney } from "@/engines/documents/document-editor"

interface ReceiptItem {
  id: string
  amount: number
  sender_name: string | null
  reference_number: string | null
  transaction_datetime: string | null
  verification_level: number | null
  partner_name: string | null
  outstanding_before: number
  payment_preview: { kind: "full_payment" | "partial_payment"; title: string; note: string } | null
  error_th: string | null
}

// Payment Verification Queue (owner, 2026-07-24): the missing read side for
// the OCR slip pipeline — receipt_documents rows have been created since
// 2026-07-17 with nothing showing them to a human. Preview here comes
// straight from GET /api/admin/receipt-documents, which classifies each row
// with the same resolvePaymentDocumentLink() the confirm action executes —
// what you see here is what will happen, not a separate guess.
export default function ReceiptsQueuePage() {
  const [items, setItems] = useState<ReceiptItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch("/api/admin/receipt-documents")
    const data = await res.json()
    setItems(res.ok ? data.items : [])
    setError(res.ok ? null : (data.error ?? "โหลดไม่สำเร็จ"))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function act(id: string, action: "confirm" | "reject") {
    setBusyId(id)
    const res = await fetch(`/api/admin/receipt-documents/${id}/${action}`, { method: "POST" })
    const data = await res.json()
    setBusyId(null)
    if (!res.ok) {
      setError(data.error ?? "ดำเนินการไม่สำเร็จ")
      return
    }
    await load()
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-xl font-semibold text-stone-800 mb-1">ตรวจสอบสลิปโอนเงิน (Payment Verification)</h1>
      <p className="text-sm text-stone-500 mb-6">สลิปที่ AI อ่านยอดแล้ว รอมนุษย์ยืนยันก่อนตัดยอดหนี้จริง</p>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
      {loading && <div className="text-sm text-stone-400">กำลังโหลด...</div>}
      {!loading && items.length === 0 && !error && (
        <div className="text-sm text-stone-400">ไม่มีสลิปที่รอตรวจสอบ</div>
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className={`border rounded-xl p-4 bg-white shadow-sm ${item.error_th ? "border-red-300 ring-1 ring-red-200" : "border-stone-200"}`}
          >
            {item.error_th && (
              // Replayed-slip fraud gate (owner, 2026-07-26) — same
              // reference_number already used on a confirmed payment before.
              // This is the one place a human actually sees the warning; the
              // customer is deliberately never told the specific reason.
              <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5 font-medium">
                {item.error_th}
              </div>
            )}
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm text-stone-500">{item.partner_name ?? "ไม่ทราบคู่ค้า"}</div>
                <div className="text-lg font-semibold text-stone-800">{formatMoney(item.amount)} บาท</div>
                {item.reference_number && (
                  <div className="text-xs text-stone-400">อ้างอิง {item.reference_number}</div>
                )}
              </div>
              {item.payment_preview && (
                <span
                  className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${
                    item.payment_preview.kind === "full_payment"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-amber-50 text-amber-700 border border-amber-200"
                  }`}
                >
                  {item.payment_preview.title}
                </span>
              )}
            </div>

            {item.payment_preview && (
              <div className="mt-2 text-sm text-stone-600 bg-stone-50 rounded-lg p-2.5">
                {item.payment_preview.note}
                <div className="text-xs text-stone-400 mt-1">
                  ยอดค้างก่อนรายการนี้: {formatMoney(item.outstanding_before)} บาท
                </div>
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <button
                disabled={busyId === item.id}
                onClick={() => act(item.id, "confirm")}
                className="text-xs px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition disabled:opacity-50"
              >
                ยืนยันรับเงิน
              </button>
              <button
                disabled={busyId === item.id}
                onClick={() => act(item.id, "reject")}
                className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 transition disabled:opacity-50"
              >
                ปฏิเสธ
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
