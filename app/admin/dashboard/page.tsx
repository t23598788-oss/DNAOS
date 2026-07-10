"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { SecretaryChat } from "@/components/admin/SecretaryChat"

// ── Types ──────────────────────────────────────────────────────────────────────

interface Metrics {
  todayRevenue: number
  activeJobs: number
  pendingDocs: number
}

interface ActiveJob {
  id: string
  order_no: string
  status: string
  partner: string
  partner_id: string
  updated_at: string
}

interface DocItem {
  id: string
  type: string
  number: string
  partner: string
  partner_id: string
  amount: number
  date: string
  status?: string
}

interface PulseData {
  metrics: Metrics
  activeJobs: ActiveJob[]
  pendingDocs: DocItem[]
  recentDocs: DocItem[]
  generatedAt: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function money(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function relativeDate(iso: string) {
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return "เมื่อกี้"
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`
  return d.toLocaleDateString("th-TH", { month: "short", day: "numeric" })
}

const DOC_TYPE_LABEL: Record<string, string> = {
  invoice: "ใบแจ้งหนี้",
  receipt: "ใบเสร็จ",
  quotation: "ใบเสนอราคา",
  delivery_order: "ใบส่งของ",
  purchase_order: "ใบสั่งซื้อ",
  payment_voucher: "ใบสำคัญจ่าย",
  billing: "ใบวางบิล",
  workorder: "ใบสั่งงาน",
}

const JOB_STATUS_LABEL: Record<string, string> = {
  DRAFT: "ร่าง",
  CONFIRMED: "ยืนยันแล้ว",
  IN_PROGRESS: "กำลังทำ",
  DELIVERED: "ส่งแล้ว",
  INVOICED: "ออกบิลแล้ว",
  PAID: "ชำระแล้ว",
}

const JOB_STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-stone-100 text-stone-500",
  CONFIRMED: "bg-blue-100 text-blue-600",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  DELIVERED: "bg-indigo-100 text-indigo-600",
  INVOICED: "bg-violet-100 text-violet-700",
  PAID: "bg-emerald-100 text-emerald-700",
}

// ── สรุป "วันนี้ต้องทำอะไรบ้าง" สำหรับข้อความเปิดแชต ──────────────────────────────

function buildOpeningText(pulse: PulseData, pendingDraftCount: number | null): string {
  const lines: string[] = []
  if (pulse.pendingDocs.length > 0) {
    lines.push(`เอกสารรอยืนยัน ${pulse.pendingDocs.length} ใบ`)
  }
  if (pulse.activeJobs.length > 0) {
    lines.push(`งานที่กำลังเดิน ${pulse.activeJobs.length} งาน`)
  }
  if (pendingDraftCount && pendingDraftCount > 0) {
    lines.push(`ข้อความ LINE รอเฮียอนุมัติก่อนส่งลูกค้า ${pendingDraftCount} รายการ`)
  }
  if (lines.length === 0) return "วันนี้ยังไม่มีอะไรค้างครับ พิมพ์สั่งงานได้เลย"
  return `วันนี้เฮียมี:\n${lines.map((l) => `• ${l}`).join("\n")}`
}

// ── Quick action doc types ─────────────────────────────────────────────────────

const QUICK_DOCS = [
  { type: "invoice", label: "ใบแจ้งหนี้", color: "border-blue-200 text-blue-700 hover:bg-blue-50" },
  { type: "receipt", label: "ใบเสร็จรับเงิน", color: "border-emerald-200 text-emerald-700 hover:bg-emerald-50" },
  { type: "quotation", label: "ใบเสนอราคา", color: "border-amber-200 text-amber-700 hover:bg-amber-50" },
  { type: "delivery_order", label: "ใบส่งของ", color: "border-indigo-200 text-indigo-700 hover:bg-indigo-50" },
  { type: "purchase_order", label: "ใบสั่งซื้อ", color: "border-stone-200 text-stone-600 hover:bg-stone-50" },
]

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [pulse, setPulse] = useState<PulseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshAt, setRefreshAt] = useState<Date | null>(null)
  const [pendingDraftCount, setPendingDraftCount] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/pulse")
      if (!res.ok) throw new Error(`${res.status}`)
      setPulse(await res.json())
      setRefreshAt(new Date())
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ข้อความ LINE ที่ระบบตัดสินใจส่งลูกค้าเองไม่ได้ ต้องรอเฮียอนุมัติ (Rule 72) —
  // นับมาโชว์ในข้อความเปิดแชต แทนที่จะสร้างคิวตรวจสอบใหม่ซ้ำซ้อน
  useEffect(() => {
    fetch("/api/admin/outbound-drafts")
      .then((r) => r.json())
      .then((d) => setPendingDraftCount((d.drafts ?? []).filter((x: { status: string }) => x.status === "pending_review").length))
      .catch(() => setPendingDraftCount(null))
  }, [])

  const openingText = pulse ? buildOpeningText(pulse, pendingDraftCount) : undefined

  // auto-refresh ทุก 2 นาที — ทำงานเงียบ ไม่กระพริบ
  useEffect(() => {
    const t = setInterval(load, 120_000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div className="min-h-screen bg-stone-50">

      {/* ── Header ── */}
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold text-stone-800">DNA OS</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            สรุปภาพรวมวันนี้ — รายได้จากใบแจ้งหนี้ที่ออก<u>วันนี้</u>เท่านั้น (ไม่รวมยอดหนี้เก่า ดูยอดหนี้ทั้งหมดที่ "ธุรกิจการเงิน"), งานที่เปิดอยู่ตอนนี้, เอกสารร่างที่ยังไม่ยืนยัน
          </p>
          {refreshAt && (
            <p className="text-[11px] text-stone-400">
              อัปเดต {refreshAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-[11px] text-stone-400 hover:text-stone-600 disabled:opacity-40 transition"
        >
          {loading ? "โหลด..." : "↺"}
        </button>
      </div>

      <div className="p-5 space-y-5 max-w-4xl mx-auto">

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ── เลขาส่วนตัว — จุดศูนย์กลางของหน้านี้ ── */}
        <SecretaryChat openingText={openingText} />

        {/* ── ตะเกียง — 3 ตัวเลขกลาง ── */}
        <div className="grid grid-cols-3 gap-3">
          <MetricCard
            label="รายได้วันนี้"
            value={pulse ? `฿${money(pulse.metrics.todayRevenue)}` : "—"}
            loading={loading}
            color="text-emerald-700"
            href="/admin/debt-tracking"
          />
          <MetricCard
            label="งานที่กำลังเดิน"
            value={pulse ? `${pulse.metrics.activeJobs} งาน` : "—"}
            loading={loading}
            color="text-blue-700"
            href="/admin/jobs"
          />
          <MetricCard
            label="เอกสารรอดำเนินการ"
            value={pulse ? `${pulse.metrics.pendingDocs} ใบ` : "—"}
            loading={loading}
            color={pulse && pulse.metrics.pendingDocs > 0 ? "text-amber-700" : "text-stone-600"}
            href="/admin/pending"
          />
        </div>

        {/* ── Quick actions ── */}
        <section>
          <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">สร้างเอกสาร</div>
          <div className="flex gap-2 flex-wrap">
            {QUICK_DOCS.map((q) => (
              <a
                key={q.type}
                href={`/admin/create-document?type=${q.type}`}
                className={`px-3 py-2 rounded-xl text-xs font-medium border transition ${q.color}`}
              >
                {q.label}
              </a>
            ))}
          </div>
        </section>

        {/* ── งานที่กำลังเดิน ── */}
        {pulse && pulse.activeJobs.length > 0 && (
          <section>
            <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">
              งานที่กำลังเดิน
            </div>
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-50">
              {pulse.activeJobs.map((job) => (
                <div key={job.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-stone-700 truncate">{job.partner}</div>
                    <div className="text-[10px] text-stone-400 mt-0.5">{job.order_no} · {relativeDate(job.updated_at)}</div>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${JOB_STATUS_COLOR[job.status] ?? "bg-stone-100 text-stone-500"}`}>
                    {JOB_STATUS_LABEL[job.status] ?? job.status}
                  </span>
                  <a
                    href={`/admin/create-document?partnerId=${job.partner_id}&type=invoice`}
                    className="text-[10px] px-2 py-1 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 transition shrink-0"
                  >
                    ออกเอกสาร →
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── เอกสารรอดำเนินการ ── */}
        {pulse && pulse.pendingDocs.length > 0 && (
          <section>
            <div className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider mb-2">
              เอกสารรอยืนยัน ({pulse.pendingDocs.length})
            </div>
            <div className="bg-white border border-amber-200 rounded-xl overflow-hidden divide-y divide-stone-50">
              {pulse.pendingDocs.slice(0, 8).map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="shrink-0 text-[10px] font-semibold text-stone-400 w-20">
                    {DOC_TYPE_LABEL[doc.type] ?? doc.type}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-stone-700">{doc.number}</div>
                    <div className="text-[10px] text-stone-400 truncate">{doc.partner}</div>
                  </div>
                  {doc.amount > 0 && (
                    <div className="text-xs font-semibold text-stone-700 shrink-0">฿{money(doc.amount)}</div>
                  )}
                  <a
                    href={`/admin/${routeFor(doc.type)}/${doc.id}`}
                    className="text-[10px] px-2 py-1 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 transition shrink-0"
                  >
                    ดู →
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── เอกสารล่าสุด ── */}
        {pulse && pulse.recentDocs.length > 0 && (
          <section>
            <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">
              เอกสารล่าสุด
            </div>
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-50">
              {pulse.recentDocs.map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="shrink-0 text-[10px] font-semibold text-stone-400 w-20">
                    {DOC_TYPE_LABEL[doc.type] ?? doc.type}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-stone-700">{doc.number}</div>
                    <div className="text-[10px] text-stone-400 truncate">{doc.partner}</div>
                  </div>
                  {doc.amount > 0 && (
                    <div className="text-xs font-semibold text-stone-700 shrink-0">฿{money(doc.amount)}</div>
                  )}
                  <span className="text-[10px] text-stone-400 shrink-0">{relativeDate(doc.date)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {!loading && pulse && pulse.activeJobs.length === 0 && pulse.pendingDocs.length === 0 && pulse.recentDocs.length === 0 && (
          <div className="text-center py-12 text-stone-300 text-sm">ยังไม่มีข้อมูล</div>
        )}

      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function MetricCard({ label, value, loading, color, href }: {
  label: string
  value: string
  loading: boolean
  color?: string
  href?: string
}) {
  const content = (
    <>
      <div className={`text-xl font-bold tabular-nums ${loading ? "text-stone-200 animate-pulse" : (color ?? "text-stone-700")}`}>
        {loading ? "———" : value}
      </div>
      <div className="text-[11px] text-stone-400 mt-1">{label}</div>
    </>
  )
  if (href) {
    return (
      <Link href={href} className="block bg-white border border-stone-200 rounded-xl px-4 py-4 hover:border-stone-300 hover:shadow-sm transition">
        {content}
      </Link>
    )
  }
  return <div className="bg-white border border-stone-200 rounded-xl px-4 py-4">{content}</div>
}

// แปลง doc type → URL path สำหรับ view
function routeFor(type: string): string {
  const map: Record<string, string> = {
    invoice: "invoice",
    receipt: "receipt",
    quotation: "create-document",
    delivery_order: "delivery-order",
    purchase_order: "purchase-order",
    payment_voucher: "payment-voucher",
  }
  return map[type] ?? "create-document"
}