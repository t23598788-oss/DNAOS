"use client"

import { useCallback, useEffect, useState } from "react"

// UnifiedListTab (UNIFIED FINANCE ADMIN mission, 2026-10-11) — รายการการเงิน
// ทั้งหมดจาก GET /api/admin/finance/transactions (canonical tables เดียวกัน
// ทุก channel) — ไม่แยก tab Manual/Automation แสดงร่วมกัน ต่างกันแค่ column
// "ช่องทาง" (source metadata)

interface Row {
  id: string
  kind: string
  direction: "in" | "out"
  date: string | null
  counterparty: string | null
  amount: number
  status: string
  reference: string | null
  source_channel: string
  recorded_by: string | null
  created_at: string | null
}

const thb = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const KIND_LABEL: Record<string, string> = {
  income_evidence: "หลักฐานเงินเข้า",
  income_allocation: "จัดสรรเงินรับ",
  expense: "รายจ่าย",
  payable: "คำขอจ่าย",
}

const STATUS_LABEL: Record<string, string> = {
  ai_read: "รอตรวจสอบ",
  waiting_bank_confirmation: "รอ bank ยืนยัน",
  confirmed: "ยืนยันแล้ว",
  rejected: "ปฏิเสธ",
  allocated: "จัดสรรแล้ว",
  recorded: "บันทึกแล้ว",
  pending: "รอดำเนินการ",
  owner_acknowledged: "เจ้าของรับทราบ",
  paid_confirmed: "ยืนยันจ่ายแล้ว",
  completed: "เสร็จสมบูรณ์",
}

const SOURCE_LABEL: Record<string, string> = {
  line: "LINE",
  upload: "อัปโหลด Admin",
  email: "อีเมล",
  bank: "ธนาคาร",
  drive: "Drive",
  admin_manual: "Admin (แมนนวล)",
  line_chat: "LINE ทีมงาน",
  subscription_email_sync: "ตรวจอเมลอัตโนมัติ",
  canonical_payment: "จ่ายเงินอัตโนมัติ",
  payable_workflow: "คำขอจ่าย",
  unknown: "ไม่ระบุ",
}

const inputCls = "text-sm border border-stone-300 rounded-lg px-3 py-2 bg-white"
const labelCls = "block text-xs font-medium text-stone-600 mb-1"


export default function UnifiedListTab() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [direction, setDirection] = useState("")
  const [q, setQ] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const params = new URLSearchParams()
    if (direction) params.set("direction", direction)
    if (q.trim()) params.set("q", q.trim())
    if (dateFrom) params.set("date_from", dateFrom)
    if (dateTo) params.set("date_to", dateTo)
    const res = await fetch(`/api/admin/finance/transactions?${params}`).catch(() => null)
    if (!res || !res.ok) { setError("โหลดรายการการเงินไม่สำเร็จ"); setRows([]) }
    else setRows((await res.json()).items ?? [])
    setLoading(false)
  }, [direction, q, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div>
          <label className={labelCls}>ทิศทาง</label>
          <select className={`${inputCls} w-full`} value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="">ทั้งหมด</option>
            <option value="in">เงินเข้า</option>
            <option value="out">เงินออก</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>ค้นหา (คู่ค้า/อ้างอิง)</label>
          <input className={`${inputCls} w-full`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ชื่อ/เลขอ้างอิง" />
        </div>
        <div>
          <label className={labelCls}>จากวันที่</label>
          <input type="date" className={`${inputCls} w-full`} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>ถึงวันที่</label>
          <input type="date" className={`${inputCls} w-full`} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
      {loading && <div className="text-sm text-stone-400">กำลังโหลด...</div>}

      {!loading && (
        <div className="border border-stone-200 rounded-lg divide-y divide-stone-100 bg-white overflow-x-auto">
          {rows.length === 0 && <div className="px-3 py-4 text-sm text-stone-400">ไม่มีรายการ</div>}
          {rows.map((r) => (
            <div key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap ${r.direction === "in" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  {r.direction === "in" ? "เข้า" : "ออก"}
                </span>
                <span className="text-xs text-stone-500 whitespace-nowrap">{r.date ?? "-"}</span>
                <span className="text-stone-800 truncate">{r.counterparty ?? "(ไม่ระบุคู่ค้า)"}</span>
                <span className="text-xs text-stone-400 whitespace-nowrap">{KIND_LABEL[r.kind] ?? r.kind}</span>
                <span className="text-xs text-stone-400 whitespace-nowrap">· {SOURCE_LABEL[r.source_channel] ?? r.source_channel}</span>
                {r.reference && <span className="text-xs text-stone-400 truncate hidden md:inline">· อ้างอิง {r.reference}</span>}
                <span className={`text-xs whitespace-nowrap ${r.status === "confirmed" || r.status === "allocated" || r.status === "completed" ? "text-emerald-600" : r.status === "rejected" ? "text-red-500" : "text-amber-600"}`}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
                {r.kind === "income_evidence" && r.status === "ai_read" && (
                  <a href="/admin/receipts" className="text-xs text-blue-600 underline whitespace-nowrap">ตรวจสอบ/ยืนยัน →</a>
                )}
              </div>
              <div className="font-semibold whitespace-nowrap">{r.direction === "out" ? "-" : ""}{thb(r.amount)} ฿</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
