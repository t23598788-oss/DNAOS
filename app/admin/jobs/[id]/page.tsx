'use client'

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  getWorkflow,
  getNextStep,
  getStepIndex,
  TX_TYPE_LABELS,
  type TxType,
} from "@/lib/transactions/workflows"
import { DOCUMENT_TYPE_META } from "@/lib/documents/document-editor"

// ---------- types ----------
interface Transaction {
  id: string
  tx_type: string
  state: string
  title: string | null
  project_name: string | null
  net_amount: number | null
  paid_amount: number | null
  vat_amount: number | null
  created_at: string
  state_changed_at: string
  partners: { id: string; name: string; phone?: string | null } | null
  suppliers: { id: string; name: string } | null
}

interface BizEvent {
  id: string
  event_type: string
  event_date: string
  title: string | null
  description: string | null
  created_at: string
}

interface LinkedDoc {
  id: string
  document_type: string
  document_number: string
  status: string
  net_amount: number | null
  issue_date: string | null
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })
}

function fmtMoney(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const EVENT_ICONS: Record<string, string> = {
  quotation_sent: "📋", po_received: "🛒", work_started: "🔧",
  delivery_made: "🚚", work_completed: "✅", invoice_issued: "🧾",
  payment_received: "💰", closed: "🏁",
}

const DOC_ROUTE: Record<string, string> = {
  delivery_order: "/admin/delivery-order",
  invoice: "/admin/invoice",
  receipt: "/admin/receipt",
  purchase_order: "/admin/purchase-order",
  payment_voucher: "/admin/payment-voucher",
}

export default function JobDetailPage() {
  const params = useParams()
  const jobId = params.id as string

  const [tx, setTx] = useState<Transaction | null>(null)
  const [events, setEvents] = useState<BizEvent[]>([])
  const [docs, setDocs] = useState<LinkedDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [advancing, setAdvancing] = useState(false)
  const [advMsg, setAdvMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function loadJob() {
    try {
      const res = await fetch(`/api/admin/transactions/${jobId}`)
      if (!res.ok) throw new Error("โหลดไม่ได้")
      const data = await res.json()
      setTx(data.transaction)
      setEvents(data.events ?? [])
      setDocs(data.documents ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadJob() }, [jobId])

  async function advanceState(action: string) {
    if (!tx) return
    setAdvancing(true)
    setAdvMsg(null)
    try {
      const res = await fetch(`/api/admin/transactions/${tx.id}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "ไม่สำเร็จ")
      setTx((prev) => prev ? { ...prev, state: data.new_state } : prev)
      setEvents(data.events ?? events)
      setAdvMsg({ ok: true, text: `อัปเดตเป็น "${data.new_state}" แล้ว` })
    } catch (e: unknown) {
      setAdvMsg({ ok: false, text: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" })
    } finally {
      setAdvancing(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-screen text-sm text-stone-400 animate-pulse">กำลังโหลดงาน...</div>
  if (error || !tx) return <div className="flex items-center justify-center h-screen text-sm text-rose-600">{error ?? "ไม่พบงานนี้"}</div>

  const wf = getWorkflow(tx.tx_type)
  const currentIdx = getStepIndex(wf, tx.state)
  const nextStep = getNextStep(wf, tx.state)
  const partner = tx.partners
  const supplier = tx.suppliers

  // แยกเอกสารที่ expected vs actual
  const docsByType: Record<string, LinkedDoc[]> = {}
  for (const d of docs) {
    if (!docsByType[d.document_type]) docsByType[d.document_type] = []
    docsByType[d.document_type].push(d)
  }

  const net = tx.net_amount ?? 0
  const paid = tx.paid_amount ?? 0
  const vat = tx.vat_amount ?? 0
  const outstanding = net + vat - paid

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-stone-50">

      {/* Sticky Header */}
      <div className="shrink-0 bg-white border-b border-stone-200">
        {/* Top bar */}
        <div className="px-6 py-3 flex items-center gap-3">
          <Link href="/admin/jobs" className="text-xs text-stone-400 hover:text-stone-600 transition">← งานทั้งหมด</Link>
          <span className="text-stone-300">/</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-stone-100 text-stone-500 uppercase tracking-wider">
            {TX_TYPE_LABELS[tx.tx_type as TxType] ?? tx.tx_type}
          </span>
          <span className="text-sm font-semibold text-stone-700 truncate flex-1">
            {tx.title ?? tx.project_name ?? "งานไม่มีชื่อ"}
          </span>
          {advMsg && (
            <span className={`text-xs ${advMsg.ok ? "text-emerald-600" : "text-red-600"}`}>{advMsg.text}</span>
          )}
          {nextStep ? (
            <button
              onClick={() => advanceState(nextStep.action)}
              disabled={advancing}
              className="text-xs font-semibold px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition disabled:opacity-40 whitespace-nowrap"
            >
              ✓ {nextStep.action_label}
            </button>
          ) : (
            <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700">ปิดงานแล้ว</span>
          )}
        </div>

        {/* State progress */}
        <div className="px-6 pb-3 flex items-center gap-1.5 flex-wrap">
          {wf.steps.map((step, i) => (
            <span
              key={step.event}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap transition ${
                i === currentIdx ? "bg-indigo-600 text-white shadow-sm" :
                i < currentIdx ? "bg-indigo-100 text-indigo-600" :
                "bg-stone-100 text-stone-400"
              }`}
            >
              {i < currentIdx ? "✓ " : ""}{step.label}
            </span>
          ))}
          <span className="text-[10px] text-stone-400 ml-2">{fmtDate(tx.state_changed_at)}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-5 space-y-5">

          {/* Row 1: Partner + Financial */}
          <div className="grid md:grid-cols-2 gap-4">

            {/* Partner card */}
            <div className="bg-white border border-stone-200 rounded-2xl px-5 py-4">
              <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-3">คู่ค้า</div>
              {partner ? (
                <>
                  <div className="font-bold text-stone-800 text-base">{partner.name}</div>
                  {partner.phone && <div className="text-xs text-stone-400 mt-1">{partner.phone}</div>}
                  <div className="flex gap-2 mt-3">
                    <Link
                      href={`/admin/partners/${partner.id}`}
                      className="text-[10px] font-semibold px-2.5 py-1 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 transition"
                    >
                      Timeline →
                    </Link>
                    <Link
                      href={`/admin/create-document?partnerId=${partner.id}&transactionId=${tx.id}&type=invoice`}
                      className="text-[10px] font-semibold px-2.5 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition"
                    >
                      + ใบแจ้งหนี้
                    </Link>
                    <Link
                      href={`/admin/create-document?partnerId=${partner.id}&transactionId=${tx.id}&type=receipt`}
                      className="text-[10px] font-semibold px-2.5 py-1 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 transition"
                    >
                      + ใบเสร็จ
                    </Link>
                  </div>
                </>
              ) : (
                <div className="text-xs text-stone-400">ไม่มีข้อมูลคู่ค้า</div>
              )}
              {supplier && (
                <div className="mt-3 pt-3 border-t border-stone-100">
                  <div className="text-[10px] text-stone-400">ผู้จัดหา: <span className="font-semibold text-stone-600">{supplier.name}</span></div>
                </div>
              )}
              {tx.project_name && (
                <div className="mt-2 text-xs text-stone-500">รหัสงาน: <span className="font-semibold">{tx.project_name}</span></div>
              )}
            </div>

            {/* Financial card */}
            <div className="bg-white border border-stone-200 rounded-2xl px-5 py-4">
              <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-3">การเงิน</div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-stone-500">ยอดประมาณการ</span>
                  <span className="font-semibold text-stone-700">{net > 0 ? `฿${fmtMoney(net)}` : "ยังไม่ระบุ"}</span>
                </div>
                {vat > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-stone-500">VAT 7%</span>
                    <span className="text-stone-600">฿{fmtMoney(vat)}</span>
                  </div>
                )}
                {net > 0 && (
                  <div className="flex justify-between text-xs border-t border-stone-100 pt-2">
                    <span className="text-stone-500">รวมทั้งสิ้น</span>
                    <span className="font-bold text-stone-800">฿{fmtMoney(net + vat)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-stone-500">ชำระแล้ว</span>
                  <span className="font-semibold text-emerald-700">{paid > 0 ? `฿${fmtMoney(paid)}` : "—"}</span>
                </div>
                {net > 0 && (
                  <div className="flex justify-between text-xs bg-rose-50 rounded-lg px-3 py-1.5">
                    <span className="text-rose-700 font-semibold">คงเหลือ</span>
                    <span className={`font-bold ${outstanding > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                      {outstanding > 0 ? `฿${fmtMoney(outstanding)}` : "ชำระครบแล้ว"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Documents Checklist */}
          <div className="bg-white border border-stone-200 rounded-2xl px-5 py-4">
            <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-4">เอกสารในงานนี้</div>
            <div className="space-y-3">
              {wf.expected_docs.map((expected) => {
                const created = docsByType[expected.doc_type] ?? []
                const meta = DOCUMENT_TYPE_META[expected.doc_type as keyof typeof DOCUMENT_TYPE_META]
                const docRoute = DOC_ROUTE[expected.doc_type]
                const createUrl = partner
                  ? `/admin/create-document?partnerId=${partner.id}&transactionId=${tx.id}&type=${expected.doc_type}`
                  : null

                return (
                  <div key={expected.doc_type}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${created.length > 0 ? "bg-emerald-100 text-emerald-700" : expected.required ? "bg-red-100 text-red-600" : "bg-stone-100 text-stone-400"}`}>
                        {expected.label}
                      </span>
                      <span className="text-xs text-stone-600 flex-1">
                        {meta?.fullTitle ?? expected.doc_type}
                        {expected.required && <span className="text-red-400 ml-1">*</span>}
                      </span>
                      {createUrl && (
                        <Link
                          href={createUrl}
                          className="text-[10px] font-semibold px-2.5 py-1 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 hover:text-stone-800 transition whitespace-nowrap"
                        >
                          + สร้างใหม่
                        </Link>
                      )}
                    </div>
                    {created.length > 0 ? (
                      <div className="ml-10 space-y-1">
                        {created.map((d) => (
                          <div key={d.id} className="flex items-center gap-3 text-xs">
                            <span className="text-emerald-600 font-mono">{d.document_number}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${d.status === "saved" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                              {d.status === "saved" ? "บันทึกแล้ว" : "ร่าง"}
                            </span>
                            {d.net_amount != null && (
                              <span className="text-stone-500 tabular-nums">฿{fmtMoney(d.net_amount)}</span>
                            )}
                            {d.issue_date && <span className="text-stone-400">{fmtDate(d.issue_date)}</span>}
                            {docRoute && (
                              <Link href={`${docRoute}?documentId=${d.id}`} className="text-blue-500 hover:underline">เปิด →</Link>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="ml-10 text-xs text-stone-400">ยังไม่มีเอกสาร</div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Extra docs not in expected */}
            {docs.filter((d) => !wf.expected_docs.find((e) => e.doc_type === d.document_type)).length > 0 && (
              <div className="mt-4 pt-4 border-t border-stone-100">
                <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">เอกสารอื่น ๆ</div>
                <div className="space-y-1">
                  {docs.filter((d) => !wf.expected_docs.find((e) => e.doc_type === d.document_type)).map((d) => (
                    <div key={d.id} className="flex items-center gap-3 text-xs">
                      <span className="text-stone-500 font-mono">{d.document_number}</span>
                      <span className="text-stone-400">{d.document_type}</span>
                      {d.net_amount != null && <span className="text-stone-500">฿{fmtMoney(d.net_amount)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick create buttons */}
            <div className="mt-4 pt-4 border-t border-stone-100">
              <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">สร้างเอกสารด่วน</div>
              <div className="flex gap-2 flex-wrap">
                {partner && ([
                  { type: "delivery_order", label: "ใบส่งของ" },
                  { type: "invoice", label: "ใบแจ้งหนี้" },
                  { type: "receipt", label: "ใบเสร็จ" },
                  { type: "purchase_order", label: "ใบสั่งซื้อ" },
                  { type: "payment_voucher", label: "ใบสำคัญจ่าย" },
                ] as const).map((item) => (
                  <Link
                    key={item.type}
                    href={`/admin/create-document?partnerId=${partner.id}&transactionId=${tx.id}&type=${item.type}`}
                    className="text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition"
                  >
                    + {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Event Timeline */}
          <div className="bg-white border border-stone-200 rounded-2xl px-5 py-4">
            <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-4">ประวัติเหตุการณ์</div>
            {events.length === 0 ? (
              <div className="text-xs text-stone-400">ยังไม่มีเหตุการณ์</div>
            ) : (
              <div className="space-y-3">
                {events.map((ev, i) => (
                  <div key={ev.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="w-7 h-7 rounded-full bg-stone-100 flex items-center justify-center text-sm shrink-0">
                        {EVENT_ICONS[ev.event_type] ?? "•"}
                      </span>
                      {i < events.length - 1 && <div className="w-px flex-1 bg-stone-100 mt-1" />}
                    </div>
                    <div className="pb-3 flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-stone-700">{ev.title ?? ev.event_type}</span>
                        <span className="text-[10px] text-stone-400 shrink-0">{fmtDate(ev.event_date)}</span>
                      </div>
                      {ev.description && <div className="text-[10px] text-stone-400 mt-0.5">{ev.description}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
