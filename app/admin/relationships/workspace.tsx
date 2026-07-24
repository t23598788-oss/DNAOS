'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import Link from "next/link"
import {
  LayoutGrid, MessageCircle, Briefcase, Building2, FileText, Wallet, Mountain,
  MapPin, FileSignature, Receipt, Truck, Banknote, Phone, Paperclip, Bot, X, ExternalLink, Settings,
} from "lucide-react"
import { formatMoney } from "@/engines/documents/document-editor"
import { AppShell, ActionBar, MapView, FlexPreview, Inspector, type IconRailItem, type ListColumnItem, type ActionBarItem } from "@/components/ui-kit"
import { createBrowserSupabase } from "@/services/supabase/browser"
import SettingsDrawer from "@/components/settings/SettingsDrawer"
import ContactSettingsModal from "@/components/line/ContactSettingsModal"
import AppHeader from "@/components/nav/AppHeader"
import { WorkspaceProvider, useWorkspace } from "./workspace-state"
import { buildFeed, buildInspectorFields, DOCUMENT_TYPE_LABEL, type Relationship, type RelationshipDetail, type ActionLogEntry, type FeedItem } from "./feed"

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
// Navigation redesign (owner, 2026-07-16): left rail is the system's central
// nav — Relationship Workspace (ข้อความ) is Home, every other real module
// listed here. "รายงาน" intentionally omitted — no real report page exists
// yet in this repo; adding a link to a page that doesn't exist would be a
// guess, not a fix.
const RAIL_ITEMS: IconRailItem[] = [
  { key: "dashboard", label: "เลขา", icon: LayoutGrid, href: "/admin/dashboard" },
  { key: "relationships", label: "ข้อความ", icon: MessageCircle, href: "/admin/relationships" },
  { key: "jobs", label: "งาน", icon: Briefcase, href: "/admin/jobs" },
  { key: "partners", label: "คู่ค้า", icon: Building2, href: "/admin/partners" },
  { key: "transactions", label: "เอกสาร", icon: FileText, href: "/admin/transactions" },
  { key: "debt-tracking", label: "การเงิน", icon: Wallet, href: "/admin/debt-tracking" },
  { key: "pits", label: "บ่อวัสดุ", icon: Mountain, href: "/admin/pits" },
  { key: "build", label: "ระบบ", icon: Settings, href: "/admin/build" },
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
  // Owner request 2026-07-16: AI/action results were rendering inline in the
  // same timeline as real customer messages ("ข้อความสีเหลือง...ไม่ควรมาแสดงผล
  // แบบนี้"), which could be misread as something actually sent to the
  // customer. Cockpit Panel — a Copilot-style right-side drawer — separates
  // "AI thinking/tool output" from "the real conversation" while staying on
  // one screen (no tab switch), per the owner's explicit design: right side,
  // slide-out on a button, results render inside the panel itself.
  const [cockpitOpen, setCockpitOpen] = useState(false)
  const [cockpitHtmlPreview, setCockpitHtmlPreview] = useState<string | null>(null)
  // TASK-002 item 1 — fullscreen image lightbox on click.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [aiAskText, setAiAskText] = useState("")
  const [replyText, setReplyText] = useState("")
  const [replySending, setReplySending] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-opens the Cockpit whenever any command/tool result is produced
  // (quick-action buttons, ask AI, file upload, etc.) — otherwise a result
  // could land in a closed panel the owner never sees.
  const pushEntry = useCallback((entry: Omit<ActionLogEntry, "timestamp">) => {
    setActionLog((log) => [...log, { ...entry, timestamp: new Date().toISOString() }])
    setCockpitOpen(true)
  }, [])

  const loadRelationships = useCallback(async () => {
    const res = await fetch("/api/admin/relationships", { cache: "no-store" })
    const data = await res.json()
    if (res.ok) setRelationships(data.relationships ?? [])
  }, [])

  useEffect(() => {
    loadRelationships().finally(() => setLoading(false))
  }, [loadRelationships])

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

  // "New customers never disappear" (owner, 2026-07-18) — Relationship =
  // LINE Contact, not Company. This is a purely OPTIONAL, later enrichment
  // step (attaching a company to an already-usable contact), never a
  // precondition for the contact to exist or be usable — chat/reply already
  // works via lineUserId regardless of match status (see sendReply above).
  const matchUnmatchedContact = useCallback(async (lineUserId: string, contactName: string) => {
    const existingName = prompt("ค้นหาบริษัทที่มีอยู่แล้ว (พิมพ์ชื่อบริษัทให้ตรงเป๊ะ) หรือเว้นว่างเพื่อสร้างบริษัทใหม่:")
    if (existingName === null) return
    let body: Record<string, unknown>
    if (existingName.trim()) {
      const res = await fetch(`/api/admin/partners?search=${encodeURIComponent(existingName.trim())}`).catch(() => null)
      const data = res && res.ok ? await res.json().catch(() => null) : null
      const match = data?.partners?.find((p: { name: string }) => p.name === existingName.trim())
      if (!match) { alert("ไม่พบบริษัทชื่อนี้ในระบบ — ลองพิมพ์ให้ตรงเป๊ะ หรือเว้นว่างเพื่อสร้างใหม่"); return }
      body = { companyId: match.id }
    } else {
      const newName = prompt("ชื่อบริษัทใหม่:", contactName)
      if (!newName?.trim()) return
      body = { newCompany: { name: newName.trim() } }
    }
    const res = await fetch(`/api/admin/relationships/${lineUserId}/match`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })
    const result = await res.json()
    if (!res.ok) { alert(result.error ?? "จับคู่ไม่สำเร็จ"); return }
    const listRes = await fetch("/api/admin/relationships")
    const listData = await listRes.json()
    setRelationships(listData.relationships ?? [])
    setActiveId(result.companyId)
  }, [])

  const loadDetail = useCallback(async (relationshipId: string) => {
    const res = await fetch(`/api/admin/relationships/${relationshipId}`, { cache: "no-store" })
    const d = await res.json()
    if (!res.ok) return
    setDetail({
      relationshipId: d.relationshipId, company: d.company, unmatched: d.unmatched ?? false,
      lineUserIds: d.lineUserIds ?? [], primaryLineUserId: d.primaryLineUserId ?? null,
      messages: d.messages ?? [], documents: d.documents ?? [], events: d.events ?? [],
      receipts: d.receipts ?? [],
      unlinkedCount: d.unlinkedCount ?? 0, drafts: d.drafts ?? [],
    })
  }, [])

  // LINE is the source of truth for the live conversation. Company matching
  // is optional enrichment and must never gate a new contact or a new message
  // from appearing in the workspace. INSERT covers inbound/outbound messages;
  // UPDATE covers media_path arriving after the initial image/file row.
  useEffect(() => {
    const client = createBrowserSupabase()
    const channel = client
      .channel("line-events-workspace")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "line_events" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { line_user_id?: string } | null
          const lineUserId = row?.line_user_id
          if (!lineUserId) return

          // Refresh the sidebar so a brand-new LINE contact appears without
          // refresh or company matching. Refresh the open room only when the
          // changed row belongs to its LINE thread.
          void loadRelationships()
          const activeThread = activeId === lineUserId || detail?.lineUserIds.includes(lineUserId)
          if (activeThread && activeId) void loadDetail(activeId)
        }
      )
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [activeId, detail?.lineUserIds, loadDetail, loadRelationships])

  const selectRelationship = useCallback(async (relationshipId: string) => {
    setActiveId(relationshipId)
    setDetail(null)
    setBuildError(null)
    setActionLog([])
    setGpsOpen(false)
    setCockpitHtmlPreview(null)
    setReplyText("")
    setReplyError(null)
    dispatch({ type: "SET_PENDING_PREVIEW", preview: null })
    dispatch({ type: "SELECT_ITEM", selection: null })
    // TASK-002 item 5 (unread) — mark this room "viewed now" so its unread
    // dot clears; real timestamp, not a guess.
    localStorage.setItem(`dnaos.lastViewed.${relationshipId}`, new Date().toISOString())
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
      // Real incident 2026-07-24: this used to auto-send the missing-info
      // question straight to the customer, no review — an ambiguous debt
      // conversation got misclassified as a material order and the wrong
      // message went out 3 times. Now it only pre-fills the existing reply
      // box; the admin reads/edits/sends it themselves, or clears it if the
      // classification was wrong for this cluster.
      if (d.pendingReply) {
        setReplyText(d.pendingReply)
        setBuildError("AI แนะนำคำถามนี้ — ตรวจสอบก่อนกด \"ส่ง\" ด้านล่าง หรือลบทิ้งถ้าจัดหมวดผิด")
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
        // UX Change (owner, 2026-07-17): Cockpit shows workflow status only
        // — flexPreview/fullHtml above are kept on the entry purely so
        // resolvePendingEntry can reuse the SAME approved card object when
        // it later reaches the chat timeline, not for Cockpit to render.
        workflowStatus: data.confirm_token ? "preparing" : undefined,
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

      if (isDebt) {
        // Unchanged — out of scope for this UX change (debt-send has its own
        // separate flow, no invoice-preview/Cockpit-status concept applies).
        const text = !data.ok
          ? `ยืนยันไม่สำเร็จ: ${data.error ?? "ไม่ทราบสาเหตุ"}`
          : "✅ ส่งแจ้งยอดค้างชำระให้ลูกค้าแล้ว"
        pushEntry({ id: nextActionLogId(), role: "system", text })
        if (data.ok) await loadDetail(activeId)
        return
      }

      // UX Change (owner, 2026-07-17): AI Cockpit shows workflow status only
      // (Preparing/Confirmed/Sent, or the failure reached) — updates the
      // SAME entry in place rather than appending a new text bubble. The
      // Flex Card itself moves to the customer chat timeline, and only once
      // it was actually confirmed AND sent (never on a failure, so nothing
      // in the LINE-style timeline can misrepresent what really happened).
      const workflowStatus: ActionLogEntry["workflowStatus"] = !data.ok
        ? "confirm_failed"
        : data.line_send_error
        ? "send_failed"
        : "sent"
      const text = !data.ok
        ? `ยืนยันไม่สำเร็จ: ${data.error ?? "ไม่ทราบสาเหตุ"}`
        : data.line_send_error
        ? String(data.line_send_error)
        : ""
      setActionLog((log) => log.map((x) => x.id === entry.id ? { ...x, workflowStatus, text } : x))

      if (workflowStatus === "sent" && entry.flexPreview) {
        // Do NOT modify SendInvoiceToLINE or ConfirmInvoice — this reuses
        // the SAME flexPreview object already held client-side since
        // Preview (the backend's preview_token is single-use and already
        // consumed by now, but this object was always available here).
        pushEntry({ id: nextActionLogId(), role: "system", text: "", flexPreview: entry.flexPreview, showAsChatBubble: true })
      }
      if (data.ok) await loadDetail(activeId)
    } catch {
      setActionLog((log) => log.map((x) => x.id === entry.id ? { ...x, workflowStatus: "confirm_failed", text: "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้งครับ" } : x))
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
  const askAi = useCallback(async (question: string, companyName: string | null, lineUserId: string) => {
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
        // UX Change (owner, 2026-07-17): Cockpit shows workflow status only
        // — flexPreview/fullHtml above are kept on the entry purely so
        // resolvePendingEntry can reuse the SAME approved card object when
        // it later reaches the chat timeline, not for Cockpit to render.
        workflowStatus: data.confirm_token ? "preparing" : undefined,
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

  // Owner request 2026-07-18: invoices now go through the real, canonical
  // SendInvoiceToLINE pipe (gateway/actions.ts::sendInvoiceToLine, exposed
  // here as the Retry Send endpoint) — same status-ladder Cockpit UI and
  // chat-timeline bubble as the auto-send-after-confirm path, so a manual
  // (re)send looks identical to an automatic one. standalone_documents
  // (quotation/receipt/etc.) still has no invoice_items-equivalent table,
  // so it stays on the older /send-document route for now — deliberately
  // out of scope for this change (registry/intent-dictionary.json's
  // document.send entry records this split honestly, not silently).
  const sendDocument = useCallback(async (lineUserId: string, doc: { id: string; table: "invoices" | "standalone_documents"; invoice_no?: string; document_no?: string }) => {
    const label = doc.invoice_no ?? doc.document_no ?? ""
    setActionSending(true)
    pushEntry({ id: nextActionLogId(), role: "user", text: `📄 ส่งเอกสาร ${label}` })
    try {
      if (doc.table === "invoices") {
        const res = await fetch(`/api/admin/invoices/${doc.id}/send`, { method: "POST" })
        const data = await res.json()
        const workflowStatus: ActionLogEntry["workflowStatus"] = data.ok ? "sent" : "send_failed"
        pushEntry({ id: nextActionLogId(), role: "system", text: data.ok ? "" : String(data.error ?? "ไม่ทราบสาเหตุ"), workflowStatus })
        if (data.ok && data.result?.flex_preview) {
          pushEntry({ id: nextActionLogId(), role: "system", text: "", flexPreview: data.result.flex_preview, showAsChatBubble: true })
        }
      } else {
        const res = await fetch(`/api/admin/line-customers/${lineUserId}/send-document`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table: doc.table, documentId: doc.id }),
        })
        const data = await res.json()
        pushEntry({ id: nextActionLogId(), role: "system", text: data.ok ? `✅ ส่ง ${label} ให้ลูกค้าแล้ว` : `ส่งไม่สำเร็จ: ${data.error ?? "ไม่ทราบสาเหตุ"}` })
      }
    } catch {
      pushEntry({ id: nextActionLogId(), role: "system", text: "ส่งไม่สำเร็จ ลองใหม่อีกครั้งครับ" })
    } finally {
      setActionSending(false)
    }
  }, [pushEntry])

  // TASK-002 Human Reality Chat UX (owner, 2026-07-17), items 5+6 — unread
  // and sort-to-top. Client-only state (no DB field for "read/unread"
  // exists, per the owner's own "ไม่แตะ Database" scope): a room is unread
  // if its last_message_at is newer than the last time this browser opened
  // it, tracked in localStorage. "Pin"/"Priority" (also requested) are
  // NOT implemented in this pass — no trigger UI was specified for them and
  // building one would be guessing the interaction, not fixing anything;
  // flagged honestly rather than faked.
  const sortedRelationships = [...relationships].sort((a, b) => {
    const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
    const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
    return bt - at
  })

  const listItems: ListColumnItem[] = sortedRelationships.map((r) => {
    const lastViewed = typeof window !== "undefined" ? localStorage.getItem(`dnaos.lastViewed.${r.relationship_id}`) : null
    const unread = !!r.last_message_at && (!lastViewed || new Date(r.last_message_at).getTime() > new Date(lastViewed).getTime())
    return {
      id: r.relationship_id,
      title: r.name,
      subtitle: r.last_message ?? (r.line_user_ids.length ? "" : "ยังไม่มีข้อความ LINE"),
      timestamp: r.last_message_at ? fmtTime(r.last_message_at) : "",
      avatarUrl: r.line_picture ?? undefined,
      highlighted: r.has_pending_draft,
      unread,
      // Not an exact unread COUNT — the sidebar only ever loads one summary
      // row per relationship (last_message/last_message_at), not full
      // per-room message history, so there's no real number to show here
      // without a much heavier fetch. A boolean dot (via `unread`, rendered
      // bold + emerald timestamp by ListColumn) is what's honestly available.
    }
  })

  const activeRelationship = relationships.find((r) => r.relationship_id === activeId) ?? null
  const primaryLineUserId = detail?.primaryLineUserId ?? null
  const pendingDrafts = detail?.drafts.filter((d) => d.status === "pending_review") ?? []
  const [contactSettingsOpen, setContactSettingsOpen] = useState(false)

  const companyName = activeRelationship?.name ?? null
  const lastLocation = [...(detail?.messages ?? [])].reverse().find((m) => m.raw_type === "location" && m.extracted?.latitude != null)

  // Owner request 2026-07-11 (Event Card Framework / Timeline module): one
  // merged, time-sorted feed — messages + business events + past documents —
  // replaces the old split rendering (raw message list + a separate
  // collapsed "รายละเอียดเพิ่มเติม" panel).
  // UX Change (owner, 2026-07-17): reverses the 2026-07-16 decision above —
  // the chat timeline is the human's primary workspace, Cockpit is only an
  // operational console. Only entries explicitly marked showAsChatBubble
  // (an invoice that was actually confirmed AND sent) merge in here — never
  // previews, never in-progress/failed states, so nothing here can be
  // mistaken for a message that wasn't really sent.
  const sentInvoiceEntries = useMemo(() => actionLog.filter((e) => e.showAsChatBubble), [actionLog])
  const feed = useMemo(() => buildFeed(detail, sentInvoiceEntries), [detail, sentInvoiceEntries])

  // TASK-002 item 4 (Human Reality Chat UX, owner 2026-07-17) — open a room
  // scrolled to the BOTTOM (latest message), not the top, matching every
  // real chat app. New items only auto-scroll if the user is already at the
  // bottom; otherwise show a "N new messages" pill instead of yanking their
  // scroll position while they're reading history.
  const feedScrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const prevFeedLengthRef = useRef(0)
  const [newMessageCount, setNewMessageCount] = useState(0)

  const scrollFeedToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = feedScrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    setNewMessageCount(0)
  }, [])

  // Room opened/switched — jump to bottom immediately, no animation (this
  // isn't "a new message arrived", it's "entering the room").
  useEffect(() => {
    if (!detailLoading && detail) {
      prevFeedLengthRef.current = feed.length
      requestAnimationFrame(() => scrollFeedToBottom("auto"))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, detailLoading])

  // Feed grew (new message/event/document arrived) — auto-scroll only if
  // already at the bottom; otherwise surface the "N new messages" pill.
  useEffect(() => {
    const grew = feed.length - prevFeedLengthRef.current
    if (grew > 0) {
      if (isAtBottomRef.current) {
        requestAnimationFrame(() => scrollFeedToBottom("smooth"))
      } else {
        setNewMessageCount((n) => n + grew)
      }
    }
    prevFeedLengthRef.current = feed.length
  }, [feed.length, scrollFeedToBottom])

  const handleFeedScroll = useCallback(() => {
    const el = feedScrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    isAtBottomRef.current = atBottom
    if (atBottom) setNewMessageCount(0)
  }, [])

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
        // TASK-002 Human Reality Chat UX item 1 (owner, 2026-07-17): image
        // bubbles capped narrower (45-60% of chat width) than text bubbles,
        // like every real chat app — a photo shouldn't dominate the screen.
        const bubbleWidth = m.raw_type === "image" ? "max-w-[55%]" : "max-w-[70%]"
        return (
          <div key={item.template_key} className={"flex " + (m.direction === "out" ? "justify-end" : "justify-start")}>
            <div className={bubbleWidth + " rounded-lg px-3 py-2 shadow-sm " + (m.direction === "out" ? "bg-[#a8e2a0]" : "bg-white border border-stone-200")}>
              {/* TASK-001 Restore Original Human Data (owner, 2026-07-17):
                  original content shown first, always — text placeholders
                  like "(ส่งรูปภาพ)" must never be the primary display, only a
                  rare fallback for the small window before this pass (older
                  messages) or a real fetch failure. AI/OCR/metadata are
                  background-only, never shown in place of the original. */}
              {m.raw_type === "image" && (
                m.media_url ? (
                  // Height auto, capped so a tall portrait photo can't push
                  // the rest of the conversation down (owner: "รูปแนวตั้งไม่ยืดยาว
                  // จนดันข้อความอื่นลงไป") — object-contain, never cropped/
                  // stretched. Click opens fullscreen (owner: "กดแล้วเปิดเต็มจอ").
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.media_url}
                    alt="รูปภาพต้นฉบับจากลูกค้า"
                    onClick={() => setLightboxUrl(m.media_url!)}
                    className="max-w-full max-h-[320px] w-auto rounded-lg mb-1 cursor-zoom-in object-contain"
                  />
                ) : (
                  <p className="text-xs text-stone-400 italic">(รูปภาพ — ดึงต้นฉบับไม่สำเร็จ)</p>
                )
              )}
              {m.raw_type === "file" && (
                m.media_url ? (
                  // PDF Preview Card (owner: "PDF ใช้ Preview Card") — a real
                  // bordered card, not a bare link.
                  <a
                    href={m.media_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 mb-1 hover:bg-stone-100 transition"
                  >
                    <div className="w-8 h-8 rounded bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0">
                      <FileText size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-stone-800 truncate">{m.raw_text || "เอกสาร PDF"}</p>
                      <p className="text-[10px] text-stone-400">เปิดต้นฉบับ</p>
                    </div>
                  </a>
                ) : (
                  <p className="text-xs text-stone-400 italic">(ไฟล์ {m.raw_text} — ดึงต้นฉบับไม่สำเร็จ)</p>
                )
              )}
              {m.raw_type === "audio" && (
                m.media_url ? (
                  <audio controls src={m.media_url} className="max-w-full mb-1" />
                ) : (
                  <p className="text-xs text-stone-400 italic">(ข้อความเสียง — ดึงต้นฉบับไม่สำเร็จ)</p>
                )
              )}
              {m.raw_type === "flex" && m.extracted?.flex ? (
                // Owner request 2026-07-24: the admin sees the EXACT card the
                // customer received — real Flex JSON, real template, real
                // numbers — never a paraphrased text summary of it.
                <FlexPreview flex={m.extracted.flex} />
              ) : (
                m.raw_type !== "image" && m.raw_type !== "file" && m.raw_type !== "audio" && (
                  <p className="text-xs text-stone-800 whitespace-pre-line">{m.raw_text ?? `[${m.raw_type}]`}</p>
                )
              )}
              <p className="text-[9px] text-stone-500 mt-1 text-right">{fmtTime(m.created_at)}</p>
            </div>
          </div>
        )
      }
      case "receipt.timeline-card": {
        if (!("receipt" in item)) return null
        const r = item.receipt
        const selected = state.selection?.kind === item.source_type && state.selection.id === item.id
        // Owner request 2026-07-17: "การ์ดใช้ขนาดเดียวกับรูปภาพที่มีอยู่ตอนนี้"
        // — same max-w-[55%] as the image bubble it replaces, just richer
        // content (Document Card) instead of a bare photo.
        return (
          <div key={item.template_key} className="flex justify-start">
            <button
              onClick={() => dispatch({ type: "SELECT_ITEM", selection: selected ? null : { kind: item.source_type, id: item.id } })}
              className={"max-w-[55%] text-left rounded-lg overflow-hidden shadow-sm border transition " + (selected ? "border-emerald-400 ring-1 ring-emerald-200" : "border-stone-200 hover:border-stone-300")}
            >
              {r.media_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.media_url} alt="เอกสารต้นฉบับ" className="w-full max-h-40 object-cover" onClick={(e) => { e.stopPropagation(); setLightboxUrl(r.media_url) }} />
              )}
              <div className="bg-white px-3 py-2">
                <p className="text-xs font-semibold text-stone-800">{DOCUMENT_TYPE_LABEL[r.document_type] ?? "📄 เอกสารอื่นๆ"}</p>
                {r.vendor_name && <p className="text-[11px] text-stone-600 mt-1">บริษัท: {r.vendor_name}</p>}
                {r.sender_name && <p className="text-[11px] text-stone-500">ผู้ส่ง: {r.sender_name}</p>}
                {r.document_date && <p className="text-[11px] text-stone-500">วันที่: {r.document_date}</p>}
                {r.amount != null && <p className="text-xs font-semibold text-emerald-700 mt-1">{r.amount.toLocaleString("th-TH")} บาท</p>}
                <p className="text-[10px] mt-1.5 flex items-center gap-1">
                  <span className={"px-1.5 py-0.5 rounded-full " + (r.status === "confirmed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                    {r.status === "confirmed" ? "ยืนยันแล้ว" : "AI อ่านแล้ว · รอยืนยัน"}
                  </span>
                </p>
                {r.error_th && <p className="text-[10px] text-rose-500 mt-1">{r.error_th}</p>}
              </div>
            </button>
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
        // UX Change (owner, 2026-07-17): re-enables this template id for the
        // customer timeline (it existed already — see resolvePresentationTemplate,
        // was only unused here since 2026-07-16). Only entries with
        // showAsChatBubble reach this via the sentInvoiceEntries filter above,
        // so this only ever renders an invoice that was actually confirmed
        // AND sent — same visual container as a real outbound LINE message
        // bubble (m.direction === "out" case above), so the timeline reads
        // exactly like a LINE conversation where this was just sent.
        if (!("entry" in item)) return null
        const e = item.entry
        if (!e.flexPreview) return null
        return (
          <div key={item.template_key} className="flex justify-end">
            <div className="max-w-[70%] rounded-lg px-2 py-2 shadow-sm bg-[#a8e2a0]">
              <FlexPreview flex={e.flexPreview} />
              <p className="text-[9px] text-stone-600 mt-1 text-right">{fmtTime(e.timestamp)}</p>
            </div>
          </div>
        )
      }
    }
  }

  // UX Change (owner, 2026-07-17): AI Cockpit is an operational console —
  // status only, never the Flex Card / full HTML preview (those moved to
  // the customer chat timeline, see "action-result.timeline-card" above and
  // sentInvoiceEntries). Entries already surfaced as a chat bubble render
  // nothing here at all, so the card is never shown twice.
  //
  // Builds the ✓/❌ status ladder for one entry: always "Preparing", then
  // "Confirmed"/"Confirm failed" once resolved, then "Sent"/"Send failed"
  // only once Confirm actually succeeded — matches ConfirmInvoice/
  // SendInvoiceToLINE's real sequencing (a failed Confirm never reaches
  // Send, same as the backend itself enforces).
  function workflowSteps(status: NonNullable<ActionLogEntry["workflowStatus"]>, reason: string) {
    const steps: { icon: "✓" | "❌"; label: string; reason?: string }[] = [{ icon: "✓", label: "Preparing" }];
    if (status === "preparing") return steps;
    if (status === "confirm_failed") { steps.push({ icon: "❌", label: "Confirm failed", reason }); return steps; }
    steps.push({ icon: "✓", label: "Confirmed" });
    if (status === "confirmed") return steps;
    steps.push(status === "send_failed" ? { icon: "❌", label: "Send failed", reason } : { icon: "✓", label: "Sent" });
    return steps;
  }

  const renderActionEntry = (entry: ActionLogEntry) => {
    if (entry.showAsChatBubble) return null

    return (
    <div key={entry.id} className={"flex " + (entry.role === "user" ? "justify-end" : "justify-start")}>
      <div className={"max-w-[85%] rounded-lg px-3 py-2 shadow-sm " + (entry.role === "user" ? "bg-stone-800 text-white" : "bg-amber-50 border border-amber-200")}>
        {entry.text && !entry.workflowStatus && (
          <p className={"text-xs whitespace-pre-line " + (entry.role === "user" ? "text-white" : "text-stone-800")}>{entry.text}</p>
        )}

        {entry.workflowStatus && (
          <div className="space-y-0.5">
            {workflowSteps(entry.workflowStatus, entry.text).map((step, i) => (
              <div key={i}>
                <p className={"text-[11px] flex items-center gap-1 " + (step.icon === "❌" ? "text-rose-600" : "text-stone-700")}>
                  <span>{step.icon}</span> {step.label}
                </p>
                {step.reason && <p className="text-[10px] text-rose-500 pl-4">Reason: {step.reason}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Regression fix (owner, 2026-07-18): entries still on the OLDER
            confirm pattern (confirmToken for non-invoice document types,
            debtSendPending for the debt-reminder card) never got a
            workflowStatus/chat-timeline-bubble migration — they have no
            other way to show what's about to be sent. Only render here
            while awaiting confirmation; once resolved, the entry either
            becomes a chat-timeline bubble (invoice path) or is superseded
            by the next pushEntry (debt/older document path). Gated on
            !entry.workflowStatus so this never re-appears for the invoice
            flow, which intentionally shows nothing here per the earlier
            UX Change. */}
        {entry.flexPreview && !entry.workflowStatus && (entry.confirmToken || entry.debtSendPending) && !entry.confirmResolved && (
          <div className="mt-2">
            <FlexPreview flex={entry.flexPreview} />
          </div>
        )}

        {entry.fullHtml && (
          <button
            onClick={() => setCockpitHtmlPreview(entry.fullHtml!)}
            className="mt-2 text-[10px] px-2 py-1 rounded-lg border border-stone-300 text-stone-600 bg-white hover:bg-stone-50"
          >
            ดูเอกสารเต็ม
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
      onClick: () => setCockpitOpen(true),
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
      listCollapsible
    >
      {!activeRelationship ? (
        <div className="flex items-center justify-center h-full text-sm text-stone-400">
          เลือกลูกค้าทางซ้ายเพื่อเปิด Workspace
        </div>
      ) : (
        <div className="flex h-full">
          <div className="flex flex-col h-full flex-1 min-w-0">
            {/* Header — Navigation redesign (owner, 2026-07-16, final form):
                AppHeader owns Back/Home/title (system's responsibility);
                everything below is this module's own actions (contact
                avatar/name, automation status, debt + send). */}
            <AppHeader
              title="ข้อความ"
              actions={
                <>
                  {/* Contact Settings Popup (owner, 2026-07-18): "กดที่รูป
                      โปรไฟล์หรือปุ่มตั้งค่า" — click the avatar to open the
                      floating modal, no page navigation, per the owner's own
                      spec. Only enabled when there's a real LINE contact to
                      configure. */}
                  <button
                    onClick={() => primaryLineUserId && setContactSettingsOpen(true)}
                    disabled={!primaryLineUserId}
                    title={primaryLineUserId ? "ตั้งค่า Contact" : "ยังไม่มีช่องทาง LINE สำหรับลูกค้ารายนี้"}
                    className="flex-shrink-0 disabled:cursor-default"
                  >
                    {activeRelationship.line_picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={activeRelationship.line_picture} alt="" className="w-9 h-9 rounded-full object-cover bg-stone-100 hover:ring-2 hover:ring-stone-300 transition" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-stone-200 hover:ring-2 hover:ring-stone-300 transition" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-semibold text-stone-800 truncate">{activeRelationship.name}</p>
                    {activeRelationship.unmatched ? (
                      <button
                        onClick={() => matchUnmatchedContact(activeRelationship.relationship_id, activeRelationship.name)}
                        className="text-[11px] font-semibold text-amber-700 hover:underline"
                      >
                        ⚠ ยังไม่จับคู่บริษัท — กดเพื่อจับคู่/สร้างใหม่
                      </button>
                    ) : (
                      <Link href={`/admin/partners/${activeRelationship.relationship_id}`} className="text-[11px] text-emerald-600 hover:underline">
                        ดูรายละเอียดเพิ่มเติม →
                      </Link>
                    )}
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
                </>
              }
            />

            {contactSettingsOpen && primaryLineUserId && (
              <ContactSettingsModal lineUserId={primaryLineUserId} onClose={() => setContactSettingsOpen(false)} />
            )}

            {detail?.takeover?.mode === "human_takeover" && (
              <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 flex-shrink-0">
                <div className="text-xs font-bold text-rose-700">มนุษย์รับช่วงต่อแล้ว — AI หยุดตอบอัตโนมัติ</div>
                <div className="text-[11px] text-rose-600 mt-0.5">เหตุผล: {detail.takeover.reason ?? "ข้อความมีข้อขัดแย้งกับระบบ"}</div>
              </div>
            )}

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
            <div className="flex-1 relative min-h-0">
              <div ref={feedScrollRef} onScroll={handleFeedScroll} className="h-full overflow-y-auto p-3 space-y-2 bg-[#e5ece5]">
                {detailLoading && <div className="text-xs text-stone-400 text-center py-8 animate-pulse">กำลังโหลด...</div>}
                {!detailLoading && feed.length === 0 && (
                  <div className="text-xs text-stone-400 text-center py-8">ยังไม่มีข้อความหรือประวัติสำหรับลูกค้ารายนี้</div>
                )}
                {!detailLoading && feed.map(renderTimelineCard)}
              </div>
              {/* TASK-002 item 4 — never yank scroll away from someone reading
                  history; this pill is the explicit opt-in to jump down. */}
              {newMessageCount > 0 && (
                <button
                  onClick={() => scrollFeedToBottom("smooth")}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-stone-800 text-white text-[11px] font-semibold shadow-lg hover:bg-stone-700 transition"
                >
                  ↓ {newMessageCount} ข้อความใหม่
                </button>
              )}
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

          {/* Cockpit Panel (owner request 2026-07-16) — Copilot-style right
              drawer for AI/tool interaction, separate from the customer
              timeline on the left. Slides out on the "ถาม AI" button, stays
              on this one screen (no tab switch). Everything that used to
              write into the shared message feed (runCommand/askAi results,
              confirm/cancel, document previews) now lives here only. */}
          {cockpitOpen && (
            <div className="w-[400px] flex-shrink-0 border-l border-stone-200 bg-white flex flex-col h-full">
              <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Bot size={16} className="text-stone-500" />
                  <span className="text-sm font-semibold text-stone-800">AI Cockpit</span>
                </div>
                <button onClick={() => setCockpitOpen(false)} className="text-stone-400 hover:text-stone-600">
                  <X size={16} />
                </button>
              </div>

              {cockpitHtmlPreview ? (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-stone-100 flex-shrink-0">
                    <span className="text-[11px] font-medium text-stone-500">ตัวอย่างเอกสาร</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openHtmlDocument(cockpitHtmlPreview)}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50"
                      >
                        <ExternalLink size={11} /> เปิดแท็บใหม่
                      </button>
                      <button
                        onClick={() => setCockpitHtmlPreview(null)}
                        className="text-[10px] px-2 py-1 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50"
                      >
                        ปิดตัวอย่าง
                      </button>
                    </div>
                  </div>
                  <iframe
                    title="เอกสารเต็ม"
                    srcDoc={cockpitHtmlPreview}
                    className="flex-1 w-full border-0"
                  />
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {actionLog.length === 0 && (
                    <div className="text-xs text-stone-400 text-center py-8">
                      สั่งงานหรือถามคำถามด้านล่าง — ผลลัพธ์จาก AI จะแสดงตรงนี้เท่านั้น ไม่ปนกับข้อความลูกค้า
                    </div>
                  )}
                  {actionLog.map(renderActionEntry)}
                </div>
              )}

              <div className="border-t border-stone-200 flex-shrink-0 p-2.5 flex gap-2">
                <input
                  value={aiAskText}
                  onChange={(e) => setAiAskText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && aiAskText.trim() && primaryLineUserId) { askAi(aiAskText.trim(), companyName, primaryLineUserId); setCockpitHtmlPreview(null) } }}
                  placeholder={companyName ? `สั่งงานหรือถามเกี่ยวกับ ${companyName}...` : "ยังไม่มีช่องทาง LINE สำหรับลูกค้ารายนี้"}
                  disabled={!primaryLineUserId}
                  className="flex-1 text-xs border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400 disabled:bg-stone-50 disabled:text-stone-400"
                />
                <button
                  onClick={() => { if (aiAskText.trim() && primaryLineUserId) { askAi(aiAskText.trim(), companyName, primaryLineUserId); setCockpitHtmlPreview(null) } }}
                  disabled={!aiAskText.trim() || !primaryLineUserId}
                  className="px-3 py-2 rounded-lg bg-stone-800 text-white text-xs font-semibold disabled:opacity-40 hover:bg-stone-700 transition"
                >
                  ถาม
                </button>
              </div>
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

      {/* TASK-002 item 1 — fullscreen image lightbox (owner: "กดแล้วเปิดเต็มจอ") */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl leading-none"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUrl} alt="รูปภาพเต็มจอ" className="max-w-[92vw] max-h-[92vh] object-contain" />
        </div>
      )}
    </AppShell>
  )
}
