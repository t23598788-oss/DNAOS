// Owner request 2026-07-11 (Event Card Framework): merges every source of
// activity for a customer relationship — messages, Action Bar results,
// business events, past documents — into ONE chronological feed, so the
// chat area is the single place to see everything instead of messages + a
// separate collapsed panel for events/documents.
//
// Architecture Migration Phase 1 (2026-07-13, owner-directed): the workspace
// identity is now relationship_id (= companies.id), not line_user_id. LINE
// is one communication channel a relationship may have zero, one, or
// several accounts of — not the root identity. Business logic (feed
// merging, template resolution, dedupe/sort) is unchanged from the LINE-
// contact-keyed version; only the identity shape changed.

import type { InspectorField } from "@/presentation/panels/Inspector"
import {
  resolvePresentationTemplate,
  uniqueResolvedTemplates,
  type PresentationTemplateId,
} from "@/engines/presentation/template-resolver"
import { linkDocumentsToEvents } from "@/engines/presentation/timeline-engine"

// Owner request 2026-07-17 — the 7 document types AI classifies a photo
// into. Kept here, not duplicated in the edge function's ocr-classify.ts
// (that file owns the classification VALUES; this owns the Thai LABELS
// shown to a human, a UI concern, not a classification concern).
// Real gap found live 2026-07-27: this map only ever covered 7 of the 14
// real DOCUMENT_TYPES ocr-classify.ts actually classifies against — a real
// payment_advice from a real customer (บจก. เคที คอนสตรัคชั่น 1988,
// TRBS260723374064276, correctly classified with every field read) showed
// up in the admin chat card as "📄 เอกสารอื่นๆ" (the fallback), making it
// look like classification had failed when it hadn't — the backend was
// right, the label lookup just never covered every real type.
export const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  receipt: "🧾 ใบเสร็จรับเงิน",
  tax_invoice: "🧾 ใบกำกับภาษี",
  invoice: "🧾 ใบแจ้งหนี้",
  fuel_bill: "⛽ บิลน้ำมัน",
  toll_bill: "🛣️ ค่าทางด่วน",
  weight_slip: "⚖️ ใบชั่ง",
  delivery_order: "🚚 ใบส่งของ",
  transfer_slip: "💸 สลิปโอนเงิน",
  payment_advice: "💸 หลักฐานการโอนเงิน",
  bank_statement: "🏦 รายการเดินบัญชี",
  product_photo: "📦 รูปสินค้า",
  site_photo: "📍 รูปหน้างาน",
  government_document: "🪪 เอกสารราชการ",
  other: "📄 เอกสารอื่นๆ",
}

export interface Relationship {
  relationship_id: string
  name: string
  tax_id: string | null
  phone: string | null
  line_user_ids: string[]
  line_picture: string | null
  message_count: number
  last_message_at: string | null
  last_message: string | null
  debt: { total_outstanding: number; collection_state: string; days_overdue: number } | null
  has_pending_draft: boolean
  unmatched: boolean
}

export interface Message {
  id: string
  line_user_id?: string
  raw_type: string
  raw_text: string | null
  direction: "in" | "out"
  // Owner request 2026-07-24: "อยากให้หน้าจอควบคุมขึ้นแบบเดียวกันกับฝั่ง LINE
  // ของลูกค้า...การ์ด Template เดียวกัน ข้อมูลเดียวกัน" — for an outbound Flex
  // message (raw_type "flex"), `flex` holds the EXACT JSON object actually
  // pushed to LINE (registry/communication.ts's sendLineMessage()), so
  // components/ui-kit/FlexPreview.tsx can render the identical card the
  // customer saw — not a separate internal summary of it.
  extracted: { latitude?: number; longitude?: number; address?: string; flex?: object } | null
  // Human Reality Timeline (owner, 2026-07-16/17) — the real original image,
  // signed fresh per request (see app/api/admin/relationships/[relationshipId]/route.ts).
  // null for non-image messages, or an image whose content wasn't fetched.
  media_url?: string | null
  created_at: string
}

export interface DocRow {
  id: string
  invoice_no?: string
  document_no?: string
  invoice_status?: string
  document_type?: string
  total_amount: number
  invoice_date?: string
  document_date?: string
  business_event_id?: string | null
  template_key?: string
  presentation_template?: PresentationTemplateId
  presentation_type?: PresentationTemplateId
  table: "invoices" | "standalone_documents"
}

