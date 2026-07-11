'use client'

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import {
  LayoutGrid, MessageCircle, Briefcase, Building2, FileText, Wallet, Mountain,
  MapPin, FileSignature, Receipt, Truck, Banknote, Phone, Paperclip, Bot,
} from "lucide-react"
import { formatMoney } from "@/engines/documents/document-editor"
import { AppShell, ActionBar, MapView, type IconRailItem, type ListColumnItem, type ActionBarItem } from "@/components/ui-kit"

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
  direction: "in" | "out"
  extracted: { latitude?: number; longitude?: number; address?: string } | null
  created_at: string
}

interface ActionLogEntry {
  id: string
  role: "user" | "system"
  text: string
  confirmToken?: string
  confirmAction?: string
  confirmResolved?: "confirmed" | "cancelled"
}

let actionLogSeq = 0
function nextActionLogId() {
  actionLogSeq += 1
  return `a${Date.now()}-${actionLogSeq}`
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

// 7 ฟังก์ชันหลักของ DNA OS ยุบมาจาก 13 เมนูเดิม (registry/portals.json) — หน้านี้
// (ลูกค้า LINE) เป็นหน้าแรกที่ใช้โครง AppShell เต็มรูปแบบ ที่เหลืออีก 6 ยังพาไป
// หน้าเดิมตามปกติก่อน รอดูหน้าตานี้แล้วค่อยขยาย (owner request 2026-07-11)
const RAIL_ITEMS: IconRailItem[] = [
  { key: "dashboard", label: "เลขา", icon: LayoutGrid, href: "/admin/dashboard" },
  { key: "line-customers", label: "LINE", icon: MessageCircle, href: "/admin/line-customers" },
  { key: "jobs", label: "งาน", icon: Briefcase, href: "/admin/jobs" },
  { key: "partners", label: "คู่ค้า", icon: Building2, href: "/admin/partners" },
  { key: "transactions", label: "เอกสาร", icon: FileText, href: "/admin/transactions" },
  { key: "debt-tracking", label: "การเงิน", icon: Wallet, href: "/admin/debt-tracking" },
  { key: "pits", label: "บ่อวัสดุ", icon: Mountain, href: "/admin/pits" },
]

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
}

