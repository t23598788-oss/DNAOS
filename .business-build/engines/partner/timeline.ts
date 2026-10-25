/**
 * Partner Timeline Engine
 *
 * รวม documents + business_events ของ partner คนเดียวให้เป็น timeline เรียงตามวันที่
 * Pure function — รับข้อมูลดิบจาก DB มาแปลง ไม่เรียก DB เอง
 */

import type { PartnerTimelineEntry, PartnerSummary } from "@/core/shared/types";
import { resolvePresentationTemplate, uniqueResolvedTemplates } from "@/engines/presentation/template-resolver";
import { linkDocumentsToEvents } from "@/engines/presentation/timeline-engine";
import { canonicalDocumentType } from "@/services/supabase/queries";

// ── labels สำหรับแสดงผล ──

const DOCUMENT_TYPE_LABEL: Record<string, { th: string; prefix: string }> = {
  quotation:      { th: "ใบเสนอราคา",     prefix: "QT" },
  invoice:        { th: "ใบแจ้งหนี้",     prefix: "IV" },
  receipt:        { th: "ใบเสร็จรับเงิน", prefix: "RE" },
  delivery_order: { th: "ใบส่งของ",        prefix: "DO" },
  purchase_order: { th: "ใบสั่งซื้อ",      prefix: "PO" },
  payment_voucher:{ th: "ใบสำคัญจ่าย",    prefix: "PV" },
  debt_notice:    { th: "ใบทวงหนี้",       prefix: "DN" },
};

const BUSINESS_EVENT_LABEL: Record<string, string> = {
  quotation_sent:     "ส่งใบเสนอราคา",
  po_received:        "รับใบสั่งซื้อ",
  delivery_made:      "จัดส่งสินค้า",
  invoice_issued:     "ออกใบแจ้งหน���้",
  payment_received:   "รับชำระเงิน",
  credit_note_issued: "ออกใบลดหนี้",
  line_chat:          "ข้อความ LINE",
  note:               "บันทึก",
};

const STATUS_LABEL: Record<string, string> = {
  draft:     "ร่าง",
  saved:     "บันทึกแล้ว",
  confirmed: "ยืนยันแล้ว",
  cancelled: "ยกเลิก",
  paid:      "ชำระแล้ว",
  sent:      "ส่งแล้ว",
  void:      "ยกเลิก (Void)",
};

// ── types รับข้อมูลดิบจาก DB ──

interface RawDocument {
  id: string;
  document_type: string;
  document_number: string;
  status: string;
  net_amount: number | null;
  issue_date: string | null;
  created_at: string;
  transaction_id?: string | null;
  business_event_id?: string | null;
}

interface RawBusinessEvent {
  id: string;
  event_type: string;
  event_date: string;
  title: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  transaction_id?: string | null;
}

// ── engine ──