export interface BizEvent {
  id: string
  event_code: string
  event_type: string | null
  material_text: string | null
  quantity: number | null
  quantity_unit: string | null
  destination: string | null
  schedule_text: string | null
  contact_name: string | null
  contact_phone: string | null
  status: string
  confidence: number
  created_at: string
}

// Auto-classified receipt/bill photos (owner, 2026-07-17) — one row per
// image AI has read and classified (registry/migrations/20260717000002).
// Real fields only: no AI-invented data beyond what the model actually
// returned, no fabricated defaults.
export interface Receipt {
  id: string
  line_event_id: string
  media_url: string | null // signed fresh per request, same pattern as Message.media_url
  document_type: "receipt" | "tax_invoice" | "invoice" | "fuel_bill" | "transfer_slip" | "weight_slip" | "other"
  vendor_name: string | null
  amount: number | null
  document_date: string | null
  confidence: number | null
  status: "ai_read" | "confirmed" | "rejected"
  error_th: string | null
  sender_name: string | null // from line_events.line_name via join — "ผู้ส่ง" on the card
  created_at: string
}

export interface Draft {
  id: string
  line_user_id?: string
  reason: string
  proposed_text: string
  status: string
  created_at: string
}

export interface RelationshipDetail {
  relationshipId: string
  company: { id: string; name: string; tax_id: string | null; phone: string | null } | null
  unmatched: boolean
  lineUserIds: string[]
  primaryLineUserId: string | null
  messages: Message[]
  documents: DocRow[]
  events: BizEvent[]
  receipts: Receipt[]
  unlinkedCount: number
  drafts: Draft[]
  // Business Workspace V1: the detail endpoint's own debt block (fresh
  // getCurrentDebt + collection_state) — preferred over the list snapshot,
  // which the UI keeps as fallback.
  debt?: { total_outstanding: number; collection_state: string | null; days_overdue: number } | null
  // Business Workspace V1 (owner, 2026-09-18): per-relationship finance
  // summary computed by the detail API from the same real rows it already
  // read (open invoices/standalone_documents + partner_payable_requests).
  // null when the relationship has no company yet (unmatched) — the UI
  // renders "—" honestly, never a guessed number.
  finance?: { revenue_total: number; revenue_doc_count: number; expense_total: number; expense_request_count: number } | null
  takeover?: { line_user_id?: string; mode: "ai" | "human_takeover"; reason: string | null; created_at: string; updated_at: string } | null
}

export interface ActionLogEntry {
  id: string
  role: "user" | "system"
  text: string
  timestamp: string
  confirmToken?: string
  confirmAction?: string
  confirmResolved?: "confirmed" | "cancelled"
  flexPreview?: object
  // Owner request 2026-07-11: "เอกสารอีกฉบับนึง...เรียงหัวข้อไว้แถบด้านบนเป็น
  // คอลัมน์" — the full tabular document (engines/documents/template.ts's
  // HTML render). Presentation Architecture Phase 3: opens in a new tab via
  // openHtmlDocument() in page.tsx, not a second in-page renderer.
  fullHtml?: string
  // debt.send preview flow doesn't go through gateway/actions.ts's Rule-72
  // token store (no DB row exists yet to protect) — confirming just re-POSTs
  // send-debt with mode:"execute" for this relationship's primary LINE thread.
  debtSendPending?: boolean
  // UX Change (owner, 2026-07-17): presentation ownership split — AI Cockpit
  // is an operational console (status only), the customer chat timeline
  // owns the actual Flex Card. workflowStatus drives Cockpit's compact
  // status ladder (Preparing/Confirmed/Sent or the failure it stopped at).
  // No backend change — derived entirely from the same /api/chat/confirm
  // response fields (`ok`, `line_send_error`) already returned today.
  workflowStatus?: "preparing" | "confirmed" | "sent" | "confirm_failed" | "send_failed"
  // When true, buildFeed() includes this entry in the customer-facing
  // timeline (via source_kind "action_log" → "action-result.timeline-card")
  // instead of — or in addition to — the Cockpit log. Set only once a
  // SendInvoiceToLINE actually succeeded, reusing the SAME flexPreview
  // object the human already approved in Preview (still held client-side —
  // the backend's preview_token is single-use and already consumed by
  // then, but this object was never backend-only).
  showAsChatBubble?: boolean
}

