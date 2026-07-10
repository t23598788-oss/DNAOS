'use client'

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createBrowserSupabase } from "@/services/supabase/browser"

// The ONE login page for the whole system (TASK-001 SSO) — Admin, Business,
// Partner, and User Portal all redirect here when unauthenticated
// (middleware.ts), and all sign in against the same Supabase Auth session.
// Role-based landing page after login comes from profiles.role (see
// supabase/migrations/20260708000001_profiles_roles.sql) — never guessed
// client-side, always read from the row RLS lets the user see for themselves.

const ROLE_HOME: Record<string, string> = {
  super_admin: "/admin",
  admin: "/admin",
  employee: "/admin",
  partner: "/partner",
  customer: "/user",
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get("next")
  const forbidden = searchParams.get("error") === "forbidden"

  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function landingPathFor(userId: string): Promise<string> {
    const sb = createBrowserSupabase()
    const { data: profile } = await sb.from("profiles").select("role").eq("id", userId).single()
    const role = (profile?.role as string) ?? "customer"
    return nextPath || ROLE_HOME[role] || "/"
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const sb = createBrowserSupabase()
      const { data, error: authError } = await sb.auth.signInWithPassword({ email, password })

      if (authError || !data.session) {
        setError(authError?.message ?? "อีเมลหรือรหัสผ่านไม่ถูกต้อง")
        return
      }

      const dest = await landingPathFor(data.session.user.id)
      router.push(dest)
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
      const sb = createBrowserSupabase()
      const { data, error: authError } = await sb.auth.signUp({ email, password })

      if (authError) {
        setError(authError.message)
        return
      }

      if (data.session) {
        const dest = await landingPathFor(data.session.user.id)
        router.push(dest)
        router.refresh()
      } else {
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
          placeholder="you@company.com"
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

      {forbidden && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          บัญชีนี้ไม่มีสิทธิ์เข้าถึงหน้าที่ขอ — ลองเข้าสู่ระบบด้วยบัญชีอื่น
        </div>
      )}
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

      <div className="pt-1 text-center">
        {mode === "signin" ? (
          <button
            type="button"
            onClick={() => { setMode("signup"); setError(null); setSuccess(null) }}
            className="text-xs text-stone-400 hover:text-stone-600 transition underline underline-offset-2"
          >
            ยังไม่มีบัญชี? สร้างบัญชี
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setMode("signin"); setError(null); setSuccess(null) }}
            className="text-xs text-stone-400 hover:text-stone-600 transition underline underline-offset-2"
          >
            มีบัญชีแล้ว? กลับไป Sign in
          </button>
        )}
      </div>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-100 to-stone-200 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl px-8 py-10">
          <div className="mb-8">
            <div className="text-[10px] font-bold tracking-[0.2em] text-stone-400 uppercase mb-3">
              DNA OS
            </div>
            <h1 className="text-2xl font-bold text-stone-900 leading-tight">
              Sign in to<br />DNA OS
            </h1>
            <p className="mt-2 text-xs text-stone-400">
              บัญชีเดียว เข้าได้ทุก Portal — Admin / Business / Partner / User
            </p>
          </div>

          <Suspense fallback={<div className="h-40 animate-pulse bg-stone-100 rounded-xl" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-[10px] text-stone-400">
          DNA OS — Single Sign-On
        </p>
      </div>
    </div>
  )
}