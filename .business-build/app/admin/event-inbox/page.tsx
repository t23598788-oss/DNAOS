'use client'

import { Fragment, useState, useEffect, useMemo } from "react"
import Link from "next/link"

interface EventRow {
  id: string
  event_code: string
  event_type: string | null
  title: string | null
  description: string | null
  status: string
  confidence: number
  material_text: string | null
  quantity: number | null
  quantity_unit: string | null
  destination: string | null
  schedule_text: string | null
  contact_name: string | null
  contact_phone: string | null
  partner_id: string | null
  source_line_user_id: string | null
  created_at: string
  companies: { name: string } | null
}

const TYPE_STYLE: Record<string, string> = {
  "ขอราคา": "bg-blue-50 text-blue-700 border-blue-200",
  "สั่งซื้อ": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "แจ้งชำระเงิน": "bg-teal-50 text-teal-700 border-teal-200",
  "ส่งพิกัด": "bg-violet-50 text-violet-700 border-violet-200",
  "ส่งรูป": "bg-stone-50 text-stone-700 border-stone-200",
  "ส่งเอกสาร": "bg-amber-50 text-amber-700 border-amber-200",
  "เปลี่ยนปลายทาง": "bg-orange-50 text-orange-700 border-orange-200",
  "ยกเลิกงาน": "bg-red-50 text-red-700 border-red-200",
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("th-TH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

export default function EventInboxPage() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<string>("")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/event-inbox")
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []))
      .finally(() => setLoading(false))
  }, [])

  const types = useMemo(() => Array.from(new Set(events.map((e) => e.event_type).filter(Boolean))) as string[], [events])
  const filtered = useMemo(() => (filterType ? events.filter((e) => e.event_type === filterType) : events), [events, filterType])

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-3">
        <h1 className="text-base font-bold text-stone-900">📥 เหตุการณ์เข้า</h1>
        <p className="text-xs text-stone-600 mt-0.5">
          ทุกเหตุการณ์ธุรกิจที่เข้ามาจากภายนอก (ไม่ใช่รายการข้อความ) — นับเป็น "งาน" ไม่ใช่ "ข้อความ" · ทั้งหมด {events.length} เหตุการณ์
        </p>
      </div>

      <div className="p-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterType("")}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition ${filterType === "" ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"}`}
          >
            ทั้งหมด
          </button>
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition ${filterType === t ? "bg-stone-900 text-white border-stone-900" : (TYPE_STYLE[t] ?? "bg-white text-stone-600 border-stone-200")}`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-stone-700">
                <th className="text-left font-bold uppercase tracking-wide px-4 py-2.5">เวลา</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">ประเภท</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">คู่ค้า</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">รายละเอียด</th>
                <th className="text-right font-bold uppercase tracking-wide px-4 py-2.5">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading && <tr><td colSpan={5} className="text-center text-stone-500 py-8 animate-pulse">โหลด...</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={5} className="text-center text-stone-500 py-8">ยังไม่มีเหตุการณ์</td></tr>}
              {filtered.map((ev) => {
                const isOpen = expandedId === ev.id
                return (
                  <Fragment key={ev.id}>
                    <tr onClick={() => setExpandedId(isOpen ? null : ev.id)} className="hover:bg-stone-50 transition cursor-pointer">
                      <td className="px-4 py-3 text-stone-600 whitespace-nowrap">
                        <span className="inline-block w-3 text-stone-400">{isOpen ? "▾" : "▸"}</span>{" "}
                        {fmtDateTime(ev.created_at)}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${TYPE_STYLE[ev.event_type ?? ""] ?? "bg-stone-50 text-stone-700 border-stone-200"}`}>
                          {ev.event_type ?? "อื่นๆ"}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-medium text-stone-900">
                        {ev.companies?.name && ev.partner_id ? (
                          <Link href={`/admin/partners/${ev.partner_id}`} onClick={(e) => e.stopPropagation()} className="hover:underline text-stone-900">
                            {ev.companies.name} →
                          </Link>
                        ) : (
                          <span className="text-stone-400 font-normal">ยังไม่จับคู่</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-stone-700 truncate max-w-[320px]">{ev.title ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-200">{ev.status}</span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-stone-50">
                        <td colSpan={5} className="px-4 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <div>
                              <div className="text-xs text-stone-500 mb-0.5">Event Code</div>
                              <div className="text-sm font-mono font-semibold text-stone-900">{ev.event_code}</div>
                            </div>
                            <div>
                              <div className="text-xs text-stone-500 mb-0.5">วัสดุ</div>
                              <div className="text-sm text-stone-900">{ev.material_text ?? "—"}</div>
                            </div>
                            <div>
                              <div className="text-xs text-stone-500 mb-0.5">จำนวน</div>
                              <div className="text-sm text-stone-900">{ev.quantity ? `${ev.quantity} ${ev.quantity_unit ?? ""}` : "—"}</div>
                            </div>
                            <div>
                              <div className="text-xs text-stone-500 mb-0.5">ปลายทาง</div>
                              <div className="text-sm text-stone-900">{ev.destination ?? "—"}</div>
                            </div>
                            <div>
                              <div className="text-xs text-stone-500 mb-0.5">กำหนดเวลา</div>
                              <div className="text-sm text-stone-900">{ev.schedule_text ?? "—"}</div>
                            </div>
                            <div>
                              <div className="text-xs text-stone-500 mb-0.5">ผู้ติดต่อ</div>
                              <div className="text-sm text-stone-900">{ev.contact_name ?? "—"} {ev.contact_phone ? `(${ev.contact_phone})` : ""}</div>
                            </div>
                            <div>
                              <div className="text-xs text-stone-500 mb-0.5">ความมั่นใจของ AI</div>
                              <div className="text-sm text-stone-900">{Math.round(ev.confidence * 100)}%</div>
                            </div>
                            {ev.source_line_user_id && (
                              <div>
                                <div className="text-xs text-stone-500 mb-0.5">ที่มา</div>
                                <a href={ev.partner_id ? `/admin/relationships/${ev.partner_id}` : "/admin/relationships"} className="text-sm text-blue-600 hover:underline">เปิด Workspace →</a>
                              </div>
                            )}
                          </div>
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
