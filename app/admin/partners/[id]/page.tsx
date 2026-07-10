'use client'

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import type { PartnerTimelineEntry, PartnerSummary } from "@/core/shared/types"

// ── helpers ──

function formatMoney(n: number | null) {
  if (n == null || n === 0) return null
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

// จัดกลุ่ม entries ตามเดือน-ปี
function groupByMonth(entries: PartnerTimelineEntry[]) {
  const groups: { monthKey: string; label: string; entries: PartnerTimelineEntry[] }[] = []
  for (const entry of entries) {
    const monthKey = entry.date.slice(0, 7) // "YYYY-MM"
    const existing = groups.find((g) => g.monthKey === monthKey)
    if (existing) {
      existing.entries.push(entry)
    } else {
      const d = new Date(entry.date + "T00:00:00")
      const label = d.toLocaleDateString("th-TH", { year: "numeric", month: "long" })
      groups.push({ monthKey, label, entries: [entry] })
    }
  }
  return groups
}

// ── icon + color per event type ──

const EVENT_STYLE: Record<string, { bg: string; text: string; icon: string }> = {
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
}

const STATUS_COLOR: Record<string, string> = {
  "ร่าง": "bg-amber-100 text-amber-700",
  "บันทึกแล้ว": "bg-stone-100 text-stone-600",
  "ยืนยันแล้ว": "bg-emerald-100 text-emerald-700",
  "ชำระแล้ว": "bg-emerald-100 text-emerald-700",
  "ยกเลิก": "bg-red-100 text-red-600",
}

function EventDot({ eventType }: { eventType: string }) {
  const style = EVENT_STYLE[eventType] ?? { bg: "bg-stone-100", text: "text-stone-500", icon: "•" }
  return (
    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 ${style.bg}`}>
      {style.icon}
    </span>
  )
}

// ── Summary Card ──

function SummaryCard({ s }: { s: PartnerSummary }) {
  return (
    <div className="bg-white border border-stone-200 rounded-2xl px-5 py-4 mb-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-bold text-stone-800 text-base">{s.name}</div>
          <div className="text-xs text-stone-400 mt-0.5 space-x-2">
            {s.partner_type_label && <span>{s.partner_type_label}</span>}
            {s.phone && <span>· {s.phone}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <a
            href={`/admin/create-document?partnerId=${s.id}&type=receipt`}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-stone-800 text-white hover:bg-stone-700 transition"
          >
            + สร้างใบเสร็จ
          </a>
          <a
            href={`/admin/create-document?partnerId=${s.id}&type=invoice`}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-50 transition"
          >
            + สร้างใบแจ้งหนี้
          </a>
          <a
            href={`/admin/create-document?partnerId=${s.id}`}
            className="text-xs text-stone-400 hover:text-stone-600 transition"
          >
            เอกสารอื่น →
          </a>
        </div>
        <div className="flex gap-4 text-right flex-wrap">
          <div>
            <div className="text-[10px] text-stone-400 uppercase tracking-wider">ยอดแจ้งหนี้</div>
            <div className="font-bold text-stone-700 tabular-nums">
              {formatMoney(s.total_invoiced) ? `฿${formatMoney(s.total_invoiced)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-stone-400 uppercase tracking-wider">รับแล้ว</div>
            <div className="font-bold text-emerald-700 tabular-nums">
              {formatMoney(s.total_received) ? `฿${formatMoney(s.total_received)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-stone-400 uppercase tracking-wider">คงเหลือ</div>
            <div className={`font-bold tabular-nums ${s.outstanding > 0 ? "text-rose-600" : "text-stone-400"}`}>
              {formatMoney(s.outstanding) ? `฿${formatMoney(s.outstanding)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-stone-400 uppercase tracking-wider">เอกสาร</div>
            <div className="font-bold text-stone-500">{s.document_count} ใบ</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Timeline Entry ──

function TimelineEntry({ entry }: { entry: PartnerTimelineEntry }) {
  const style = EVENT_STYLE[entry.event_type] ?? { bg: "bg-stone-100", text: "text-stone-500", icon: "•" }

  return (
    <div className="flex gap-3 group">
      {/* dot + line */}
      <div className="flex flex-col items-center">
        <EventDot eventType={entry.event_type} />
        <div className="w-px flex-1 bg-stone-200 mt-1 group-last:hidden" />
      </div>

      {/* content */}
      <div className="pb-5 flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            {entry.document_id ? (
              <Link
                href={`/admin/${entry.event_type === "invoice" ? "invoice" : entry.event_type === "receipt" ? "receipt" : entry.event_type === "delivery_order" ? "delivery-order" : entry.event_type === "purchase_order" ? "purchase-order" : entry.event_type === "payment_voucher" ? "payment-voucher" : entry.event_type === "debt_notice" ? "debt-notice" : "create-document"}`}
                className={`font-semibold text-sm hover:underline ${style.text}`}
              >
                {entry.title}
              </Link>
            ) : (
              <span className={`font-semibold text-sm ${style.text}`}>{entry.title}</span>
            )}
            {entry.subtitle && (
              <div className="text-[10px] text-stone-400 mt-0.5">{entry.subtitle}</div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {entry.amount != null && entry.amount !== 0 && (
              <span className="text-sm font-semibold text-stone-700 tabular-nums">
                ฿{entry.amount.toLocaleString("th-TH")}
              </span>
            )}
            {entry.status && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[entry.status] ?? "bg-stone-100 text-stone-500"}`}>
                {entry.status}
              </span>
            )}
          </div>
        </div>
        <div className="text-[10px] text-stone-400 mt-1">{fmtDate(entry.date)}</div>
      </div>
    </div>
  )
}

// ── Main Page ──

// ── Chain types ──

interface ChainDoc {
  id: string; document_type: string; document_number: string
  status: string; net_amount: number | null; issue_date: string | null
}

interface ChainEvent {
  id: string; event_type: string; event_date: string; title: string | null
}

interface TxChain {
  id: string; tx_type: string; state: string; title: string | null
  project_name: string | null; net_amount: number | null; paid_amount: number | null
  created_at: string
  documents: ChainDoc[]
  events: ChainEvent[]
}

const DOC_ROUTE: Record<string, string> = {
  delivery_order: "/admin/delivery-order",
  invoice: "/admin/invoice",
  receipt: "/admin/receipt",
  purchase_order: "/admin/purchase-order",
  payment_voucher: "/admin/payment-voucher",
}

const DOC_LABEL: Record<string, string> = {
  invoice: "INV", receipt: "REC", delivery_order: "DO",
  purchase_order: "PO", payment_voucher: "PV", debt_notice: "DN",
}

const TX_STATE_COLOR: Record<string, string> = {
  created: "bg-stone-100 text-stone-500",
  confirmed: "bg-blue-100 text-blue-700",
  started: "bg-indigo-100 text-indigo-700",
  delivered: "bg-amber-100 text-amber-700",
  completed: "bg-teal-100 text-teal-700",
  invoiced: "bg-orange-100 text-orange-700",
  paid: "bg-emerald-100 text-emerald-700",
  closed: "bg-stone-200 text-stone-500",
}

const TX_TYPE_TH: Record<string, string> = {
  sale: "งานขาย", purchase: "งานจัดซื้อ", contract: "งานรับจ้าง",
  service: "งานบริการ", rental: "งานเช่า", transport: "งานขนส่ง",
}

function JobChainCard({ tx }: { tx: TxChain }) {
  const stateCls = TX_STATE_COLOR[tx.state] ?? "bg-stone-100 text-stone-500"
  return (
    <div className="bg-white border border-stone-200 rounded-2xl px-5 py-4 mb-3 hover:border-stone-300 transition">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-stone-100 text-stone-500 uppercase">
          {TX_TYPE_TH[tx.tx_type] ?? tx.tx_type}
        </span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${stateCls}`}>
          {tx.state}
        </span>
        <span className="text-sm font-semibold text-stone-700 flex-1 truncate">
          {tx.title ?? tx.project_name ?? "ไม่มีชื่อ"}
        </span>
        {tx.net_amount != null && tx.net_amount > 0 && (
          <span className="text-sm font-bold text-stone-700 tabular-nums shrink-0">
            ฿{tx.net_amount.toLocaleString("th-TH")}
          </span>
        )}
        <Link
          href={`/admin/jobs/${tx.id}`}
          className="text-[10px] font-semibold px-2.5 py-1 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition shrink-0"
        >
          ดูงาน →
        </Link>
      </div>

      {tx.documents.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {tx.documents.map((d) => {
            const route = DOC_ROUTE[d.document_type]
            const label = DOC_LABEL[d.document_type] ?? d.document_type
            const content = (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                d.status === "paid" ? "border-emerald-300 bg-emerald-50 text-emerald-700" :
                d.status === "saved" ? "border-stone-200 bg-stone-50 text-stone-600" :
                "border-amber-200 bg-amber-50 text-amber-700"
              }`}>
                {label} {d.document_number}
              </span>
            )
            return route ? (
              <Link key={d.id} href={`${route}?documentId=${d.id}`}>{content}</Link>
            ) : (
              <span key={d.id}>{content}</span>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface LineMessage {
  id: string
  line_user_id: string
  raw_type: string
  raw_text: string | null
  created_at: string
}

interface LineContact {
  line_user_id: string
  line_name: string | null
  line_picture: string | null
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("th-TH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

export default function PartnerTimelinePage() {
  const params = useParams()
  const partnerId = params.id as string

  const [summary, setSummary] = useState<PartnerSummary | null>(null)
  const [timeline, setTimeline] = useState<PartnerTimelineEntry[]>([])
  const [chains, setChains] = useState<TxChain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [credit, setCredit] = useState<{ score: number; risk: string; risk_label: string; risk_color: string; flags: string[] } | null>(null)
  const [lineContacts, setLineContacts] = useState<LineContact[]>([])
  const [lineMessages, setLineMessages] = useState<LineMessage[]>([])

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`/api/admin/partners/${partnerId}/timeline`).then((r) => r.json()),
      fetch(`/api/admin/partners/${partnerId}/chain`).then((r) => r.json()),
      fetch(`/api/admin/partners/${partnerId}/credit`).then((r) => r.json()),
      fetch(`/api/admin/partners/${partnerId}/line-messages`).then((r) => r.json()),
    ])
      .then(([tl, ch, cr, lm]) => {
        if (tl.error) throw new Error(tl.error)
        setSummary(tl.summary)
        setTimeline(tl.timeline ?? [])
        setChains(ch.chains ?? [])
        if (!cr.error) setCredit(cr)
        setLineContacts(lm.contacts ?? [])
        setLineMessages(lm.messages ?? [])
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false))
  }, [partnerId])

  const groups = groupByMonth(timeline)

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* header */}
      <div className="px-6 py-3 bg-white border-b border-stone-200 shrink-0 flex items-center gap-3">
        <Link href="/admin/partners" className="text-xs text-stone-400 hover:text-stone-600 transition">
          ← คู่ค้า
        </Link>
        {summary && (
          <span className="text-sm font-semibold text-stone-700">{summary.name}</span>
        )}
        {credit && (
          <span
            title={credit.flags.length > 0 ? credit.flags.join(" · ") : "เครดิตดี"}
            className={`text-[10px] font-bold px-2.5 py-1 rounded-full cursor-help ${
              credit.risk === "low"    ? "bg-emerald-100 text-emerald-700" :
              credit.risk === "medium" ? "bg-amber-100 text-amber-700" :
                                         "bg-rose-100 text-rose-700"
            }`}
          >
            เครดิต {credit.risk_label} {credit.score}/100
          </span>
        )}
        {credit && credit.flags.length > 0 && (
          <span className="text-[10px] text-rose-500 hidden md:block truncate max-w-xs">
            ⚠ {credit.flags[0]}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && (
          <div className="text-center text-sm text-stone-400 py-16 animate-pulse">กำลังโหลด...</div>
        )}
        {error && (
          <div className="text-center text-sm text-rose-600 py-16">{error}</div>
        )}

        {!loading && !error && summary && (
          <>
            <SummaryCard s={summary} />

            {/* LINE conversation — a company can have more than one LINE account */}
            {lineContacts.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-xs font-bold text-stone-500 uppercase tracking-wider">💬 แชท LINE ({lineMessages.length} ข้อความ)</div>
                  <div className="flex-1 h-px bg-stone-200" />
                  <Link href="/admin/line-customers" className="text-[10px] font-semibold text-emerald-600 hover:underline">
                    ดูหน้าลูกค้า LINE →
                  </Link>
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3">
                  <div className="flex flex-wrap gap-2 mb-3">
                    {lineContacts.map((c) => (
                      <div key={c.line_user_id} className="flex items-center gap-1.5 text-xs bg-stone-50 border border-stone-200 rounded-full pl-1 pr-2.5 py-1">
                        {c.line_picture ? (
                          <img src={c.line_picture} alt="" className="w-5 h-5 rounded-full object-cover bg-stone-100" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-stone-200" />
                        )}
                        <span className="text-stone-700 font-medium">{c.line_name ?? "ไม่ทราบชื่อ"}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {lineMessages.slice(-30).map((m) => (
                      <div key={m.id} className="flex justify-between gap-3 text-xs bg-stone-50 border border-stone-100 rounded-lg px-3 py-1.5">
                        <span className="text-stone-700 truncate">{m.raw_text ?? `[${m.raw_type}]`}</span>
                        <span className="text-stone-400 shrink-0">{fmtDateTime(m.created_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Jobs / Transaction Chains */}
            {chains.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-xs font-bold text-stone-500 uppercase tracking-wider">งานทั้งหมด ({chains.length})</div>
                  <div className="flex-1 h-px bg-stone-200" />
                  <Link href={`/admin/jobs/create?partnerId=${partnerId}`} className="text-[10px] font-semibold text-indigo-600 hover:underline">
                    + สร้างงานใหม่
                  </Link>
                </div>
                {chains.map((tx) => <JobChainCard key={tx.id} tx={tx} />)}
              </div>
            )}

            {chains.length === 0 && !loading && (
              <div className="mb-4 flex items-center justify-between bg-stone-50 border border-dashed border-stone-200 rounded-xl px-4 py-3">
                <span className="text-xs text-stone-400">ยังไม่มีงานที่เชื่อมโยง</span>
                <Link href={`/admin/jobs/create`} className="text-xs font-semibold text-indigo-600 hover:underline">
                  + สร้างงานใหม่
                </Link>
              </div>
            )}

            {timeline.length === 0 && (
              <div className="text-center text-sm text-stone-400 py-10">
                ยังไม่มีเหตุการณ์หรือเอกสารสำหรับคู่ค้านี้
              </div>
            )}

            {groups.map((group) => (
              <div key={group.monthKey} className="mb-6">
                {/* month header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                    {group.label}
                  </div>
                  <div className="flex-1 h-px bg-stone-200" />
                  <div className="text-[10px] text-stone-400">{group.entries.length} เหตุการณ์</div>
                </div>

                <div>
                  {group.entries.map((entry, i) => (
                    <TimelineEntry key={entry.document_id ?? entry.business_event_id ?? i} entry={entry} />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
