"use client"

import { useEffect, useState } from "react"

type Role = "super_admin" | "admin" | "employee" | "partner" | "customer" | "ai_service"
type UserRow = { id: string; email: string; role: Role; created_at: string }

const ROLES: Role[] = ["super_admin", "admin", "employee", "partner", "customer", "ai_service"]

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

  return (
    <div>
      {error && (
        <div className="mb-4 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <table className="w-full text-sm border border-stone-200 rounded-xl overflow-hidden">
        <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2">Email</th>
            <th className="text-left px-4 py-2">Role</th>
            <th className="text-left px-4 py-2">สร้างเมื่อ</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
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
              <td className="px-4 py-2 text-stone-400 text-xs">
                {new Date(u.created_at).toLocaleDateString("th-TH")}
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-center text-stone-400">
                ยังไม่มี user ในระบบ
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}