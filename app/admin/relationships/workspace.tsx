'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import Link from "next/link"
import {
  LayoutGrid, MessageCircle, Briefcase, Building2, FileText, Wallet, Mountain,
  MapPin, FileSignature, Receipt, Truck, Banknote, Phone, Paperclip, Bot,
} from "lucide-react"
import { formatMoney } from "@/engines/documents/document-editor"
import { AppShell, ActionBar, MapView, FlexPreview, Inspector, type IconRailItem, type ListColumnItem, type ActionBarItem } from "@/components/ui-kit"
import SettingsDrawer from "@/components/settings/SettingsDrawer"
import { WorkspaceProvider, useWorkspace } from "./workspace-state"
import { buildFeed, buildInspectorFields, type Relationship, type RelationshipDetail, type ActionLogEntry, type FeedItem } from "./feed"

const REASON_LABEL: Record<string, string> = {
  debt_inquiry: "ตอบคำถามยอดหนี้",
}

let actionLogSeq = 0
function nextActionLogId() {
  actionLogSeq += 1
  return `a${Date.now()}-${actionLogSeq}`
}

// Architecture Migration Phase 1 (2026-07-13, owner-directed): relocated
// from app/admin/line-customers/page.tsx. Workspace identity is now
// relationship_id (= companies.id) — every real company gets exactly one
// workspace here, whether or not it has ever sent a LINE message. LINE
// remains the real channel for send actions (reply/debt-reminder/document-
// send/build-event/ask), targeted via this relationship's
// `primaryLineUserId` (the most recently active linked LINE account)
// instead of the workspace's own identity — a relationship can have zero,
// one, or several linked LINE accounts (confirmed real case: a company with
// 2 LINE accounts for different staff).
const RAIL_ITEMS: IconRailItem[] = [
  { key: "dashboard", label: "เลขา", icon: LayoutGrid, href: "/admin/dashboard" },
  { key: "relationships", label: "ลูกค้า", icon: MessageCircle, href: "/admin/relationships" },
  { key: "jobs", label: "งาน", icon: Briefcase, href: "/admin/jobs" },
  { key: "partners", label: "คู่ค้า", icon: Building2, href: "/admin/partners" },
  { key: "transactions", label: "เอกสาร", icon: FileText, href: "/admin/transactions" },
  { key: "debt-tracking", label: "การเงิน", icon: Wallet, href: "/admin/debt-tracking" },
  { key: "pits", label: "บ่อวัสดุ", icon: Mountain, href: "/admin/pits" },
]

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
}

// Presentation Architecture (owner request 2026-07-11): a document has one
// presentation source — the Timeline Card. Opening it uses the same real
// HTML the document engine already generated (engines/documents/template.ts
// via generateDoc()) — no side panel, no second renderer, no new
// dependency. The HTML is a full standalone document (own <html>/<style>),
// so it must open in its own browsing context (a new tab), never be
// injected into this page's DOM — see DocumentViewer.tsx's iframe fix for
// why that matters.
function openHtmlDocument(html: string) {
  const blob = new Blob([html], { type: "text/html" })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, "_blank")
  if (!win) {
    URL.revokeObjectURL(url)
    return
  }
  // Revoke once the new tab has actually loaded the blob, not on a fixed
  // timer — freeing the URL too early would blank the tab.
  win.addEventListener("load", () => URL.revokeObjectURL(url), { once: true })
}

// Owner request 2026-07-11 (Unified Workspace): everything below runs inside
// <WorkspaceProvider> so Action Bar / AI Assistant / Preview Engine /
// Property Inspector / Automation status all read and write ONE shared
// state (see ./workspace-state.tsx) instead of only local useState — no page
// navigation happens anywhere in this file, every business op resolves
// inline via panels/drawers/inline confirm bubbles.
// Routing (owner section 6): /admin/relationships is the list, with no
// relationship pre-selected; /admin/relationships/[relationshipId] is the
// same workspace with that one relationship opened on load — the real,
// bookmarkable/deep-linkable route the architecture migration asked for.
// Both page.tsx files below just render this with a different prop.
export function RelationshipWorkspacePage({ initialRelationshipId }: { initialRelationshipId: string | null }) {
  return (
    <WorkspaceProvider>
      <RelationshipWorkspace initialRelationshipId={initialRelationshipId} />
    </WorkspaceProvider>
  )
}

