'use client'

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@supabase/supabase-js"

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

export default function AdminLoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get("next") ?? "/admin"

  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const sb = getSupabase()
      const { data, error: authError } = await sb.auth.signInWithPassword({ email, password })

      if (authError || !data.session) {
        setError(authError?.message ?? "อีเมลหรือรหัสผ่านไม่ถูกต้อง")
        return
      }

      const maxAge = data.session.expires_in ?? 3600
      document.cookie = `admin_session=${data.session.access_token}; path=/; max-age=${maxAge}; SameSite=Lax`

      router.push(nextPath)
      router.refresh()
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่")
    } finally {
      setLoading(false)
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const sb = getSupabase()
      const { data, error: authError } = await sb.auth.signUp({ email, password })

      if (authError) {
        setError(authError.message)
        return
      }

      // ถ้า Supabase ไม่ต้อง confirm email — session พร้อมเลย
      if (data.session) {
        const maxAge = data.session.expires_in ?? 3600
        document.cookie = `admin_session=${data.session.access_token}; path=/; max-age=${maxAge}; SameSite=Lax`
        router.push(nextPath)
        router.refresh()
      } else {
        // ต้อง confirm email ก่อน
        setSuccess("สร้างบัญชีแล้ว — กรุณาตรวจสอบอีเมลเพื่อยืนยันก่อน login")
        setMode("signin")
      }
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-100 to-stone-200 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl px-8 py-10">
          <div className="mb-8">
            <div className="text-[10px] font-bold tracking-[0.2em] text-stone-400 uppercase mb-3">
              Admin Access
            </div>
            <h1 className="text-2xl font-bold text-stone-900 leading-tight">
              {mode === "signin" ? <>Sign in to<br />the admin panel</> : <>สร้างบัญชี<br />ผู้ดูแลระบบ</>}
            </h1>
            <p className="mt-2 text-xs text-stone-400">
              {mode === "signin"
                ? "ใช้อีเมลและรหัสผ่านที่ได้รับจากผู้ดูแลระบบ"
                : "สร้างบัญชีแรกสำหรับระบบ DNA OS"}
            </p>
          </div>

          <form onSubmit={mode === "signin" ? handleSignIn : handleSignUp} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1.5">Email</label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                className="w-full text-sm border border-stone-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition bg-stone-50 disabled:opacity-50"
                placeholder="admin@company.com"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1.5">Password</label>
              <input
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === "signup" ? 6 : undefined}
                disabled={loading}
                className="w-full text-sm border border-stone-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition bg-stone-50 disabled:opacity-50"
                placeholder="••••••••"
              />
              {mode === "signup" && (
                <p className="mt-1 text-[10px] text-stone-400">อย่างน้อย 6 ตัวอักษร</p>
              )}
            </div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            {success && (
              <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading
                ? "กำลังดำเนินการ..."
                : mode === "signin" ? "Sign in" : "สร้างบัญชี"}
            </button>
          </form>

          {/* Toggle */}
          <div className="mt-6 pt-5 border-t border-stone-100 text-center">
            {mode === "signin" ? (
              <button
                onClick={() => { setMode("signup"); setError(null); setSuccess(null) }}
                className="text-xs text-stone-400 hover:text-stone-600 transition underline underline-offset-2"
              >
                ยังไม่มีบัญชี? สร้างบัญชีผู้ดูแล
              </button>
            ) : (
              <button
                onClick={() => { setMode("signin"); setError(null); setSuccess(null) }}
                className="text-xs text-stone-400 hover:text-stone-600 transition underline underline-offset-2"
              >
                มีบัญชีแล้ว? กลับไป Sign in
              </button>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-[10px] text-stone-400">
          DNA OS — Admin Panel
        </p>
      </div>
    </div>
  )
}
