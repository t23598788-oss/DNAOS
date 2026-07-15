/**
 * Event Icon/Style — canonical owner
 *
 * Architecture Governance (2026-07-13): app/admin/partners/[id]/page.tsx's
 * EVENT_STYLE and app/admin/jobs/[id]/page.tsx's EVENT_ICONS were each
 * independently defined, duplicating "what does this business_event.event_type
 * look like" ownership across two files.
 *
 * They are NOT merged into one mapping — they already render different icons
 * for the same event_type today (e.g. quotation_sent: EVENT_STYLE shows 📤,
 * EVENT_ICONS shows 📋). Forcing them to agree would change existing UI
 * output, which this consolidation must not do. Both are relocated here
 * verbatim (byte-identical values) as the one canonical source; each
 * consumer imports the one it already used, unchanged.
 */

export const EVENT_STYLE: Record<string, { bg: string; text: string; icon: string }> = {
  invoice:         { bg: "bg-blue-100",   text: "text-blue-700",   icon: "📄" },
  receipt:         { bg: "bg-emerald-100",text: "text-emerald-700",icon: "✅" },
  quotation:       { bg: "bg-amber-100",  text: "text-amber-700",  icon: "📋" },
  delivery_order:  { bg: "bg-orange-100", text: "text-orange-700", icon: "🚚" },
  purchase_order:  { bg: "bg-violet-100", text: "text-violet-700", icon: "🛒" },
  payment_voucher: { bg: "bg-purple-100", text: "text-purple-700", icon: "💳" },
  debt_notice:     { bg: "bg-rose-100",   text: "text-rose-700",   icon: "⚠️" },
  payment_received:{ bg: "bg-emerald-100",text: "text-emerald-700",icon: "💰" },
  quotation_sent:  { bg: "bg-amber-100",  text: "text-amber-700",  icon: "📤" },
  delivery_made:   { bg: "bg-orange-100", text: "text-orange-700", icon: "📦" },
  invoice_issued:  { bg: "bg-blue-100",   text: "text-blue-700",   icon: "🧾" },
  po_received:     { bg: "bg-violet-100", text: "text-violet-700", icon: "📬" },
  credit_note_issued:{ bg: "bg-pink-100", text: "text-pink-700",   icon: "📝" },
  line_chat:       { bg: "bg-green-100",  text: "text-green-700",  icon: "💬" },
  note:            { bg: "bg-stone-100",  text: "text-stone-600",  icon: "📌" },
};

export const EVENT_ICONS: Record<string, string> = {
  quotation_sent: "📋", po_received: "🛒", work_started: "🔧",
  delivery_made: "🚚", work_completed: "✅", invoice_issued: "🧾",
  payment_received: "💰", closed: "🏁",
};
