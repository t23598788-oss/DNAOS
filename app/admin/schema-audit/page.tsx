'use client'

import { useState, useEffect } from "react"

interface LogRow {
  id: number
  phase: "start" | "end"
  command_tag: string
  object_type: string | null
  object_identity: string | null
  executed_by: string
  client_addr: string | null
  occurred_at: string
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("th-TH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export default function SchemaAuditPage() {
  const [log, setLog] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/admin/schema-audit")
      .then((r) => r.json())
      .then((d) => setLog(d.log ?? []))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-3">
        <h1 className="text-base font-bold text-stone-900">ประวัติการเปลี่ยนแปลงโครงสร้างฐานข้อมูล</h1>
        <p className="text-xs text-stone-600 mt-0.5">
          บันทึกอัตโนมัติจาก Postgres เอง — จับได้ทุกการสร้าง/ลบ/แก้ตาราง ไม่ว่าจะมาจากแอปนี้ ใครก็ตาม หรือเครื่องมืออื่นที่ต่อฐานข้อมูลตรง
        </p>
      </div>

      <div className="p-6">
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-stone-700">
                <th className="text-left font-bold uppercase tracking-wide px-4 py-2.5">เวลา</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">คำสั่ง</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">วัตถุ</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">โดย</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">จาก IP</th>
                <th className="text-right font-bold uppercase tracking-wide px-4 py-2.5">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading && <tr><td colSpan={6} className="text-center text-stone-500 py-8 animate-pulse">โหลด...</td></tr>}
              {!loading && log.length === 0 && <tr><td colSpan={6} className="text-center text-stone-500 py-8">ยังไม่มีการเปลี่ยนแปลงโครงสร้างตั้งแต่เริ่มบันทึก</td></tr>}
              {log.map((row) => (
                <tr key={row.id} className="hover:bg-stone-50 transition">
                  <td className="px-4 py-2.5 text-stone-600 whitespace-nowrap">{fmtDateTime(row.occurred_at)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-stone-800">{row.command_tag}</td>
                  <td className="px-3 py-2.5 text-stone-700">{row.object_identity ?? <span className="text-stone-400">—</span>}</td>
                  <td className="px-3 py-2.5 text-stone-600">{row.executed_by}</td>
                  <td className="px-3 py-2.5 text-stone-400 font-mono text-xs">{row.client_addr ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${row.phase === "start" ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
                      {row.phase === "start" ? "เริ่ม" : "เสร็จ"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
