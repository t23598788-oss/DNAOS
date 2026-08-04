'use client'

import { Fragment, useState, useEffect, useCallback } from "react"

interface Permission {
  id: string
  line_user_id: string
  display_name: string | null
  is_active: boolean
}

interface Equipment {
  id: string
  asset_code: string
  name: string
  sim_number: string | null
  imei: string | null
  current_status: string
  total_engine_hours: number
  permissions: Permission[]
}

interface Contact {
  line_user_id: string
  line_name: string | null
  role: string | null
}

interface MaintenanceTicket {
  id: string
  trigger_hours: number
  status: "open" | "closed"
  opened_at: string
  closed_at: string | null
  overdue_locked: boolean
  equipment_assets: { asset_code: string; name: string; total_engine_hours: number; current_status: string } | null
}

// Equipment GPS/Relay Permission System (owner spec, 2026-07-24) — the real
// admin surface for "เสียบปลั๊ก Y-Socket ใส่ซิม กรอกเบอร์ซิมหน้าจอจบ": create
// an equipment unit once, assign which driver's LINE account may unlock it,
// toggle access on/off. A dedicated page (like /admin/pits), not folded
// into Contact Settings — a driver can have permission to more than one
// equipment unit, a real many-to-many relationship the generic per-contact
// settings blob doesn't model.
export default function EquipmentPage() {
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [newCode, setNewCode] = useState("")
  const [newName, setNewName] = useState("")

  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [assignLineUserId, setAssignLineUserId] = useState("")
  const [assignSim, setAssignSim] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const [eqRes, cRes, tRes] = await Promise.all([
      fetch("/api/admin/equipment"),
      fetch("/api/admin/line-profiles"),
      fetch("/api/admin/equipment/maintenance-tickets"),
    ])
    const eqData = await eqRes.json()
    const cData = await cRes.json()
    const tData = await tRes.json()
    setEquipment(eqData.equipment ?? [])
    setContacts((cData.contacts ?? []).map((c: any) => ({ line_user_id: c.line_user_id, line_name: c.line_name, role: c.role })))
    setTickets(tData.tickets ?? [])
    setLoading(false)
  }, [])

  const closeTicket = async (ticketId: string) => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/equipment/maintenance-tickets/${ticketId}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
      const d = await res.json()
      if (!res.ok) { setMessage(d.error ?? "ปิดใบงานไม่สำเร็จ"); return }
      setMessage(d.unlock_warning ? `ปิดใบงานแล้ว — ${d.unlock_warning}` : "ปิดใบงานซ่อมบำรุงแล้ว (รีเซ็ตชั่วโมงเครื่อง)")
      await load()
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => { load() }, [load])

  const createEquipment = async () => {
    if (!newCode.trim() || !newName.trim()) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/admin/equipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_code: newCode.trim(), name: newName.trim() }),
      })
      const d = await res.json()
      if (!res.ok) { setMessage(d.error ?? "สร้างไม่สำเร็จ"); return }
      setNewCode(""); setNewName("")
      await load()
    } finally {
      setSaving(false)
    }
  }

  const startAssign = (equipmentId: string) => {
    setAssigningId(equipmentId)
    setAssignLineUserId("")
    setAssignSim("")
    setMessage(null)
  }

  const togglePermission = async (equipmentId: string, lineUserId: string, isActive: boolean, simNumber?: string) => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/admin/equipment/toggle-permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipmentId, lineUserId, isActive, simNumber }),
      })
      const d = await res.json()
      if (!res.ok) { setMessage(d.error ?? "บันทึกไม่สำเร็จ"); return }
      setMessage(d.rich_menu === "updated" ? "บันทึกสิทธิ์และอัปเดต Rich Menu แล้ว" : `บันทึกสิทธิ์แล้ว — ${d.rich_menu}`)
      setAssigningId(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-800">เครื่องจักร & สิทธิ์ GPS Relay</h1>
        <p className="text-sm text-stone-500 mt-1">จับคู่พนักงานขับ ↔ เครื่องจักร ↔ ซิม IoT — เปิด/ปิดสิทธิ์สตาร์ตรถได้ทันที</p>
      </div>

      {message && <div className="text-sm bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">{message}</div>}

      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">เพิ่มเครื่องจักรใหม่</div>
        <div className="flex gap-2">
          <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="รหัสเครื่อง เช่น KX033-01" className="text-sm border border-stone-300 rounded-lg px-3 py-2 flex-1" />
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ชื่อ เช่น Kubota KX033" className="text-sm border border-stone-300 rounded-lg px-3 py-2 flex-1" />
          <button onClick={createEquipment} disabled={saving || !newCode.trim() || !newName.trim()} className="text-sm font-medium px-4 py-2 rounded-lg bg-stone-800 text-white disabled:opacity-40">เพิ่ม</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        {loading && <div className="text-center text-stone-400 py-8">โหลด...</div>}
        {!loading && equipment.length === 0 && <div className="text-center text-stone-400 py-8">ยังไม่มีเครื่องจักร</div>}
        <div className="divide-y divide-stone-100">
          {equipment.map((e) => (
            <Fragment key={e.id}>
              <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-stone-900">{e.name} <span className="text-xs text-stone-400">({e.asset_code})</span></div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      ซิม: {e.sim_number ?? "ยังไม่กรอก"} · สถานะ:{" "}
                      <span className={"font-medium " + (e.current_status === "LOCKED" ? "text-rose-600" : "text-emerald-600")}>{e.current_status}</span>
                      {" "}· ชั่วโมงเครื่องสะสม: {e.total_engine_hours.toLocaleString("th-TH")}
                    </div>
                  </div>
                  <button onClick={() => startAssign(e.id)} className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50">
                    {assigningId === e.id ? "ปิด" : "จัดการสิทธิ์"}
                  </button>
                </div>

                {e.permissions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {e.permissions.map((p) => (
                      <span key={p.id} className={"text-[11px] px-2 py-0.5 rounded-full border " + (p.is_active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-stone-100 text-stone-500 border-stone-200")}>
                        {p.display_name ?? p.line_user_id.slice(0, 8)} — {p.is_active ? "มีสิทธิ์" : "ตัดสิทธิ์"}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {assigningId === e.id && (
                <div className="px-4 py-4 bg-amber-50/40">
                  <div className="text-[11px] font-bold text-stone-500 uppercase tracking-wide mb-2">ให้/ตัดสิทธิ์คนขับ</div>
                  <div className="flex gap-2 flex-wrap">
                    <select value={assignLineUserId} onChange={(ev) => setAssignLineUserId(ev.target.value)} className="text-xs border border-stone-300 rounded-lg px-2 py-1.5 bg-white flex-1 min-w-[160px]">
                      <option value="">เลือกผู้ติดต่อ...</option>
                      {contacts.map((c) => (
                        <option key={c.line_user_id} value={c.line_user_id}>{c.line_name ?? c.line_user_id.slice(0, 8)}{c.role === "driver" ? " (คนขับ)" : ""}</option>
                      ))}
                    </select>
                    <input value={assignSim} onChange={(ev) => setAssignSim(ev.target.value)} placeholder="เบอร์ซิม IoT (ถ้าจะแก้)" className="text-xs border border-stone-300 rounded-lg px-2 py-1.5 w-40" />
                    <button
                      onClick={() => togglePermission(e.id, assignLineUserId, true, assignSim || undefined)}
                      disabled={saving || !assignLineUserId}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-40"
                    >
                      ✓ ให้สิทธิ์
                    </button>
                    <button
                      onClick={() => togglePermission(e.id, assignLineUserId, false)}
                      disabled={saving || !assignLineUserId}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 disabled:opacity-40"
                    >
                      ตัดสิทธิ์
                    </button>
                  </div>
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-100">
          <div className="text-xs font-bold text-stone-500 uppercase tracking-wide">ใบงานซ่อมบำรุง (ทุก 250 ชม.)</div>
        </div>
        {tickets.length === 0 && <div className="text-center text-stone-400 py-8 text-sm">ยังไม่มีใบงานซ่อมบำรุง</div>}
        <div className="divide-y divide-stone-100">
          {tickets.map((t) => (
            <div key={t.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-stone-800">
                  {t.equipment_assets?.name ?? "?"} <span className="text-xs text-stone-400">({t.equipment_assets?.asset_code})</span> — ครบ {t.trigger_hours.toLocaleString("th-TH")} ชม.
                </div>
                <div className="text-xs text-stone-500 mt-0.5">
                  เปิด {new Date(t.opened_at).toLocaleString("th-TH")} ·{" "}
                  <span className={t.status === "open" ? "text-amber-600 font-medium" : "text-stone-400"}>{t.status === "open" ? "ยังเปิดอยู่" : "ปิดแล้ว"}</span>
                  {t.overdue_locked && <span className="text-rose-600 font-medium"> · ล็อกอัตโนมัติแล้ว (เกิน 50 ชม.)</span>}
                </div>
              </div>
              {t.status === "open" && (
                <button onClick={() => closeTicket(t.id)} disabled={saving} className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">
                  ปิดใบงาน (ซ่อมเสร็จแล้ว)
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