export default function LineCustomersPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  // Owner request 2026-07-11: badge on "บ่อวัสดุ" so it's visible right here
  // on the chat screen when the pricing engine couldn't answer a customer
  // (event stuck at ready_to_quote — see event-followup.ts's ok/text fix) —
  // reuses the existing quotation-queue instead of a new alerts table.
  const [pendingQuotesCount, setPendingQuotesCount] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ messages: Message[]; documents: DocRow[]; events: BizEvent[]; unlinkedCount: number; drafts: Draft[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({})
  const [draftBusyId, setDraftBusyId] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([])
  const [actionSending, setActionSending] = useState(false)
  const [gpsOpen, setGpsOpen] = useState(false)
  const [aiAskOpen, setAiAskOpen] = useState(false)
  const [aiAskText, setAiAskText] = useState("")
  const [replyText, setReplyText] = useState("")
  const [replySending, setReplySending] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch("/api/admin/line-customers")
      .then((r) => r.json())
      .then((d) => setContacts(d.contacts ?? []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let cancelled = false
    function poll() {
      fetch("/api/admin/quotation-queue")
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return
          // "ready_to_quote" ที่ยังค้างอยู่ = ระบบคำนวณราคาให้ไม่ได้จริงๆ
          // (ข้อมูลครบแล้วแต่บ่อไม่มีราคาผูกไว้) — ต่างจาก awaiting_info ที่
          // แค่รอข้อมูลลูกค้าเพิ่ม
          const count = (d.queue ?? []).filter((e: { status: string }) => e.status === "ready_to_quote").length
          setPendingQuotesCount(count)
        })
        .catch(() => {})
    }
    poll()
    const id = setInterval(poll, 30000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const loadDetail = useCallback(async (lineUserId: string) => {
    const res = await fetch(`/api/admin/line-customers/${lineUserId}`)
    const d = await res.json()
    setDetail({ messages: d.messages ?? [], documents: d.documents ?? [], events: d.events ?? [], unlinkedCount: d.unlinkedCount ?? 0, drafts: d.drafts ?? [] })
  }, [])

  const selectContact = useCallback(async (lineUserId: string) => {
    setActiveId(lineUserId)
    setDetail(null)
    setBuildError(null)
    setActionLog([])
    setGpsOpen(false)
    setAiAskOpen(false)
    setReplyText("")
    setReplyError(null)
    setDetailLoading(true)
    try {
      await loadDetail(lineUserId)
    } finally {
      setDetailLoading(false)
    }
  }, [loadDetail])

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

  // Owner-reported gap 2026-07-11: this page had no way to type a real reply
  // straight to the customer — only a draft-approval banner (only appears
  // when the bot queued a draft) and an internal-only "ask AI" box. This
  // pushes a real LINE message and refreshes the real thread.
  const sendReply = useCallback(async (lineUserId: string) => {
    const text = replyText.trim()
    if (!text) return
    setReplySending(true)
    setReplyError(null)
    try {
      const res = await fetch(`/api/admin/line-customers/${lineUserId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
      const d = await res.json()
      if (!res.ok) { setReplyError(d.error ?? "ส่งไม่สำเร็จ"); return }
      setReplyText("")
      await loadDetail(lineUserId)
    } finally {
      setReplySending(false)
    }
  }, [replyText, loadDetail])

  // Action Bar → cognitive pipeline (owner request 2026-07-11: ปุ่มสร้างเอกสาร
  // ไม่เรียก backend ใหม่ — ยิงข้อความไทยสำเร็จรูปเข้า /api/chat เหมือนพิมพ์เอง
  // เพื่อใช้ Rule-72 preview/confirm flow เดิมที่ทำไว้แล้วสำหรับ SecretaryChat)
  const runCommand = useCallback(async (text: string) => {
    setActionSending(true)
    setActionLog((log) => [...log, { id: nextActionLogId(), role: "user", text }])
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json()
      setActionLog((log) => [...log, {
        id: nextActionLogId(),
        role: "system",
        text: data.text ?? "รับทราบครับ",
        confirmToken: data.confirm_token,
        confirmAction: data.confirm_action,
      }])
    } catch {
      setActionLog((log) => [...log, { id: nextActionLogId(), role: "system", text: "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้งครับ" }])
    } finally {
      setActionSending(false)
    }
  }, [])

  const confirmActionEntry = useCallback(async (entry: ActionLogEntry) => {
    if (!entry.confirmToken || !entry.confirmAction) return
    setActionLog((log) => log.map((x) => x.id === entry.id ? { ...x, confirmResolved: "confirmed" } : x))
    try {
      const res = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: entry.confirmAction, preview_token: entry.confirmToken, lineUserId: activeId }),
      })
      const data = await res.json()
      const text = !data.ok
        ? `ยืนยันไม่สำเร็จ: ${data.error ?? "ไม่ทราบสาเหตุ"}`
        : data.line_send_error
        ? `✅ บันทึกเรียบร้อยครับ แต่${data.line_send_error}`
        : "✅ บันทึกและส่งให้ลูกค้าทาง LINE เรียบร้อยครับ"
      setActionLog((log) => [...log, { id: nextActionLogId(), role: "system", text }])
      if (data.ok && activeId) await loadDetail(activeId)
    } catch {
      setActionLog((log) => [...log, { id: nextActionLogId(), role: "system", text: "ยืนยันไม่สำเร็จ ลองใหม่อีกครั้งครับ" }])
    }
  }, [activeId, loadDetail])

  const cancelActionEntry = useCallback((entry: ActionLogEntry) => {
    setActionLog((log) => log.map((x) => x.id === entry.id ? { ...x, confirmResolved: "cancelled" } : x))
  }, [])

  const handleFileUpload = useCallback(async (file: File, lineUserId: string) => {
    setActionLog((log) => [...log, { id: nextActionLogId(), role: "user", text: `📎 แนบไฟล์ ${file.name}` }])
    const formData = new FormData()
    formData.append("file", file)
    formData.append("documentId", lineUserId)
    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body: formData })
      const data = await res.json()
      setActionLog((log) => [...log, {
        id: nextActionLogId(), role: "system",
        text: res.ok ? `📎 แนบไฟล์ ${data.name} แล้ว` : `แนบไฟล์ไม่สำเร็จ: ${data.error ?? "ไม่ทราบสาเหตุ"}`,
      }])
    } catch {
      setActionLog((log) => [...log, { id: nextActionLogId(), role: "system", text: "แนบไฟล์ไม่สำเร็จ ลองใหม่อีกครั้งครับ" }])
    }
  }, [])

  // Owner-reported gap 2026-07-11: this used to just forward to runCommand
  // (/api/chat → generic cognitive pipeline), which has no idea about real
  // material prices. Now goes through the dedicated ask route, which checks
  // deterministically whether the question names a real material first and
  // answers with the real pricing engine using this contact's own GPS —
  // anything else still falls through to the same pipeline as before.
  const askAi = useCallback(async (question: string, companyName: string | null, lineUserId: string) => {
    setAiAskOpen(false)
    setAiAskText("")
    const text = companyName ? `คุณ${companyName} ${question}` : question
    setActionSending(true)
    setActionLog((log) => [...log, { id: nextActionLogId(), role: "user", text: question }])
    try {
      const res = await fetch(`/api/admin/line-customers/${lineUserId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      })
      const data = await res.json()
      setActionLog((log) => [...log, {
        id: nextActionLogId(),
        role: "system",
        text: data.text ?? "รับทราบครับ",
        confirmToken: data.confirm_token,
        confirmAction: data.confirm_action,
      }])
    } catch {
      setActionLog((log) => [...log, { id: nextActionLogId(), role: "system", text: "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้งครับ" }])
    } finally {
      setActionSending(false)
    }
  }, [])

  const listItems: ListColumnItem[] = contacts.map((c) => ({
    id: c.line_user_id,
    title: c.line_name ?? "ไม่ทราบชื่อ",
    subtitle: c.last_message,
    timestamp: fmtTime(c.last_message_at),
    avatarUrl: c.line_picture ?? undefined,
    highlighted: c.has_pending_draft,
  }))

  const activeContact = contacts.find((c) => c.line_user_id === activeId) ?? null
  const pendingDrafts = detail?.drafts.filter((d) => d.status === "pending_review") ?? []

  const companyName = activeContact?.matched_company?.name ?? null
  const lastLocation = [...(detail?.messages ?? [])].reverse().find((m) => m.raw_type === "location" && m.extracted?.latitude != null)

  const actionBarItems: ActionBarItem[] = activeContact ? [
    {
      key: "gps", label: "GPS", icon: MapPin,
      onClick: () => setGpsOpen((v) => !v),
      disabled: !lastLocation,
      tooltip: lastLocation ? undefined : "ยังไม่มีพิกัดที่ลูกค้าส่งมา",
    },
    {
      key: "quotation", label: "ใบเสนอราคา", icon: FileSignature,
      onClick: () => runCommand(`เสนอราคาให้คุณ${companyName}`),
      disabled: !companyName || actionSending,
      tooltip: companyName ? undefined : "ยังไม่จับคู่บริษัท",
    },
    {
      key: "invoice", label: "Invoice", icon: Receipt,
      onClick: () => runCommand(`ออกบิลให้คุณ${companyName}`),
      disabled: !companyName || actionSending,
      tooltip: companyName ? undefined : "ยังไม่จับคู่บริษัท",
    },
    {
      key: "delivery", label: "ส่งของ", icon: Truck,
      onClick: () => runCommand(`ออกใบส่งสินค้าให้คุณ${companyName}`),
      disabled: !companyName || actionSending,
      tooltip: companyName ? undefined : "ยังไม่จับคู่บริษัท",
    },
    {
      key: "receipt", label: "รับเงิน", icon: Banknote,
      onClick: () => runCommand(`ออกใบเสร็จให้คุณ${companyName}`),
      disabled: !companyName || actionSending,
      tooltip: companyName ? undefined : "ยังไม่จับคู่บริษัท",
    },
    {
      key: "call", label: "โทรหา", icon: Phone,
      onClick: () => { if (activeContact.matched_company?.phone) window.location.href = `tel:${activeContact.matched_company.phone}` },
      disabled: !activeContact.matched_company?.phone,
      tooltip: activeContact.matched_company?.phone ? undefined : "ไม่มีเบอร์โทรในระบบ",
    },
    {
      key: "attach", label: "ไฟล์", icon: Paperclip,
      onClick: () => fileInputRef.current?.click(),
    },
    {
      key: "ai", label: "ถาม AI", icon: Bot,
      onClick: () => setAiAskOpen((v) => !v),
    },
  ] : []

  const overflowActions: ActionBarItem[] = activeContact ? [
    {
      key: "boq", label: "สร้าง BOQ", icon: FileText,
      onClick: () => runCommand(`สร้าง boq ให้คุณ${companyName}`),
      disabled: !companyName,
    },
    {
      key: "billing", label: "ใบวางบิล", icon: FileText,
      onClick: () => runCommand(`ออกใบกำกับภาษีให้คุณ${companyName}`),
      disabled: !companyName,
    },
  ] : []

  const railItems: IconRailItem[] = RAIL_ITEMS.map((item) =>
    item.key === "pits" && pendingQuotesCount > 0 ? { ...item, badge: pendingQuotesCount } : item
  )

  return (
    <AppShell
      railItems={railItems}
      activeRailKey="line-customers"
      listItems={listItems}
      activeListId={activeId}
      onSelectList={selectContact}
      listSearchPlaceholder="ค้นหาชื่อหรือข้อความ..."
      listEmptyMessage={loading ? "กำลังโหลด..." : "ยังไม่มีผู้ติดต่อ"}
    >
      {!activeContact ? (
        <div className="flex items-center justify-center h-full text-sm text-stone-400">
          เลือกผู้ติดต่อทางซ้ายเพื่อดูบทสนทนา
        </div>
      ) : (
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200 flex-shrink-0 bg-white">
            {activeContact.line_picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeContact.line_picture} alt="" className="w-9 h-9 rounded-full object-cover bg-stone-100" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-stone-200" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-stone-800 truncate">{activeContact.line_name ?? "ไม่ทราบชื่อ"}</p>
              {activeContact.matched_company ? (
                <Link href={`/admin/partners/${activeContact.matched_company.id}`} className="text-[11px] text-emerald-600 hover:underline">
                  {activeContact.matched_company.name} →
                </Link>
              ) : (
                <p className="text-[11px] text-stone-400">ยังไม่จับคู่กับบริษัทในระบบ</p>
              )}
            </div>
            {activeContact.debt && (
              <div className="text-right flex-shrink-0">
                <p className="text-xs font-semibold text-rose-600">{formatMoney(activeContact.debt.total_outstanding)} บาท</p>
                <p className="text-[10px] text-stone-400">ผิดนัด {activeContact.debt.days_overdue} วัน</p>
              </div>
            )}
          </div>

          {/* Pending drafts — Rule 72 approval banner */}
          {pendingDrafts.length > 0 && (
            <div className="px-4 py-3 bg-rose-50 border-b border-rose-100 flex-shrink-0 space-y-2">
              <div className="text-xs font-bold text-rose-600">📤 ข้อความรอเฮียอนุมัติก่อนส่ง ({pendingDrafts.length})</div>
              {draftError && <div className="text-xs text-rose-600 bg-white border border-rose-200 rounded-lg px-3 py-2">{draftError}</div>}
              {pendingDrafts.map((d) => (
                <div key={d.id} className="bg-white border border-rose-200 rounded-lg p-3">
                  <div className="text-[11px] text-rose-500 font-medium mb-1.5">{REASON_LABEL[d.reason] ?? d.reason}</div>
                  <textarea
                    className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 mb-2 min-h-[60px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    defaultValue={d.proposed_text}
                    onChange={(e) => setDraftEdits((prev) => ({ ...prev, [d.id]: e.target.value }))}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => rejectDraft(d.id, activeContact.line_user_id)}
                      disabled={draftBusyId === d.id}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                    >
                      ยกเลิก
                    </button>
                    <button
                      onClick={() => sendDraft(d.id, activeContact.line_user_id)}
                      disabled={draftBusyId === d.id}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                    >
                      {draftBusyId === d.id ? "กำลังส่ง..." : "ส่งให้ลูกค้า"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Chat thread — LINE-style bubbles, both sides + ephemeral Action Bar log */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#e5ece5]">
            {detailLoading && <div className="text-xs text-stone-400 text-center py-8 animate-pulse">กำลังโหลด...</div>}
            {!detailLoading && detail?.messages.map((m) => (
              <div key={m.id} className={"flex " + (m.direction === "out" ? "justify-end" : "justify-start")}>
                <div className={"max-w-[70%] rounded-lg px-3 py-2 shadow-sm " + (m.direction === "out" ? "bg-[#a8e2a0]" : "bg-white border border-stone-200")}>
                  <p className="text-xs text-stone-800 whitespace-pre-line">{m.raw_text ?? `[${m.raw_type}]`}</p>
                  <p className="text-[9px] text-stone-500 mt-1 text-right">{fmtTime(m.created_at)}</p>
                </div>
              </div>
            ))}

            {/* Action Bar feedback — ephemeral, this session only (real results are
                always persisted as real documents, see the collapsed section below) */}
            {actionLog.map((entry) => (
              <div key={entry.id} className={"flex " + (entry.role === "user" ? "justify-end" : "justify-start")}>
                <div className={"max-w-[75%] rounded-lg px-3 py-2 shadow-sm " + (entry.role === "user" ? "bg-stone-800 text-white" : "bg-amber-50 border border-amber-200")}>
                  <p className={"text-xs whitespace-pre-line " + (entry.role === "user" ? "text-white" : "text-stone-800")}>{entry.text}</p>
                  {entry.confirmToken && !entry.confirmResolved && (
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => confirmActionEntry(entry)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 transition"
                      >
                        ยืนยัน
                      </button>
                      <button
                        onClick={() => cancelActionEntry(entry)}
                        className="px-2.5 py-1 rounded-lg border border-stone-300 text-stone-500 text-[11px] hover:bg-stone-50 transition"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  )}
                  {entry.confirmResolved === "cancelled" && (
                    <p className="mt-1 text-[10px] text-stone-400">ยกเลิกแล้ว ยังไม่บันทึกอะไร</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* พิมพ์ตอบลูกค้าโดยตรง — ข้อความจริงส่งเข้า LINE จริง ไม่ใช่ ephemeral */}
          <div className="border-t border-stone-200 bg-white flex-shrink-0 p-2.5">
            {replyError && <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 mb-2">{replyError}</div>}
            <div className="flex items-center gap-2">
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(activeContact.line_user_id) } }}
                placeholder="พิมพ์ตอบลูกค้า..."
                className="flex-1 text-xs border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={() => sendReply(activeContact.line_user_id)}
                disabled={replySending || !replyText.trim()}
                className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-40 hover:bg-emerald-700 transition"
              >
                {replySending ? "..." : "ส่ง"}
              </button>
            </div>
          </div>

          {/* GPS popover — real coordinates only, never guessed */}
          {gpsOpen && lastLocation?.extracted?.latitude != null && lastLocation.extracted.longitude != null && (
            <div className="border-t border-stone-200 bg-white flex-shrink-0 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-stone-600">{lastLocation.extracted.address ?? "พิกัดล่าสุดที่ส่งมา"}</span>
                <button onClick={() => setGpsOpen(false)} className="text-[11px] text-stone-400 hover:text-stone-700">ปิด</button>
              </div>
              <MapView
                title="พิกัดล่าสุด"
                onClose={() => setGpsOpen(false)}
                markers={[{ id: "loc", label: lastLocation.extracted.address ?? "จุดส่ง", x: 50, y: 50, tone: "success" }]}
              />
            </div>
          )}

          {/* AI ask — scoped to this contact's matched company if known */}
          {aiAskOpen && (
            <div className="border-t border-stone-200 bg-white flex-shrink-0 p-3 flex gap-2">
              <input
                autoFocus
                value={aiAskText}
                onChange={(e) => setAiAskText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && aiAskText.trim()) askAi(aiAskText.trim(), companyName, activeContact.line_user_id) }}
                placeholder={companyName ? `ถามเกี่ยวกับ ${companyName}...` : "ถามคำถามทั่วไป (ยังไม่จับคู่บริษัท)..."}
                className="flex-1 text-xs border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400"
              />
              <button
                onClick={() => aiAskText.trim() && askAi(aiAskText.trim(), companyName, activeContact.line_user_id)}
                disabled={!aiAskText.trim()}
                className="px-3 py-2 rounded-lg bg-stone-800 text-white text-xs font-semibold disabled:opacity-40 hover:bg-stone-700 transition"
              >
                ถาม
              </button>
            </div>
          )}

          {/* Action Bar — ซ่อน Events/Documents/Transactions ไว้เบื้องหลังปุ่ม */}
          {actionBarItems.length > 0 && (
            <ActionBar actions={actionBarItems} overflowActions={overflowActions} />
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file && activeContact) handleFileUpload(file, activeContact.line_user_id)
              e.target.value = ""
            }}
          />

          {/* Business events + documents — collapsed detail, not part of the chat scroll */}
          {!detailLoading && detail && (
            <details className="border-t border-stone-200 bg-white flex-shrink-0 max-h-64 overflow-y-auto">
              <summary className="px-4 py-2 text-xs font-semibold text-stone-500 cursor-pointer select-none hover:text-stone-800">
                รายละเอียดเพิ่มเติม (Business Events {detail.events.length} · เอกสาร {detail.documents.length})
              </summary>
              <div className="px-4 pb-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wide">Business Events</div>
                    <button
                      onClick={() => buildEvent(activeContact.line_user_id)}
                      disabled={building || detail.unlinkedCount === 0}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      {building ? "กำลังสร้าง..." : detail.unlinkedCount === 0 ? "ไม่มีข้อความใหม่" : `สร้าง Event จาก ${detail.unlinkedCount} ข้อความใหม่`}
                    </button>
                  </div>
                  {buildError && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 mb-2">{buildError}</div>}
                  {detail.events.length === 0 ? (
                    <div className="text-xs text-stone-400">ยังไม่มี Event ที่สร้างจากข้อความกลุ่มนี้</div>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.events.map((ev) => (
                        <div key={ev.id} className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-semibold text-emerald-700">{ev.event_code}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{ev.status}</span>
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
                  <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wide mb-2">เอกสาร</div>
                  {detail.documents.length === 0 ? (
                    <div className="text-xs text-stone-400">ไม่มีเอกสารที่จับคู่ได้</div>
                  ) : (
                    <div className="space-y-1">
                      {detail.documents.map((d) => (
                        <div key={d.id} className="flex justify-between text-xs bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5">
                          <span className="text-stone-700">{d.invoice_no ?? d.document_no} <span className="text-stone-400">({d.invoice_status ?? d.document_type})</span></span>
                          <span className="font-medium text-stone-800 tabular-nums">{formatMoney(d.total_amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </AppShell>
  )
}