export interface RuntimeOwnershipMap {
  businessEvent: "business_events"
  presentationTemplate: "engines/presentation/template-resolver"
  timelineCard: "app/admin/relationships/feed"
  documentViewer: "explicit-user-open"
  inspector: "app/admin/relationships/workspace-state"
  actionBar: "app/admin/relationships/page"
  preview: "app/admin/relationships/workspace-state"
}

export const RUNTIME_OWNERSHIP: RuntimeOwnershipMap = {
  businessEvent: "business_events",
  presentationTemplate: "engines/presentation/template-resolver",
  timelineCard: "app/admin/relationships/feed",
  documentViewer: "explicit-user-open",
  inspector: "app/admin/relationships/workspace-state",
  actionBar: "app/admin/relationships/page",
  preview: "app/admin/relationships/workspace-state",
}

export type FeedItem =
  | { source_type: "message"; id: string; timestamp: string; template_id: PresentationTemplateId; template_key: string; presentation_template: PresentationTemplateId; presentation_type: PresentationTemplateId; message: Message }
  | { source_type: "action_log"; id: string; timestamp: string; template_id: PresentationTemplateId; template_key: string; presentation_template: PresentationTemplateId; presentation_type: PresentationTemplateId; entry: ActionLogEntry }
  | { source_type: "business_event"; id: string; timestamp: string; template_id: PresentationTemplateId; template_key: string; presentation_template: PresentationTemplateId; presentation_type: PresentationTemplateId; event: BizEvent; documents: DocRow[] }
  | { source_type: "document"; id: string; timestamp: string; template_id: PresentationTemplateId; template_key: string; presentation_template: PresentationTemplateId; presentation_type: PresentationTemplateId; doc: DocRow }
  | { source_type: "receipt"; id: string; timestamp: string; template_id: PresentationTemplateId; template_key: string; presentation_template: PresentationTemplateId; presentation_type: PresentationTemplateId; receipt: Receipt }

function presentation<T extends { template_id: PresentationTemplateId }>(template: T) {
  return {
    ...template,
    presentation_template: template.template_id,
    presentation_type: template.template_id,
  }
}

export function buildFeed(detail: RelationshipDetail | null, actionLog: ActionLogEntry[]): FeedItem[] {
  const items: FeedItem[] = []
  const { documentsByEventId, standaloneDocuments } = linkDocumentsToEvents(detail?.documents ?? [])

  // Owner request 2026-07-17: an image AI has classified as a receipt/bill
  // shows the Document Card INSTEAD of the plain image bubble ("เปลี่ยนจาก
  // แสดงรูปอย่างเดียว เป็นการ์ดสรุปข้อมูลแทน") — same timeline slot, richer
  // content. The original image is still one click away via the card
  // itself, never discarded (Human Reality Timeline).
  const receiptByLineEventId = new Map((detail?.receipts ?? []).map((r) => [r.line_event_id, r]))

  for (const m of detail?.messages ?? []) {
    const receipt = receiptByLineEventId.get(m.id)
    if (receipt) {
      const template = resolvePresentationTemplate({ source_kind: "receipt", source_id: receipt.id })
      items.push({ source_type: "receipt", id: `receipt-${receipt.id}`, timestamp: m.created_at, ...presentation(template), receipt })
      continue
    }
    const template = resolvePresentationTemplate({ source_kind: "message", source_id: m.id })
    items.push({ source_type: "message", id: `msg-${m.id}`, timestamp: m.created_at, ...presentation(template), message: m })
  }
  for (const e of actionLog) {
    const template = resolvePresentationTemplate({ source_kind: "action_log", source_id: e.id })
    items.push({ source_type: "action_log", id: `log-${e.id}`, timestamp: e.timestamp, ...presentation(template), entry: e })
  }
  for (const ev of detail?.events ?? []) {
    const template = resolvePresentationTemplate({ source_kind: "business_event", source_id: ev.id })
    items.push({ source_type: "business_event", id: `ev-${ev.id}`, timestamp: ev.created_at, ...presentation(template), event: ev, documents: documentsByEventId.get(ev.id) ?? [] })
  }
  for (const d of standaloneDocuments) {
    const template = resolvePresentationTemplate({ source_kind: "document", source_id: d.id })
    items.push({ source_type: "document", id: `doc-${d.id}`, timestamp: d.invoice_date ?? d.document_date ?? "1970-01-01", ...presentation(template), doc: d })
  }
  return uniqueResolvedTemplates(items).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
}

