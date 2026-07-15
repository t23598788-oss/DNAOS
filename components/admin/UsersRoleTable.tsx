"use client"

import { useEffect, useState } from "react"

type Role = "super_admin" | "admin" | "employee" | "partner" | "customer" | "ai_service"
type UserRow = {
  id: string
  email: string
  role: Role
  created_at: string
  verified: boolean
  last_sign_in_at: string | null
  provider: string
  is_owner: boolean
}

const ROLES: Role[] = ["super_admin", "admin", "employee", "partner", "customer", "ai_service"]

// Identity Architecture (2026-07-14) — Owner shown first and separately, then
// one section per role. Owner itself is not a role (see GET /api/admin/users'
// comment) — it's the super_admin row with is_owner: true, filtered out of
// its own role's section below so it never appears twice.
const SECTIONS: { label: string; match: (u: UserRow) => boolean }[] = [
  { label: "Owner", match: (u) => u.is_owner },
  { label: "Super Admin", match: (u) => u.role === "super_admin" && !u.is_owner },
  { label: "Admins", match: (u) => u.role === "admin" },
  { label: "Employees", match: (u) => u.role === "employee" },
  { label: "Partners", match: (u) => u.role === "partner" },
  { label: "Customers", match: (u) => u.role === "customer" },
  { label: "AI Services", match: (u) => u.role === "ai_service" },
]

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })
}

export default function UsersRoleTable() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else setUsers(d.users ?? [])
      })
      .catch(() => setError("โหลดรายชื่อ user ไม่สำเร็จ"))
      .finally(() => setLoading(false))
  }, [])

  async function changeRole(id: string, role: Role) {
    setSavingId(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "บันทึกไม่สำเร็จ")
        return
      }
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)))
    } catch {
      setError("บันทึกไม่สำเร็จ")
    } finally {
      setSavingId(null)
    }
  }

  if (loading) return <p className="text-sm text-stone-400">กำลังโหลด...</p>

  function renderTable(rows: UserRow[]) {
    return (
      <table className="w-full text-sm border border-stone-200 rounded-xl overflow-hidden">
        <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2">Email</th>
            <th className="text-left px-4 py-2">Role</th>
            <th className="text-left px-4 py-2">Verified</th>
            <th className="text-left px-4 py-2">Last Login</th>
            <th className="text-left px-4 py-2">Provider</th>
            <th className="text-left px-4 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className="border-t border-stone-100">
              <td className="px-4 py-2 text-stone-800">{u.email}</td>
              <td className="px-4 py-2">
                <select
                  value={u.role}
                  disabled={savingId === u.id}
                  onChange={(e) => changeRole(u.id, e.target.value as Role)}
                  className="text-xs border border-stone-200 rounded-lg px-2 py-1 bg-white disabled:opacity-50"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-2 text-xs">
                {u.verified ? (
                  <span className="text-emerald-700">ยืนยันแล้ว</span>
                ) : (
                  <span className="text-amber-700">ยังไม่ยืนยัน</span>
                )}
              </td>
              <td className="px-4 py-2 text-stone-400 text-xs">{fmtDate(u.last_sign_in_at)}</td>
              <td className="px-4 py-2 text-stone-400 text-xs">{u.provider}</td>
              <td className="px-4 py-2 text-stone-400 text-xs">{fmtDate(u.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {users.length === 0 ? (
        <p className="text-sm text-stone-400 text-center py-6">ยังไม่มี user ในระบบ</p>
      ) : (
        SECTIONS.map(({ label, match }) => {
          const rows = users.filter(match)
          if (rows.length === 0) return null
          return (
            <div key={label}>
              <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">{label}</h2>
              {renderTable(rows)}
            </div>
          )
        })
      )}
    </div>
  )
}
