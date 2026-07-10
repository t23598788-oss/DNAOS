'use client'

import { Fragment, useState, useEffect, useCallback, useMemo } from "react"
import Link from "next/link"
import { formatMoney } from "@/engines/documents/document-editor"

interface Contact {
  line_user_id: string
  line_name: string | null
  line_picture: string | null
  message_count: number
  first_message_at: string
  last_message_at: string
  last_message: string
  matched_company: { id: string; name: string; tax_id: string | null; phone: string | null } | null
  debt: { total_outstanding: number; collection_state: string; days_overdue: number } | null
  has_pending_draft: boolean
}

interface Draft {
  id: string
  reason: string
  proposed_text: string
  status: string
  created_at: string
}

const REASON_LABEL: Record<string, string> = {
  debt_inquiry: "ตอบคำถามยอดหนี้",
}

interface Message {
  id: string
  raw_type: string
  raw_text: string | null
  created_at: string
}

interface DocRow {
  id: string
  invoice_no?: string
  document_no?: string
  invoice_status?: string
  document_type?: string
  total_amount: number
  invoice_date?: string
  document_date?: string
}

interface BizEvent {
  id: string
  event_code: string
  event_type: string | null
  material_text: string | null
  quantity: number | null
  quantity_unit: string | null
  destination: string | null
  schedule_text: string | null
  status: string
  confidence: number
  created_at: string
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("th-TH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

export default function LineCustomersPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ messages: Message[]; documents: DocRow[]; events: BizEvent[]; unlinkedCount: number; drafts: Draft[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({})
  const [draftBusyId, setDraftBusyId] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/line-customers")
      .then((r) => r.json())
      .then((d) => setContacts(d.contacts ?? []))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter((c) =>
      (c.line_name ?? "").toLowerCase().includes(q) ||
      c.last_message.toLowerCase().includes(q) ||
      (c.matched_company?.name ?? "").toLowerCase().includes(q)
    )
  }, [contacts, search])

  const loadDetail = useCallback(async (lineUserId: string) => {
    const res = await fetch(`/api/admin/line-customers/${lineUserId}`)
    const d = await res.json()
    setDetail({ messages: d.messages ?? [], documents: d.documents ?? [], events: d.events ?? [], unlinkedCount: d.unlinkedCount ?? 0, drafts: d.drafts ?? [] })
  }, [])

