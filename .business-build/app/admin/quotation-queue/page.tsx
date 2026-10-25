'use client'

import { useState, useEffect } from "react"
import Link from "next/link"

interface MaterialMatch {
  input: string
  matched: { id: string; name: string } | null
  candidates: { id: string; name: string }[]
}

interface ChecklistItem {
  key: string
  label: string
  done: boolean
}

interface QueueItem {
  id: string
  event_code: string
  event_type: string | null
  material_text: string | null
  quantity: string | number | null
  quantity_unit: string | null
  destination: string | null
  schedule_text: string | null
  contact_name: string | null
  contact_phone: string | null
  created_at: string
  status: string
  is_quote_only: boolean
  matched_company: { id: string; name: string } | null
  material_matches: MaterialMatch[]
  checklist: ChecklistItem[]
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("th-TH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

export default function QuotationQueuePage() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/admin/quotation-queue")
      .then((r) => r.json())
      .then((d) => setQueue(d.queue ?? []))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-3">
        <h1 className="text-base font-bold text-stone-900">คำขอราคาที่ยังไม่ได้ทำใบเสนอราคา</h1>
        <p className="text-xs text-stone-600 mt-0.5">
          คำขอจริงจากแชท LINE ที่ยังไม่มีเอกสารตอบกลับ — จับคู่ชื่อวัสดุกับข้อมูลจริงในระบบให้แล้ว ส่วนระยะทาง/ราคา รอเชื่อมต่อระบบหาพิกัดปลายทาง (Geocoding) ก่อนถึงจะคำนวณราคาอัตโนมัติได้
        </p>
      </div>

      <div className="p-6 space-y-3">
        {loading && <div className="text-sm text-stone-500 animate-pulse py-4">โหลด...</div>}
        {!loading && queue.length === 0 && <div className="text-sm text-stone-400 py-4">ไม่มีคำขอราคาที่ค้างอยู่ครับ</div>}

        {queue.map((q) => (
          <div key={q.id} className="bg-white rounded-xl border border-amber-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-stone-900">
                {q.matched_company ? (
                  <Link href={`/admin/partners/${q.matched_company.id}`} className="hover:underline">{q.matched_company.name} →</Link>
                ) : (
                  "ยังไม่จับคู่บริษัท"
                )}
                <span className="ml-2 text-xs font-mono text-stone-400">{q.event_code}</span>
                {q.is_quote_only && (
                  <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-600">ขอราคาเฉยๆ</span>
                )}
                {q.status === "awaiting_info" && (
                  <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">รอลูกค้าตอบ</span>
                )}
                {q.status === "ready_to_quote" && (
                  <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">ข้อมูลครบ พร้อมแจ้งราคา</span>
                )}
              </div>
              <span className="text-[11px] text-stone-400">{fmtDateTime(q.created_at)}</span>
            </div>

            {/* checklist — "สมุดบันทึก" ว่าได้อะไรมาแล้วบ้าง */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {q.checklist.map((c) => (
                <span
                  key={c.key}
                  className={`text-[11px] font-medium px-2 py-1 rounded-lg border flex items-center gap-1 ${
                    c.done ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-stone-50 text-stone-400 border-stone-200"
                  }`}
                >
                  {c.done ? "✓" : "○"} {c.label}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-stone-600 mb-3">
              {q.quantity && <div>ปริมาณ: <span className="text-stone-900 font-medium">{q.quantity} {q.quantity_unit ?? ""}</span></div>}
              {q.destination && <div>ปลายทาง: <span className="text-stone-900 font-medium">{q.destination}</span></div>}
              {q.schedule_text && <div>กำหนด: <span className="text-stone-900 font-medium">{q.schedule_text}</span></div>}
              {q.contact_name && <div>ผู้ติดต่อ: <span className="text-stone-900 font-medium">{q.contact_name} {q.contact_phone ?? ""}</span></div>}
            </div>

            <div className="space-y-1">
              <div className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">วัสดุที่ขอ</div>
              {q.material_matches.length === 0 && <div className="text-xs text-stone-400">ไม่มีข้อมูลวัสดุระบุมา</div>}
              {q.material_matches.map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-stone-700 min-w-[100px]">{m.input}</span>
                  {m.matched && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">✓ {m.matched.name}</span>
                  )}
                  {!m.matched && m.candidates.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      ไม่ชัดเจน — เลือกจาก: {m.candidates.map((c) => c.name).join(", ")}
                    </span>
                  )}
                  {!m.matched && m.candidates.length === 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 border border-stone-200">ไม่พบในระบบ — ต้องกรอกเอง</span>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-3 text-[11px] text-stone-400 border-t border-stone-100 pt-2">
              {q.checklist.every((c) => c.done)
                ? "ข้อมูลครบแล้ว — ยังคำนวณราคาเป็นตัวเลขไม่ได้ รอเชื่อม Geocoding เพื่อหาระยะทางจากปลายทางจริง"
                : "รอข้อมูลที่ยังไม่ครบ (ดู checklist ด้านบน) — ระบบถามลูกค้ากลับไปในแชท LINE แล้ว"}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
