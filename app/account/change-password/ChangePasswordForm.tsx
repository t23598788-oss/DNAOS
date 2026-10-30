'use client'

import { useState } from "react"
import { createBrowserSupabase } from "@/services/supabase/browser"
import { resolveDestination, isSafeInternalPath } from "@/core/auth/resolveDestination"
import type { AppRole } from "@/core/auth/session"

// ONE password-setting surface for every purpose (M030, 2026-10-31):
// first-time setup (?first=1) after the first verified login and password
// recovery (?recovery=1) both land HERE and both set the password through
// the SAME allowed API — supabase.auth.updateUser (GoTrue). The password
// value itself is never sent anywhere else: not to this repo's API routes,
// not into profiles, not into logs. Only a timestamp is recorded afterward
// (POST /api/account/password-state, service role) so /auth/confirm knows
// the account no longer needs first-time setup.
export default function ChangePasswordForm({
  mode,
  next,
}: {
  mode: "first" | "recovery"
  next?: string | null
}) {
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
      // password → GoTrue; password_set → user metadata mirror (same call)
      const { error: updateError } = await sb.auth.updateUser({
        password,
        data: { password_set: true },
      })
      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }

      // record the timestamp (never the password) — best effort: if it fails
      // the next magic-link login simply lands here once more, idempotent.
      try {
        const saved = await fetch("/api/account/password-state", { method: "POST" })
        if (!saved.ok) console.error("[m030] password-state recording failed:", saved.status)
      } catch (err) {
        console.error("[m030] password-state fetch failed", err)
      }

      // Landing: ?next= (same guard as everywhere) wins; otherwise the role
      // landing authority sends every role into its own workspace directly.
      const { data: { user } } = await sb.auth.getUser()
      const { data: profile } = await sb.from("profiles").select("role").eq("id", user?.id ?? "").single()
      const role = (profile?.role as AppRole) ?? "customer"
      window.location.href =
        next && isSafeInternalPath(next) ? next : resolveDestination(role, null)
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่")
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-stone-600 mb-1.5">
          {mode === "recovery" ? "รหัสผ่านใหม่" : "ตั้งรหัสผ่าน"}
        </label>
        <input
          type="password"
          autoComplete={mode === "recovery" ? "new-password" : "new-password"}
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
        <label className="block text-xs font-semibold text-stone-600 mb-1.5">ยืนยันรหัสผ่าน</label>
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
        {loading
          ? "กำลังบันทึก..."
          : mode === "recovery"
            ? "บันทึกรหัสผ่านใหม่"
            : "บันทึกรหัสผ่าน"}
      </button>
    </form>
  )
}
