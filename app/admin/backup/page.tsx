'use client'

import { useState, useEffect } from "react"

interface TableStats {
  [table: string]: number
}

interface BackupStats {
  tables: TableStats
  total_rows: number
  errors?: string[]
  checked_at: string
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString("th-TH", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

export default function BackupPage() {
  const [stats, setStats] = useState<BackupStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  async function loadStats() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/backup", { method: "POST" })
      const data = await res.json()
      setStats(data)
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStats() }, [])

  async function handleDownload() {
    setDownloading(true)
    try {
      const res = await fetch("/api/admin/backup")
      const blob = await res.blob()
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `dnaos-backup-${ts}.json`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  const TABLE_LABELS: Record<string, string> = {
    partners: "คู่ค้า",
    documents: "เอกสาร",
    document_items: "รายการในเอกสาร",
    transactions: "Transaction / Jobs",
    business_events: "Business Events",
    debt_trackings: "ติดตามหนี้",
    invoice_debts: "หนี้ใบแจ้งหนี้",
    invoice_payments: "การชำระเงิน",
    app_configs: "ตั้งค่าระบบ",
    material_types: "ประเภทวัสดุ",
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-stone-50">
      <div className="shrink-0 bg-white border-b border-stone-200 px-6 py-4 flex items-center gap-3">
        <div>
          <div className="text-base font-bold text-stone-800">สำรองฐานข้อมูล</div>
          <div className="text-xs text-stone-400">Export ข้อมูลทั้งหมดเป็นไฟล์ JSON</div>
        </div>
        <div className="flex-1" />
        <button
          onClick={loadStats}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 transition disabled:opacity-40"
        >
          {loading ? "กำลังโหลด..." : "↻ รีเฟรช"}
        </button>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="text-xs font-semibold px-4 py-2 rounded-xl bg-stone-900 text-white hover:bg-stone-800 transition disabled:opacity-40"
        >
          {downloading ? "กำลัง Export..." : "⬇ ดาวน์โหลด Backup"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-4">

          {stats && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3">
                <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">ตารางทั้งหมด</div>
                <div className="text-2xl font-bold text-stone-800 mt-1">{Object.keys(stats.tables).length}</div>
              </div>
              <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3">
                <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">แถวทั้งหมด</div>
                <div className="text-2xl font-bold text-stone-800 mt-1">{stats.total_rows.toLocaleString()}</div>
              </div>
              <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3">
                <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">อัปเดตล่าสุด</div>
                <div className="text-sm font-semibold text-stone-700 mt-1">{fmtDate(stats.checked_at)}</div>
              </div>
            </div>
          )}

          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-stone-100">
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider">ข้อมูลในฐานข้อมูล</div>
            </div>
            {loading ? (
              <div className="px-5 py-8 text-center text-sm text-stone-400 animate-pulse">กำลังตรวจสอบ...</div>
            ) : stats ? (
              <div className="divide-y divide-stone-100">
                {Object.entries(stats.tables).map(([table, count]) => (
                  <div key={table} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-stone-700">
                        {TABLE_LABELS[table] ?? table}
                      </div>
                      <div className="text-[10px] text-stone-400 font-mono">{table}</div>
                    </div>
                    <span className={`text-sm font-bold tabular-nums ${count > 0 ? "text-stone-800" : "text-stone-400"}`}>
                      {count >= 0 ? count.toLocaleString() : "—"}
                      <span className="text-[10px] font-normal text-stone-400 ml-1">แถว</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-8 text-center text-sm text-stone-400">โหลดไม่สำเร็จ</div>
            )}
          </div>

          {stats?.errors && stats.errors.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
              <div className="text-xs font-semibold text-rose-700 mb-1">ข้อผิดพลาด</div>
              {stats.errors.map((e, i) => (
                <div key={i} className="text-[10px] text-rose-600 font-mono">{e}</div>
              ))}
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
            <strong>หมายเหตุ:</strong> ไฟล์ backup เป็น JSON format — เก็บไว้ในที่ปลอดภัย
            ห้ามแชร์เพราะมีข้อมูลส่วนตัวลูกค้า
          </div>
        </div>
      </div>
    </div>
  )
}