export function buildPartnerTimeline(
  docs: RawDocument[],
  events: RawBusinessEvent[]
): PartnerTimelineEntry[] {
  const entries: PartnerTimelineEntry[] = [];

  // Shared linking primitive (engines/presentation/timeline-engine.ts) — same
  // logic app/admin/relationships/feed.ts's buildFeed() uses. A document's
  // business_event_id may reference an event outside this `events` array
  // (already-deleted event, or a doc resolved against a different partner
  // query) — those must still render standalone, not vanish, so orphaned
  // linked docs are folded back into the standalone set below rather than
  // trusted blindly.
  const { documentsByEventId, standaloneDocuments: unlinkedDocuments } = linkDocumentsToEvents(docs);
  const realEventIds = new Set(events.map((e) => e.id));
  const orphanedDocuments = Array.from(documentsByEventId.entries())
    .filter(([eventId]) => !realEventIds.has(eventId))
    .flatMap(([, orphanDocs]) => orphanDocs);
  const standaloneDocuments = [...unlinkedDocuments, ...orphanedDocuments];

  for (const ev of events) {
    const template = resolvePresentationTemplate({ source_kind: "business_event", source_id: ev.id });
    const linkedDocs = documentsByEventId.get(ev.id) ?? [];
    let amount: number | null = null;
    let status: string | null = null;
    const artifacts = linkedDocs.map((doc) => {
      const canonical = canonicalDocumentType(doc.document_type);
      amount = amount ?? doc.net_amount;
      status = status ?? (STATUS_LABEL[doc.status] ?? doc.status);
      return {
        kind: "document" as const,
        document_id: doc.id,
        document_number: doc.document_number,
        document_type: canonical,
        status: STATUS_LABEL[doc.status] ?? doc.status,
        amount: doc.net_amount,
      };
    });
    entries.push({
      date: ev.event_date,
      kind: "business_event",
      ...template,
      event_type: ev.event_type,
      title: ev.title ?? BUSINESS_EVENT_LABEL[ev.event_type] ?? ev.event_type,
      subtitle: ev.description ?? null,
      amount,
      status,
      business_event_id: ev.id,
      transaction_id: ev.transaction_id ?? undefined,
      artifacts,
    });
  }

  for (const doc of standaloneDocuments) {
    const canonical = canonicalDocumentType(doc.document_type);
    const meta = DOCUMENT_TYPE_LABEL[canonical];
    const date = doc.issue_date ?? doc.created_at.split("T")[0];
    const template = resolvePresentationTemplate({
      source_kind: "document",
      source_id: doc.id,
      business_event_id: doc.business_event_id ?? null,
    });
    entries.push({
      date,
      kind: "document",
      ...template,
      event_type: canonical,
      title: meta ? `${meta.th} ${doc.document_number}` : doc.document_number,
      subtitle: meta?.prefix ?? null,
      amount: doc.net_amount,
      status: STATUS_LABEL[doc.status] ?? doc.status,
      document_id: doc.id,
      document_number: doc.document_number,
      transaction_id: doc.transaction_id ?? undefined,
    });
  }

  return uniqueResolvedTemplates(entries).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// Documents with no accounting effect (owner, 2026-07-18) — a voided/
// cancelled invoice is still a real document (kept, never deleted, shown in
// the timeline for its history), but it must not count toward what's owed.
// Root cause this fixes: buildPartnerSummary summed every "invoice"-typed
// document regardless of status, so a voided invoice inflated
// total_invoiced/outstanding by its full amount (confirmed against a real
// case: two invoices ฿16,856.53 sent + ฿16,741.84 void summed to the exact
// ฿33,598.37 "คงเหลือ" shown, when only the sent one should count). "void" is
// a real ad-hoc DB value seen in production, not yet in this file's own
// STATUS_LABEL vocabulary (draft/saved/confirmed/cancelled/paid) — treated
// as equivalent to "cancelled" here rather than silently ignored.
function hasNoAccountingEffect(status: string): boolean {
  return status === "cancelled" || status === "void";
}

export function buildPartnerSummary(
  partner: { id: string; name: string; partner_type_label: string | null; phone: string | null },
  docs: RawDocument[]
): PartnerSummary {
  let total_invoiced = 0;
  let total_received = 0;
  let last_activity: string | null = null;

  for (const d of docs) {
    const canonical = canonicalDocumentType(d.document_type);
    const amount = Number(d.net_amount ?? 0);
    if (!hasNoAccountingEffect(d.status)) {
      if (canonical === "invoice") total_invoiced += amount;
      if (canonical === "receipt") total_received += amount;
    }
    const date = d.issue_date ?? d.created_at.split("T")[0];
    if (!last_activity || date > last_activity) last_activity = date;
  }

  return {
    id: partner.id,
    name: partner.name,
    partner_type_label: partner.partner_type_label,
    phone: partner.phone,
    total_invoiced,
    total_received,
    outstanding: total_invoiced - total_received,
    last_activity,
    document_count: docs.length,
  };
}