function RelationshipWorkspace({ initialRelationshipId }: { initialRelationshipId: string | null }) {
  const { state, dispatch } = useWorkspace()
  const [relationships, setRelationships] = useState<Relationship[]>([])
  const [loading, setLoading] = useState(true)
  // Owner request 2026-07-11: badge on "บ่อวัสดุ" so it's visible right here
  // on the chat screen when the pricing engine couldn't answer a customer
  // (event stuck at ready_to_quote — see event-followup.ts's ok/text fix) —
  // reuses the existing quotation-queue instead of a new alerts table.
  const [pendingQuotesCount, setPendingQuotesCount] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RelationshipDetail | null>(null)
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

  const pushEntry = useCallback((entry: Omit<ActionLogEntry, "timestamp">) => {
    setActionLog((log) => [...log, { ...entry, timestamp: new Date().toISOString() }])
  }, [])

  useEffect(() => {
    fetch("/api/admin/relationships")
      .then((r) => r.json())
      .then((d) => setRelationships(d.relationships ?? []))
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

  const loadDetail = useCallback(async (relationshipId: string) => {
    const res = await fetch(`/api/admin/relationships/${relationshipId}`)
    const d = await res.json()
    setDetail({
      relationshipId: d.relationshipId, company: d.company,
      lineUserIds: d.lineUserIds ?? [], primaryLineUserId: d.primaryLineUserId ?? null,
      messages: d.messages ?? [], documents: d.documents ?? [], events: d.events ?? [],
      unlinkedCount: d.unlinkedCount ?? 0, drafts: d.drafts ?? [],
    })
  }, [])

  const selectRelationship = useCallback(async (relationshipId: string) => {
    setActiveId(relationshipId)
    setDetail(null)
    setBuildError(null)
    setActionLog([])
    setGpsOpen(false)
    setAiAskOpen(false)
    setReplyText("")
    setReplyError(null)
    dispatch({ type: "SET_PENDING_PREVIEW", preview: null })
    dispatch({ type: "SELECT_ITEM", selection: null })
    setDetailLoading(true)
    try {
      await loadDetail(relationshipId)
    } finally {
      setDetailLoading(false)
    }
  }, [loadDetail, dispatch])

  // Deep link support (/admin/relationships/[relationshipId]) — open that
  // one relationship's workspace on load, same as clicking it in the list.
  useEffect(() => {
    if (initialRelationshipId) selectRelationship(initialRelationshipId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRelationshipId])

  const sendDraft = useCallback(async (draftId: string, relationshipId: string) => {
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
      await loadDetail(relationshipId)
      setRelationships((prev) => prev.map((r) => r.relationship_id === relationshipId ? { ...r, has_pending_draft: false } : r))
    } finally {
      setDraftBusyId(null)
    }
  }, [draftEdits, loadDetail])

  const rejectDraft = useCallback(async (draftId: string, relationshipId: string) => {
    setDraftBusyId(draftId)
    setDraftError(null)
    try {
      const res = await fetch(`/api/admin/outbound-drafts/${draftId}/reject`, { method: "POST" })
      if (!res.ok) { const d = await res.json(); setDraftError(d.error ?? "ยกเลิกไม่สำเร็จ"); return }
      await loadDetail(relationshipId)
      setRelationships((prev) => prev.map((r) => r.relationship_id === relationshipId ? { ...r, has_pending_draft: false } : r))
    } finally {
      setDraftBusyId(null)
    }
  }, [loadDetail])

  const buildEvent = useCallback(async (lineUserId: string, relationshipId: string) => {
    setBuilding(true)
    setBuildError(null)
    try {
      const res = await fetch(`/api/admin/line-customers/${lineUserId}/build-event`, { method: "POST" })
      const d = await res.json()
      if (!res.ok) {
        setBuildError(d.error ?? "สร้าง Event ไม่สำเร็จ")
        return
      }
      await loadDetail(relationshipId)
    } finally {
      setBuilding(false)
    }
  }, [loadDetail])

  // Owner-reported gap 2026-07-11: this page had no way to type a real reply
  // straight to the customer — only a draft-approval banner (only appears
  // when the bot queued a draft) and an internal-only "ask AI" box. This
  // pushes a real LINE message and refreshes the real thread.
  const sendReply = useCallback(async (lineUserId: string, relationshipId: string) => {
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
      await loadDetail(relationshipId)
    } finally {
      setReplySending(false)
    }
  }, [replyText, loadDetail])

  // Action Bar → cognitive pipeline (owner request 2026-07-11: ปุ่มสร้างเอกสาร
  // ไม่เรียก backend ใหม่ — ยิงข้อความไทยสำเร็จรูปเข้า /api/chat เหมือนพิมพ์เอง
  // เพื่อใช้ Rule-72 preview/confirm flow เดิมที่ทำไว้แล้วสำหรับ SecretaryChat).
  // Populates shared state's pendingPreview — the Document Engine / Preview
  // Engine / Rule Engine all read that one slot instead of separate flags.
  const runCommand = useCallback(async (text: string, lineUserId: string | null) => {
    if (!activeId) return
    setActionSending(true)
    pushEntry({ id: nextActionLogId(), role: "user", text })
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json()
      const entryId = nextActionLogId()
      pushEntry({
        id: entryId,
        role: "system",
        text: data.text ?? "รับทราบครับ",
        confirmToken: data.confirm_token,
        confirmAction: data.confirm_action,
        flexPreview: data.flex_preview,
        fullHtml: data.doc_html,
      })
      if (data.confirm_token) {
        dispatch({
          type: "SET_PENDING_PREVIEW",
          preview: {
            kind: "document_create", entryId, lineUserId: lineUserId ?? "",
            flexPreview: data.flex_preview, fullHtml: data.doc_html,
            confirmToken: data.confirm_token, confirmAction: data.confirm_action,
          },
        })
      }
    } catch {
      pushEntry({ id: nextActionLogId(), role: "system", text: "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้งครับ" })
    } finally {
      setActionSending(false)
    }
  }, [activeId, pushEntry, dispatch])

  // Owner request 2026-07-11: unifies the two previously-separate confirm
  // handlers (document.create's Rule-72 token vs debt-reminder's mode param)
  // into one — branches on the entry shape instead of duplicating the same
  // "mark resolved → POST → report → refresh" flow twice.
  const resolvePendingEntry = useCallback(async (entry: ActionLogEntry, lineUserId: string | null) => {
    if (!activeId) return
    setActionLog((log) => log.map((x) => x.id === entry.id ? { ...x, confirmResolved: "confirmed" } : x))
    dispatch({ type: "SET_PENDING_PREVIEW", preview: null })
    const isDebt = Boolean(entry.debtSendPending)
    if (isDebt && !lineUserId) return
    try {
      const res = await fetch(
        isDebt ? `/api/admin/line-customers/${lineUserId}/send-debt` : "/api/chat/confirm",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isDebt
              ? { mode: "execute" }
              : { action: entry.confirmAction, preview_token: entry.confirmToken, lineUserId: lineUserId ?? undefined }
          ),
        }
      )
      const data = await res.json()
      const text = !data.ok
        ? `ยืนยันไม่สำเร็จ: ${data.error ?? "ไม่ทราบสาเหตุ"}`
        : isDebt
        ? "✅ ส่งแจ้งยอดค้างชำระให้ลูกค้าแล้ว"
        : data.line_send_error
        ? `✅ บันทึกเรียบร้อยครับ แต่${data.line_send_error}`
        : "✅ บันทึกและส่งให้ลูกค้าทาง LINE เรียบร้อยครับ"
      pushEntry({ id: nextActionLogId(), role: "system", text })
      if (data.ok) await loadDetail(activeId)
    } catch {
      pushEntry({ id: nextActionLogId(), role: "system", text: "ยืนยันไม่สำเร็จ ลองใหม่อีกครั้งครับ" })
    }
  }, [activeId, loadDetail, pushEntry, dispatch])

  const cancelPendingEntry = useCallback((entry: ActionLogEntry) => {
    setActionLog((log) => log.map((x) => x.id === entry.id ? { ...x, confirmResolved: "cancelled" } : x))
    dispatch({ type: "SET_PENDING_PREVIEW", preview: null })
  }, [dispatch])

  const handleFileUpload = useCallback(async (file: File, relationshipId: string) => {
    pushEntry({ id: nextActionLogId(), role: "user", text: `📎 แนบไฟล์ ${file.name}` })
    const formData = new FormData()
    formData.append("file", file)
    formData.append("documentId", relationshipId)
    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body: formData })
      const data = await res.json()
      pushEntry({
        id: nextActionLogId(), role: "system",
        text: res.ok ? `📎 แนบไฟล์ ${data.name} แล้ว` : `แนบไฟล์ไม่สำเร็จ: ${data.error ?? "ไม่ทราบสาเหตุ"}`,
      })
    } catch {
      pushEntry({ id: nextActionLogId(), role: "system", text: "แนบไฟล์ไม่สำเร็จ ลองใหม่อีกครั้งครับ" })
    }
  }, [pushEntry])

  // Owner-reported gap 2026-07-11: this used to just forward to runCommand
  // (/api/chat → generic cognitive pipeline), which has no idea about real
  // material prices. Now goes through the dedicated ask route, which checks
  // deterministically whether the question names a real material first and
  // answers with the real pricing engine using this contact's own GPS —
  // anything else still falls through to the same pipeline as before.
  const askAi = useCallback(async (question: string, companyName: string | null, lineUserId: string, relationshipId: string) => {
    setAiAskOpen(false)
    setAiAskText("")
    const text = companyName ? `คุณ${companyName} ${question}` : question
    setActionSending(true)
    pushEntry({ id: nextActionLogId(), role: "user", text: question })
    try {
      const res = await fetch(`/api/admin/line-customers/${lineUserId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      })
      const data = await res.json()
      const entryId = nextActionLogId()
      pushEntry({
        id: entryId,
        role: "system",
        text: data.text ?? "รับทราบครับ",
        confirmToken: data.confirm_token,
        confirmAction: data.confirm_action,
        flexPreview: data.flex_preview,
        fullHtml: data.doc_html,
      })
      if (data.confirm_token) {
        dispatch({
          type: "SET_PENDING_PREVIEW",
          preview: {
            kind: "document_create", entryId, lineUserId,
            flexPreview: data.flex_preview, fullHtml: data.doc_html,
            confirmToken: data.confirm_token, confirmAction: data.confirm_action,
          },
        })
      }
    } catch {
      pushEntry({ id: nextActionLogId(), role: "system", text: "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้งครับ" })
    } finally {
      setActionSending(false)
    }
  }, [pushEntry, dispatch])

  // Owner request 2026-07-11: the debt figure and existing documents shown
  // in this page were passive display only — these actually push a real
  // LINE Flex card to the customer, right from this one screen.
  const sendDebt = useCallback(async (lineUserId: string) => {
    setActionSending(true)
    pushEntry({ id: nextActionLogId(), role: "user", text: "💰 เตรียมแจ้งยอดค้างชำระ" })
    try {
      const res = await fetch(`/api/admin/line-customers/${lineUserId}/send-debt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preview" }),
      })
      const data = await res.json()
      const entryId = nextActionLogId()
      pushEntry({
        id: entryId,
        role: "system",
        text: data.ok ? "การ์ดแจ้งยอดค้างชำระ — กดยืนยันเพื่อส่งจริงครับ" : `เตรียมไม่สำเร็จ: ${data.error ?? "ไม่ทราบสาเหตุ"}`,
        flexPreview: data.flex_preview,
        debtSendPending: data.ok,
      })
      if (data.ok) {
        dispatch({
          type: "SET_PENDING_PREVIEW",
          preview: { kind: "debt_reminder_send", entryId, lineUserId, flexPreview: data.flex_preview },
        })
      }
    } catch {
      pushEntry({ id: nextActionLogId(), role: "system", text: "เตรียมไม่สำเร็จ ลองใหม่อีกครั้งครับ" })
    } finally {
      setActionSending(false)
    }
  }, [pushEntry, dispatch])

  const sendDocument = useCallback(async (lineUserId: string, doc: { id: string; table: "invoices" | "standalone_documents"; invoice_no?: string; document_no?: string }) => {
    const label = doc.invoice_no ?? doc.document_no ?? ""
    setActionSending(true)
    pushEntry({ id: nextActionLogId(), role: "user", text: `📄 ส่งเอกสาร ${label}` })
    try {
      const res = await fetch(`/api/admin/line-customers/${lineUserId}/send-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: doc.table, documentId: doc.id }),
      })
      const data = await res.json()
      pushEntry({ id: nextActionLogId(), role: "system", text: data.ok ? `✅ ส่ง ${label} ให้ลูกค้าแล้ว` : `ส่งไม่สำเร็จ: ${data.error ?? "ไม่ทราบสาเหตุ"}` })
    } catch {
      pushEntry({ id: nextActionLogId(), role: "system", text: "ส่งไม่สำเร็จ ลองใหม่อีกครั้งครับ" })
    } finally {
      setActionSending(false)
    }
  }, [pushEntry])

  const listItems: ListColumnItem[] = relationships.map((r) => ({
    id: r.relationship_id,
    title: r.name,
    subtitle: r.last_message ?? (r.line_user_ids.length ? "" : "ยังไม่มีข้อความ LINE"),
    timestamp: r.last_message_at ? fmtTime(r.last_message_at) : "",
    avatarUrl: r.line_picture ?? undefined,
    highlighted: r.has_pending_draft,
  }))

  const activeRelationship = relationships.find((r) => r.relationship_id === activeId) ?? null
  const primaryLineUserId = detail?.primaryLineUserId ?? null
  const pendingDrafts = detail?.drafts.filter((d) => d.status === "pending_review") ?? []

  const companyName = activeRelationship?.name ?? null
  const lastLocation = [...(detail?.messages ?? [])].reverse().find((m) => m.raw_type === "location" && m.extracted?.latitude != null)

  // Owner request 2026-07-11 (Event Card Framework / Timeline module): one
  // merged, time-sorted feed — messages + Action Bar results + business
  // events + past documents — replaces the old split rendering (raw message
  // list + a separate collapsed "รายละเอียดเพิ่มเติม" panel).
  const feed = useMemo(() => buildFeed(detail, actionLog), [detail, actionLog])

  const selectedInspector = useMemo(() => {
    if (!state.selection) return null
    const item = feed.find((f) => f.id === state.selection!.id)
    if (!item) return null
    return buildInspectorFields(item)
  }, [state.selection, feed])

  const renderTimelineCard = (item: FeedItem) => {
    switch (item.presentation_template) {
      case "message.timeline-card": {
        if (!("message" in item)) return null
        const m = item.message
        return (
          <div key={item.template_key} className={"flex " + (m.direction === "out" ? "justify-end" : "justify-start")}>
            <div className={"max-w-[70%] rounded-lg px-3 py-2 shadow-sm " + (m.direction === "out" ? "bg-[#a8e2a0]" : "bg-white border border-stone-200")}>
              <p className="text-xs text-stone-800 whitespace-pre-line">{m.raw_text ?? `[${m.raw_type}]`}</p>
              <p className="text-[9px] text-stone-500 mt-1 text-right">{fmtTime(m.created_at)}</p>
            </div>
          </div>
        )
      }
      case "business-event.timeline-card": {
        if (!("event" in item)) return null
        const ev = item.event
        const selected = state.selection?.kind === item.source_type && state.selection.id === item.id
        return (
          <button
            key={item.template_key}
            onClick={() => dispatch({ type: "SELECT_ITEM", selection: selected ? null : { kind: item.source_type, id: item.id } })}
            className={"block w-full text-left bg-stone-50 border rounded-lg px-3 py-2 hover:border-emerald-300 transition " + (selected ? "border-emerald-400 ring-1 ring-emerald-200" : "border-stone-200")}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold text-emerald-700">{ev.event_code}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{ev.status}</span>
            </div>
            <div className="mt-1 text-xs text-stone-700">
              {ev.material_text ?? "-"} {ev.quantity ? `${ev.quantity} ${ev.quantity_unit ?? ""}` : ""} {ev.destination ? `-> ${ev.destination}` : ""}
            </div>
            {item.documents.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.documents.map((d) => (
                  <span
                    key={d.id}
                    className="text-[10px] font-medium px-2 py-0.5 rounded border border-stone-200 bg-white text-stone-500"
                  >
                    {d.invoice_no ?? d.document_no} · {formatMoney(d.total_amount)}
                  </span>
                ))}
              </div>
            )}
          </button>
        )
      }
      case "document-artifact.timeline-card": {
        if (!("doc" in item)) return null
        const d = item.doc
        const selected = state.selection?.kind === item.source_type && state.selection.id === item.id
        return (
          <div key={item.template_key} className={"flex items-center justify-between text-xs bg-white border rounded-lg px-3 py-2 gap-2 " + (selected ? "border-emerald-400 ring-1 ring-emerald-200" : "border-stone-200")}>
            <button
              onClick={() => dispatch({ type: "SELECT_ITEM", selection: selected ? null : { kind: item.source_type, id: item.id } })}
              className="flex-1 min-w-0 text-left"
            >
              <span className="text-stone-700">{d.invoice_no ?? d.document_no} <span className="text-stone-400">({d.invoice_status ?? d.document_type})</span></span>
              <span className="block font-medium text-stone-800 tabular-nums">{formatMoney(d.total_amount)}</span>
            </button>
            <button
              onClick={() => primaryLineUserId && sendDocument(primaryLineUserId, d)}
              disabled={actionSending || !primaryLineUserId}
              title={primaryLineUserId ? undefined : "ยังไม่มีช่องทาง LINE สำหรับลูกค้ารายนี้"}
              className="text-[10px] font-medium px-2 py-1 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 transition flex-shrink-0"
            >
              ส่ง
            </button>
          </div>
        )
      }
      case "action-result.timeline-card": {
        if (!("entry" in item)) return null
        const entry = item.entry
        return (
          <div key={item.template_key} className={"flex " + (entry.role === "user" ? "justify-end" : "justify-start")}>
            <div className={"max-w-[75%] rounded-lg px-3 py-2 shadow-sm " + (entry.role === "user" ? "bg-stone-800 text-white" : "bg-amber-50 border border-amber-200")}>
              <p className={"text-xs whitespace-pre-line " + (entry.role === "user" ? "text-white" : "text-stone-800")}>{entry.text}</p>

              {entry.flexPreview && (
                <div className="mt-2">
                  <FlexPreview flex={entry.flexPreview} />
                </div>
              )}
              {entry.fullHtml && (
                <button
                  onClick={() => openHtmlDocument(entry.fullHtml!)}
                  className="mt-2 text-[10px] px-2 py-1 rounded-lg border border-stone-300 text-stone-600 bg-white hover:bg-stone-50"
                >
                  เปิดเอกสารเต็ม
                </button>
              )}

              {entry.confirmToken && !entry.confirmResolved && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => resolvePendingEntry(entry, primaryLineUserId)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 transition"
                  >
                    ยืนยัน
                  </button>
                  <button
                    onClick={() => cancelPendingEntry(entry)}
                    className="px-2.5 py-1 rounded-lg border border-stone-300 text-stone-500 text-[11px] hover:bg-stone-50 transition"
                  >
                    ยกเลิก
                  </button>
                </div>
              )}
              {entry.debtSendPending && !entry.confirmResolved && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => resolvePendingEntry(entry, primaryLineUserId)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 transition"
                  >
                    ยืนยันส่ง
                  </button>
                  <button
                    onClick={() => cancelPendingEntry(entry)}
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
        )
      }
    }
  }

  const actionBarItems: ActionBarItem[] = activeRelationship ? [
    {
      key: "gps", label: "GPS", icon: MapPin,
      onClick: () => setGpsOpen((v) => !v),
      disabled: !lastLocation,
      tooltip: lastLocation ? undefined : "ยังไม่มีพิกัดที่ลูกค้าส่งมา",
    },
    {
      key: "quotation", label: "ใบเสนอราคา", icon: FileSignature,
      onClick: () => runCommand(`เสนอราคาให้คุณ${companyName}`, primaryLineUserId),
      disabled: !companyName || actionSending,
    },
    {
      key: "invoice", label: "Invoice", icon: Receipt,
      onClick: () => runCommand(`ออกบิลให้คุณ${companyName}`, primaryLineUserId),
      disabled: !companyName || actionSending,
    },
    {
      key: "delivery", label: "ส่งของ", icon: Truck,
      onClick: () => runCommand(`ออกใบส่งสินค้าให้คุณ${companyName}`, primaryLineUserId),
      disabled: !companyName || actionSending,
    },
    {
      key: "receipt", label: "รับเงิน", icon: Banknote,
      onClick: () => runCommand(`ออกใบเสร็จให้คุณ${companyName}`, primaryLineUserId),
      disabled: !companyName || actionSending,
    },
    {
      key: "call", label: "โทรหา", icon: Phone,
      onClick: () => { if (activeRelationship.phone) window.location.href = `tel:${activeRelationship.phone}` },
      disabled: !activeRelationship.phone,
      tooltip: activeRelationship.phone ? undefined : "ไม่มีเบอร์โทรในระบบ",
    },
    {
      key: "attach", label: "ไฟล์", icon: Paperclip,
      onClick: () => fileInputRef.current?.click(),
    },
    {
      key: "ai", label: "ถาม AI", icon: Bot,
      onClick: () => setAiAskOpen((v) => !v),
      disabled: !primaryLineUserId,
      tooltip: primaryLineUserId ? undefined : "ยังไม่มีช่องทาง LINE สำหรับลูกค้ารายนี้",
    },
  ] : []

  const overflowActions: ActionBarItem[] = activeRelationship ? [
    {
      key: "boq", label: "สร้าง BOQ", icon: FileText,
      onClick: () => runCommand(`สร้าง boq ให้คุณ${companyName}`, primaryLineUserId),
      disabled: !companyName,
    },
    {
      key: "billing", label: "ใบวางบิล", icon: FileText,
      onClick: () => runCommand(`ออกใบกำกับภาษีให้คุณ${companyName}`, primaryLineUserId),
      disabled: !companyName,
    },
  ] : []

  const railItems: IconRailItem[] = RAIL_ITEMS.map((item) =>
    item.key === "pits" && pendingQuotesCount > 0 ? { ...item, badge: pendingQuotesCount } : item
  )

  return (
    <AppShell
      railItems={railItems}
      activeRailKey="relationships"
      listItems={listItems}
      activeListId={activeId}
      onSelectList={selectRelationship}
      listSearchPlaceholder="ค้นหาชื่อหรือข้อความ..."
      listEmptyMessage={loading ? "กำลังโหลด..." : "ยังไม่มีลูกค้าในระบบ"}
    >
      {!activeRelationship ? (
        <div className="flex items-center justify-center h-full text-sm text-stone-400">
          เลือกลูกค้าทางซ้ายเพื่อเปิด Workspace
        </div>
      ) : (
        <div className="flex h-full">
          <div className="flex flex-col h-full flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200 flex-shrink-0 bg-white">
              {activeRelationship.line_picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeRelationship.line_picture} alt="" className="w-9 h-9 rounded-full object-cover bg-stone-100" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-stone-200" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-stone-800 truncate">{activeRelationship.name}</p>
                <Link href={`/admin/partners/${activeRelationship.relationship_id}`} className="text-[11px] text-emerald-600 hover:underline">
                  ดูรายละเอียดเพิ่มเติม →
                </Link>
              </div>
              {/* Automation Engine status — owner request 2026-07-11: always
                  visible without opening the Settings drawer */}
              {state.automation && (
                <span className={"text-[10px] px-2 py-1 rounded-full border flex-shrink-0 " + (state.automation.debtReminderEnabled ? "border-emerald-200 text-emerald-700 bg-emerald-50" : "border-stone-200 text-stone-400")}>
                  {state.automation.debtReminderEnabled ? `อัตโนมัติ: เปิด ${String(state.automation.debtReminderHour).padStart(2, "0")}:00 น.` : "อัตโนมัติ: ปิด"}
                </span>
              )}
              {activeRelationship.debt && (
                <div className="text-right flex-shrink-0 flex items-center gap-2">
                  <div>
                    <p className="text-xs font-semibold text-rose-600">{formatMoney(activeRelationship.debt.total_outstanding)} บาท</p>
                    <p className="text-[10px] text-stone-400">ผิดนัด {activeRelationship.debt.days_overdue} วัน</p>
                  </div>
                  <button
                    onClick={() => primaryLineUserId && sendDebt(primaryLineUserId)}
                    disabled={actionSending || !primaryLineUserId}
                    title={primaryLineUserId ? undefined : "ยังไม่มีช่องทาง LINE สำหรับลูกค้ารายนี้"}
                    className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-40 transition"
                  >
                    ส่ง
                  </button>
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
                        onClick={() => rejectDraft(d.id, activeRelationship.relationship_id)}
                        disabled={draftBusyId === d.id}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                      >
                        ยกเลิก
                      </button>
                      <button
                        onClick={() => sendDraft(d.id, activeRelationship.relationship_id)}
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

            {/* Business Event Engine: create an Event from new unlinked messages —
                a bulk action, not tied to one feed item, so it lives here rather
                than inside the merged feed below. */}
            {!detailLoading && detail && (
              <div className="flex items-center justify-between px-4 py-1.5 border-b border-stone-100 bg-white flex-shrink-0">
                <span className="text-[10px] text-stone-400">Timeline: {feed.length} รายการ</span>
                <button
                  onClick={() => primaryLineUserId && buildEvent(primaryLineUserId, activeRelationship.relationship_id)}
                  disabled={building || detail.unlinkedCount === 0 || !primaryLineUserId}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {building ? "กำลังสร้าง..." : detail.unlinkedCount === 0 ? "ไม่มีข้อความใหม่" : `สร้าง Event จาก ${detail.unlinkedCount} ข้อความใหม่`}
                </button>
              </div>
            )}
            {buildError && <div className="text-xs text-rose-600 bg-rose-50 border-b border-rose-100 px-4 py-2">{buildError}</div>}

            {/* Unified Timeline feed — messages + Action Bar results + business
                events + past documents, one chronological scroll, LINE-style. */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#e5ece5]">
              {detailLoading && <div className="text-xs text-stone-400 text-center py-8 animate-pulse">กำลังโหลด...</div>}
              {!detailLoading && feed.length === 0 && (
                <div className="text-xs text-stone-400 text-center py-8">ยังไม่มีข้อความหรือประวัติสำหรับลูกค้ารายนี้</div>
              )}
              {!detailLoading && feed.map(renderTimelineCard)}
            </div>

            {/* พิมพ์ตอบลูกค้าโดยตรง — ข้อความจริงส่งเข้า LINE จริง ไม่ใช่ ephemeral */}
            <div className="border-t border-stone-200 bg-white flex-shrink-0 p-2.5">
              {replyError && <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 mb-2">{replyError}</div>}
              <div className="flex items-center gap-2">
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && primaryLineUserId) { e.preventDefault(); sendReply(primaryLineUserId, activeRelationship.relationship_id) } }}
                  placeholder={primaryLineUserId ? "พิมพ์ตอบลูกค้า..." : "ยังไม่มีช่องทาง LINE สำหรับลูกค้ารายนี้"}
                  disabled={!primaryLineUserId}
                  className="flex-1 text-xs border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500 disabled:bg-stone-50 disabled:text-stone-400"
                />
                <button
                  onClick={() => primaryLineUserId && sendReply(primaryLineUserId, activeRelationship.relationship_id)}
                  disabled={replySending || !replyText.trim() || !primaryLineUserId}
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
            {aiAskOpen && primaryLineUserId && (
              <div className="border-t border-stone-200 bg-white flex-shrink-0 p-3 flex gap-2">
                <input
                  autoFocus
                  value={aiAskText}
                  onChange={(e) => setAiAskText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && aiAskText.trim()) askAi(aiAskText.trim(), companyName, primaryLineUserId, activeRelationship.relationship_id) }}
                  placeholder={companyName ? `ถามเกี่ยวกับ ${companyName}...` : "ถามคำถามทั่วไป..."}
                  className="flex-1 text-xs border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400"
                />
                <button
                  onClick={() => aiAskText.trim() && askAi(aiAskText.trim(), companyName, primaryLineUserId, activeRelationship.relationship_id)}
                  disabled={!aiAskText.trim()}
                  className="px-3 py-2 rounded-lg bg-stone-800 text-white text-xs font-semibold disabled:opacity-40 hover:bg-stone-700 transition"
                >
                  ถาม
                </button>
              </div>
            )}

            {/* Action Bar */}
            {actionBarItems.length > 0 && (
              <ActionBar actions={actionBarItems} overflowActions={overflowActions} />
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file && activeRelationship) handleFileUpload(file, activeRelationship.relationship_id)
                e.target.value = ""
              }}
            />
          </div>

          {/* Property Inspector — contextual right panel, owner request
              2026-07-11: appears only when something in the Timeline is
              selected, shows structured fields (e.g. debt fee formula
              breakdown) instead of just the lump total in the bubble. */}
          {selectedInspector && (
            <div className="w-72 flex-shrink-0 border-l border-stone-200">
              <Inspector
                variant="panel"
                title={selectedInspector.title}
                fields={selectedInspector.fields}
                onClose={() => dispatch({ type: "SELECT_ITEM", selection: null })}
              />
            </div>
          )}
        </div>
      )}

      {/* ตั้งค่าบริษัท/ภาษี/ข้อตกลง/แจ้งหนี้อัตโนมัติ — ยังไม่มีจุดเข้าอื่นในระบบ */}
      <div className="fixed bottom-3 left-1.5 z-40 w-[56px]">
        <SettingsDrawer
          onSettingsLoaded={(s) => dispatch({ type: "SET_AUTOMATION", automation: { debtReminderEnabled: s.debtReminderAutoEnabled, debtReminderHour: s.debtReminderHour } })}
        />
      </div>
    </AppShell>
  )
}
