"use client"

import { useEffect, useState } from "react"

// AuditTab (UNIFIED FINANCE ADMIN mission, 2026-10-11) — ประวัติการดำเนินงาน
// การเงินจาก GET /api/admin/finance/audit (audit_logs — canonical audit
// owner เดิม) ทุก channel (LINE/อัตโนมัติ/Admin) ลง audit ตัวเดียวกัน

interface AuditRow {
  id: string
  action: string
  entity_type: string
  entity_id: string | null
  field: string | null
  new_value: string | null
  created_at: string
}

export default function AuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/admin/finance/audit?limit=80")
      .then((r) => r.json())
      .then((d) => setRows(d.items ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-sm text-stone-400">กำลังโหลด...</div>

  return (
    <div className="border border-stone-200 rounded-lg divide-y divide-stone-100 bg-white">
      {rows.length === 0 && <div className="px-3 py-3 text-sm text-stone-400">ไม่มีประวัติ</div>}
      {rows.map((r) => (
        <div key={r.id} className="px-3 py-2 text-sm flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs font-medium text-stone-700">{r.action}</span>
            <span className="text-xs text-stone-400 ml-2">{r.entity_type}{r.field ? ` · ${r.field}` : ""}</span>
            {r.entity_id && <span className="text-xs text-stone-400 ml-2 hidden md:inline">{r.entity_id.slice(0, 8)}</span>}
          </div>
          <div className="text-xs text-stone-400 whitespace-nowrap">{String(r.created_at).replace("T", " ").slice(0, 19)}</div>
        </div>
      ))}
    </div>
  )
}