// Owner request 2026-07-11: "ทุกสูตรค่าปรับ" — break the debt figure down
// where the underlying data actually has real components to show.
// debt_snapshots only stores the already-combined total_outstanding (no
// principal/fee/interest split persisted there) — this surfaces the real
// rate configuration applied (5% fee, 25%/yr interest, same constants
// cognitive/executor/index.ts's buildDebtItems() uses for document.create)
// rather than fabricating an exact split DNA OS doesn't actually have.
export function buildInspectorFields(item: FeedItem): { title: string; fields: InspectorField[] } {
  switch (item.presentation_template) {
    case "business-event.timeline-card": {
      if (!("event" in item)) return { title: "เหตุการณ์", fields: [] }
      const ev = item.event
      return {
        title: `Event ${ev.event_code}`,
        fields: [
          { label: "ประเภท", value: ev.event_type },
          { label: "วัสดุ", value: ev.material_text },
          { label: "จำนวน", value: ev.quantity ? `${ev.quantity} ${ev.quantity_unit ?? ""}` : null },
          { label: "ปลายทาง", value: ev.destination },
          { label: "กำหนดส่ง", value: ev.schedule_text },
          { label: "ผู้ติดต่อ", value: ev.contact_name },
          { label: "เบอร์โทร", value: ev.contact_phone },
          { label: "สถานะ", value: ev.status },
          { label: "ความมั่นใจ", value: `${Math.round(ev.confidence * 100)}%` },
        ],
      }
    }
    case "document-artifact.timeline-card": {
      if (!("doc" in item)) return { title: "เอกสาร", fields: [] }
      const d = item.doc
      return {
        title: d.invoice_no ?? d.document_no ?? "เอกสาร",
        fields: [
          { label: "ประเภท", value: d.invoice_status ?? d.document_type ?? null },
          { label: "ยอดรวม", value: d.total_amount.toLocaleString("th-TH") + " บาท" },
          { label: "วันที่", value: d.invoice_date ?? d.document_date ?? null },
          { label: "ตาราง", value: d.table },
        ],
      }
    }
    case "receipt.timeline-card": {
      if (!("receipt" in item)) return { title: "เอกสาร", fields: [] }
      const r = item.receipt
      return {
        title: DOCUMENT_TYPE_LABEL[r.document_type] ?? "เอกสาร",
        fields: [
          { label: "บริษัท/ร้านค้า", value: r.vendor_name },
          { label: "ผู้ส่ง", value: r.sender_name },
          { label: "วันที่", value: r.document_date },
          { label: "ยอดเงิน", value: r.amount != null ? r.amount.toLocaleString("th-TH") + " บาท" : null },
          { label: "สถานะ", value: r.status === "confirmed" ? "ยืนยันแล้ว" : r.status === "rejected" ? "ปฏิเสธแล้ว" : "AI อ่านแล้ว รอยืนยัน" },
          { label: "ความมั่นใจ AI", value: r.confidence != null ? `${Math.round(r.confidence * 100)}%` : null },
        ],
      }
    }
    case "action-result.timeline-card": {
      if (!("entry" in item)) return { title: "รายการ", fields: [] }
      const e = item.entry
      const isDebt = Boolean(e.debtSendPending) || /ค้างชำระ/.test(e.text)
      const fields: InspectorField[] = [{ label: "ข้อความ", value: e.text }]
      if (isDebt) {
        fields.push(
          { label: "ค่าธรรมเนียมล่าช้า", value: "5% ของเงินต้น" },
          { label: "ดอกเบี้ย", value: "25% ต่อปี (คิดตามจำนวนวันผิดนัด)" },
          { label: "หมายเหตุ", value: "ยอดรวมคำนวณจากยอดค้างสุทธิใน debt_snapshots" },
        )
      }
      return { title: "รายการ", fields }
    }
    default:
      if (!("message" in item)) return { title: "ข้อความ", fields: [] }
      return { title: "ข้อความ", fields: [{ label: "เนื้อหา", value: item.message.raw_text }] }
  }
}
