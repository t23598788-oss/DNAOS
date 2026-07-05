'use client'

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get("next") ?? "/admin"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? "อีเมลหรือรหัสผ่านไม่ถูกต้อง")
        return
      }

      const safePath = nextPath.startsWith("/admin/login") ? "/admin" : nextPath
      router.push(safePath)
      router.refresh()
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
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
        disabled={loading || !email || !password}
        className="w-full py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "กำลังเข้าสู่ระบบ..." : "Sign in"}
      </button>
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
              Sign in to<br />the admin panel
            </h1>
            <p className="mt-2 text-xs text-stone-400">
              ใช้อีเมลและรหัสผ่านของผู้ดูแลระบบ
            </p>
          </div>

          <Suspense fallback={<div className="h-40 animate-pulse bg-stone-100 rounded-xl" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-[10px] text-stone-400">
          DNA OS — Admin Panel
        </p>
      </div>
    </div>
  )
}