  const sendDraft = useCallback(async (draftId: string, lineUserId: string) => {
    setDraftBusyId(draftId)
    setDraftError(null)
    try {
      const text = draftEdits[draftId]
      const res = await fetch(`/api/admin/outbound-drafts/${draftId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(text ? { text } : {}),
      })
      const d = await res.json()
      if (!res.ok) { setDraftError(d.error ?? "ส่งไม่สำเร็จ"); return }
      await loadDetail(lineUserId)
      setContacts((prev) => prev.map((c) => c.line_user_id === lineUserId ? { ...c, has_pending_draft: false } : c))
    } finally {
      setDraftBusyId(null)
    }
  }, [draftEdits, loadDetail])

  const rejectDraft = useCallback(async (draftId: string, lineUserId: string) => {
    setDraftBusyId(draftId)
    setDraftError(null)
    try {
      const res = await fetch(`/api/admin/outbound-drafts/${draftId}/reject`, { method: "POST" })
      if (!res.ok) { const d = await res.json(); setDraftError(d.error ?? "ยกเลิกไม่สำเร็จ"); return }
      await loadDetail(lineUserId)
      setContacts((prev) => prev.map((c) => c.line_user_id === lineUserId ? { ...c, has_pending_draft: false } : c))
    } finally {
      setDraftBusyId(null)
    }
  }, [loadDetail])

  const toggle = useCallback(async (contact: Contact) => {
    if (expandedId === contact.line_user_id) {
      setExpandedId(null)
      return
    }
    setExpandedId(contact.line_user_id)
    setDetail(null)
    setBuildError(null)
    setDetailLoading(true)
    try {
      await loadDetail(contact.line_user_id)
    } finally {
      setDetailLoading(false)
    }
  }, [expandedId])

  const buildEvent = useCallback(async (lineUserId: string) => {
    setBuilding(true)
    setBuildError(null)
    try {
      const res = await fetch(`/api/admin/line-customers/${lineUserId}/build-event`, { method: "POST" })
      const d = await res.json()
      if (!res.ok) {
        setBuildError(d.error ?? "สร้าง Event ไม่สำเร็จ")
        return
      }
      await loadDetail(lineUserId)
    } finally {
      setBuilding(false)
    }
  }, [loadDetail])

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-3">
        <h1 className="text-base font-bold text-stone-900">ลูกค้า LINE</h1>
        <p className="text-xs text-stone-600 mt-0.5">
          ค้นหาชื่อที่เห็นในแชท LINE — ระบบจะดึงประวัติข้อความทั้งหมด และจับคู่กับข้อมูลบริษัท/หนี้ในระบบให้อัตโนมัติถ้าชื่อตรงกัน
        </p>
      </div>

      <div className="p-6 space-y-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="พิมพ์ชื่อที่เห็นใน LINE หรือคำในข้อความ..."
          className="w-full max-w-md text-sm border border-stone-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-stone-700">
                <th className="text-left font-bold uppercase tracking-wide px-4 py-2.5">ชื่อใน LINE</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">บริษัทที่จับคู่ได้</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">ข้อความล่าสุด</th>
                <th className="text-right font-bold uppercase tracking-wide px-3 py-2.5">จำนวนข้อความ</th>
                <th className="text-right font-bold uppercase tracking-wide px-4 py-2.5">ยอดหนี้</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading && <tr><td colSpan={5} className="text-center text-stone-500 py-8 animate-pulse">โหลด...</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={5} className="text-center text-stone-500 py-8">ไม่พบผู้ติดต่อ</td></tr>}
              {filtered.map((c) => {
                const isOpen = expandedId === c.line_user_id
                return (
                  <Fragment key={c.line_user_id}>
                    <tr onClick={() => toggle(c)} className={`hover:bg-red-50 transition cursor-pointer ${c.has_pending_draft ? "bg-red-50" : "hover:bg-stone-50"}`}>
                      <td className="px-4 py-3 font-semibold text-stone-900">
                        <div className="flex items-center gap-2.5">
                          <span className="inline-block w-3 text-stone-400 shrink-0">{isOpen ? "▾" : "▸"}</span>
                          {c.line_picture ? (
                            <img src={c.line_picture} alt="" className="w-7 h-7 rounded-full object-cover shrink-0 bg-stone-100" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-stone-200 shrink-0" />
                          )}
                          <span>{c.line_name ?? <span className="text-stone-400 font-normal">ไม่ทราบชื่อ (ยังไม่เคยดึงโปรไฟล์)</span>}</span>
                          {c.has_pending_draft && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-600 text-white shrink-0">รอส่ง</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-stone-700">
                        {c.matched_company ? (
                          <Link
                            href={`/admin/partners/${c.matched_company.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-emerald-700 font-medium hover:underline"
                          >
                            {c.matched_company.name} →
                          </Link>
                        ) : (
                          <span className="text-stone-400">ยังไม่จับคู่</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-stone-600 truncate max-w-[280px]">{c.last_message}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-stone-700">{c.message_count}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-stone-900">
                        {c.debt ? formatMoney(c.debt.total_outstanding) : "—"}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-stone-50">
                        <td colSpan={5} className="px-4 py-4">
                          {detailLoading && <div className="text-sm text-stone-500 animate-pulse">กำลังดึงประวัติ...</div>}
                          {!detailLoading && detail && (
                            <div className="space-y-4">
                              {detail.drafts.some((d) => d.status === "pending_review") && (
                                <div className="space-y-2">
                                  <div className="text-xs font-bold text-red-600 uppercase tracking-wide">📤 ข้อความรอส่ง ({detail.drafts.filter((d) => d.status === "pending_review").length})</div>
                                  {draftError && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{draftError}</div>}
                                  {detail.drafts.filter((d) => d.status === "pending_review").map((d) => (
                                    <div key={d.id} className="bg-white border-2 border-red-200 rounded-lg p-3" onClick={(e) => e.stopPropagation()}>
                                      <div className="text-[11px] text-red-500 font-medium mb-1.5">{REASON_LABEL[d.reason] ?? d.reason}</div>
                                      <textarea
                                        className="w-full text-sm border border-stone-300 rounded-lg px-3 py-2 mb-2 min-h-[70px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        defaultValue={d.proposed_text}
                                        onChange={(e) => setDraftEdits((prev) => ({ ...prev, [d.id]: e.target.value }))}
                                      />
                                      <div className="flex justify-end gap-2">
                                        <button
                                          onClick={() => rejectDraft(d.id, c.line_user_id)}
                                          disabled={draftBusyId === d.id}
                                          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                                        >
                                          ยกเลิก
                                        </button>
                                        <button
                                          onClick={() => sendDraft(d.id, c.line_user_id)}
                                          disabled={draftBusyId === d.id}
                                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                                        >
                                          {draftBusyId === d.id ? "กำลังส่ง..." : "ส่งให้ลูกค้า"}
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {c.debt && (
                                <div className="text-xs bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-3 py-2">
                                  ยอดหนี้คงเหลือ <strong>{formatMoney(c.debt.total_outstanding)}</strong> บาท — ผิดนัด {c.debt.days_overdue} วัน ({c.debt.collection_state})
                                </div>
                              )}

                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-xs font-bold text-stone-500 uppercase tracking-wide">Business Events ({detail.events.length})</div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); buildEvent(c.line_user_id) }}
                                    disabled={building || detail.unlinkedCount === 0}
                                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                                  >
                                    {building ? "กำลังสร้าง..." : detail.unlinkedCount === 0 ? "ไม่มีข้อความใหม่" : `สร้าง Event จาก ${detail.unlinkedCount} ข้อความใหม่`}
                                  </button>
                                </div>
                                {buildError && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">{buildError}</div>}
                                {detail.events.length === 0 ? (
                                  <div className="text-xs text-stone-400">ยังไม่มี Event ที่สร้างจากข้อความกลุ่มนี้</div>
                                ) : (
                                  <div className="space-y-1.5">
                                    {detail.events.map((ev) => (
                                      <div key={ev.id} className="bg-white border border-blue-100 rounded-lg px-3 py-2">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-mono font-semibold text-blue-700">{ev.event_code}</span>
                                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{ev.status}</span>
                                        </div>
                                        <div className="mt-1 text-xs text-stone-700">
                                          {ev.material_text ?? "—"} {ev.quantity ? `${ev.quantity} ${ev.quantity_unit ?? ""}` : ""} {ev.destination ? `→ ${ev.destination}` : ""}
                                        </div>
                                        {ev.schedule_text && <div className="text-[11px] text-stone-500 mt-0.5">กำหนด: {ev.schedule_text}</div>}
                                        <div className="text-[11px] text-stone-400 mt-0.5">ความมั่นใจ: {Math.round(ev.confidence * 100)}%</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div>
                                <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">เอกสาร ({detail.documents.length})</div>
                                {detail.documents.length === 0 ? (
                                  <div className="text-xs text-stone-400">ไม่มีเอกสารที่จับคู่ได้</div>
                                ) : (
                                  <div className="space-y-1">
                                    {detail.documents.map((d) => (
                                      <div key={d.id} className="flex justify-between text-xs bg-white border border-stone-200 rounded-lg px-3 py-1.5">
                                        <span className="text-stone-700">{d.invoice_no ?? d.document_no} <span className="text-stone-400">({d.invoice_status ?? d.document_type})</span></span>
                                        <span className="font-medium text-stone-900 tabular-nums">{formatMoney(d.total_amount)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div>
                                <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">ประวัติข้อความ ({detail.messages.length})</div>
                                <div className="space-y-1 max-h-80 overflow-y-auto">
                                  {detail.messages.map((m) => (
                                    <div key={m.id} className="flex justify-between gap-3 text-xs bg-white border border-stone-100 rounded-lg px-3 py-1.5">
                                      <span className="text-stone-700 truncate">{m.raw_text ?? `[${m.raw_type}]`}</span>
                                      <span className="text-stone-400 shrink-0">{fmtDateTime(m.created_at)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
