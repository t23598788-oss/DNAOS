'use client'

import { useState } from "react"
import { createBrowserSupabase } from "@/services/supabase/browser"
import { resolveDestination } from "@/core/auth/resolveDestination"
import type { AppRole } from "@/core/auth/session"

export default function ChangePasswordForm() {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร")
      return
    }
    if (password !== confirm) {
      setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน")
      return
    }

    setLoading(true)
    try {
      const sb = createBrowserSupabase()
      const { error: updateError } = await sb.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }

      const { data: { user } } = await sb.auth.getUser()
      const { data: profile } = await sb.from("profiles").select("role").eq("id", user?.id ?? "").single()
      const role = (profile?.role as AppRole) ?? "customer"
      window.location.href = resolveDestination(role, null)
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่")
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-stone-600 mb-1.5">รหัสผ่านใหม่</label>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          disabled={loading}
          className="w-full text-sm border border-stone-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition bg-stone-50 disabled:opacity-50"
          placeholder="••••••••"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-stone-600 mb-1.5">ยืนยันรหัสผ่านใหม่</label>
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={6}
          disabled={loading}
          className="w-full text-sm border border-stone-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition bg-stone-50 disabled:opacity-50"
          placeholder="••••••••"
        />
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !password || !confirm}
        className="w-full py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
      </button>
    </form>
  )
}
