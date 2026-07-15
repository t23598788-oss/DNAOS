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

import type { InspectorField } from "@/components/ui-kit"
import {
  resolvePresentationTemplate,
  uniqueResolvedTemplates,
  type PresentationTemplateId,
} from "@/engines/presentation/template-resolver"
import { linkDocumentsToEvents } from "@/engines/presentation/timeline-engine"

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
}

export interface Message {
  id: string
  line_user_id?: string
  raw_type: string
  raw_text: string | null
  direction: "in" | "out"
  extracted: { latitude?: number; longitude?: number; address?: string } | null
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
  company: { id: string; name: string; tax_id: string | null; phone: string | null }
  lineUserIds: string[]
  primaryLineUserId: string | null
  messages: Message[]
  documents: DocRow[]
  events: BizEvent[]
  unlinkedCount: number
  drafts: Draft[]
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

  for (const m of detail?.messages ?? []) {
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
