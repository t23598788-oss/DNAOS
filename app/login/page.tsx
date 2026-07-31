'use client'

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { createBrowserSupabase } from "@/services/supabase/browser"
import { resolveDestination } from "@/core/auth/resolveDestination"
import type { AppRole } from "@/core/auth/session"

// The ONE login page for the whole system (TASK-001 SSO) — Admin, Business,
// Partner, and User Portal all redirect here when unauthenticated
// (middleware.ts), and all sign in against the same Supabase Auth session.
// Role-based landing page after login comes from profiles.role (see
// supabase/migrations/20260708000001_profiles_roles.sql) — never guessed
// client-side, always read from the row RLS lets the user see for themselves.
// Where that role actually lands is decided in exactly one place:
// core/auth/resolveDestination.ts (Enterprise Workspace Architecture, Phase 1)
// — this file only fetches the role, it does not decide the destination.
//
// Sign-in only, no sign-up (owner, 2026-07-29): during this single-owner
// development phase there is exactly one real account (dnaos.tech@gmail.com)
// and no public users are meant to reach this system at all yet. A visible
// "create account" toggle was pure surface area to get confused by (or land
// on by accident) while troubleshooting something unrelated — removed
// entirely rather than hidden behind a flag, since re-adding it later (once
// the system is actually customer-facing) is a small, deliberate change, not
// a regression risk today.

function LoginForm() {
  const searchParams = useSearchParams()
  const nextPath = searchParams.get("next")
  const forbidden = searchParams.get("error") === "forbidden"

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [autoLoggingIn, setAutoLoggingIn] = useState(false)

  // Auto-login for the native desktop wrap (owner, 2026-07-30): "ล็อกอินกับ
  // เครื่องเลย...ถ้าเป็นแอปพลิเคชั่น" — single-owner system (see
  // feedback_single_owner_dev_phase_auth memory), running as a native app on
  // the owner's own machine, so there's no real reason to re-type a password
  // every launch. window.__TAURI_INTERNALS__ only exists inside the Tauri
  // webview (src-tauri/) — a normal browser tab still shows the real form,
  // untouched, since this global is never present there.
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return
    setAutoLoggingIn(true)
    fetch("/api/auth/auto-login", { method: "POST" })
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) {
          window.location.href = nextPath && nextPath.startsWith("/") ? nextPath : res.dest
        } else {
          setAutoLoggingIn(false)
          setError(res.error ?? "เข้าสู่ระบบอัตโนมัติไม่สำเร็จ")
        }
      })
      .catch(() => setAutoLoggingIn(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Login-flow debug instrumentation (2026-07-14) — DOM refs so submit can
  // read the input's actual value directly, not just React's tracked state.
  // Some autofill mechanisms set an input's value via the native property
  // setter, bypassing React's synthetic onChange entirely: the field visibly
  // shows the autofilled text, but React's `password` state can remain stale
  // (often empty, or whatever was last typed before autofill ran) — meaning
  // the form would submit a DIFFERENT value than what's shown on screen.
  const emailInputRef = useRef<HTMLInputElement>(null)
  const passwordInputRef = useRef<HTMLInputElement>(null)

  async function landingPathFor(userId: string): Promise<string> {
    const sb = createBrowserSupabase()
    const { data: profile } = await sb.from("profiles").select("role").eq("id", userId).single()
    const role = (profile?.role as AppRole) ?? "customer"
    return resolveDestination(role, nextPath)
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // DOM values only — no fallback to React state. Some autofill mechanisms
    // set an input's value via the native property setter, bypassing React's
    // synthetic onChange entirely, so `email`/`password` state can go stale
    // relative to what's actually shown on screen.
    const submitEmail = emailInputRef.current?.value ?? ""
    const submitPassword = passwordInputRef.current?.value ?? ""

    // Silent auto-retry (owner, 2026-07-29): a real "Failed to fetch" was
    // seen live — signInWithPassword's own fetch() throwing (network-level,
    // not a wrong-password response) is exactly the kind of transient blip
    // that shouldn't force a human to notice and click "Sign in" again.
    // Real Supabase-side outages are now caught independently by
    // supabase/functions/system-health-check, which alerts the owner
    // directly — this retry only smooths over a one-off hiccup so it never
    // reaches the screen at all.
    let result: Awaited<ReturnType<ReturnType<typeof createBrowserSupabase>["auth"]["signInWithPassword"]>> | null = null
    let networkFailed = false
    for (let attempt = 0; attempt < 3; attempt++) {
      networkFailed = false
      try {
        const sb = createBrowserSupabase()
        result = await sb.auth.signInWithPassword({ email: submitEmail, password: submitPassword })
      } catch {
        networkFailed = true
      }
      if (!networkFailed) break
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }

    try {
      if (networkFailed || !result || result.error || !result.data.session) {
        setError(
          networkFailed
            ? "เชื่อมต่อ Supabase ไม่ได้ ลองเช็คอินเทอร์เน็ต หรือเปิด Incognito window ดู"
            : (result?.error?.message ?? "อีเมลหรือรหัสผ่านไม่ถูกต้อง"),
        )
        setLoading(false)
        return
      }

      const { data } = result

      const dest = await landingPathFor(data.session.user.id)

      // Hard navigation, not router.push()/router.refresh(). A client-side
      // transition can be served from Next.js's Router Cache — a cached
      // pre-login render/redirect of the destination route, if one exists
      // from earlier in this tab's session — without necessarily forcing a
      // fresh middleware-checked request. window.location.href guarantees a
      // real top-level navigation: the browser sends the current cookie jar
      // (the one just written above) to the server fresh, no client cache in
      // the path at all. This is the documented Supabase pattern for
      // "client-side sign-in, then redirect to a protected route" — not a
      // setTimeout-based workaround.
      window.location.href = dest
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่ — ถ้ายังไม่ได้ ลองเปิด Incognito window หรือเช็คอินเทอร์เน็ต")
      setLoading(false)
    }
  }

  if (autoLoggingIn) {
    return (
      <div className="py-8 text-center text-sm text-stone-400">
        กำลังเข้าสู่ระบบอัตโนมัติ...
      </div>
    )
  }

  return (
    <form onSubmit={handleSignIn} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-stone-600 mb-1.5">Email</label>
        <input
          ref={emailInputRef}
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={loading}
          className="w-full text-sm border border-stone-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition bg-stone-50 disabled:opacity-50"
          placeholder="you@company.com"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-stone-600 mb-1.5">Password</label>
        <input
          ref={passwordInputRef}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={loading}
          className="w-full text-sm border border-stone-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition bg-stone-50 disabled:opacity-50"
          placeholder="••••••••"
        />
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

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "กำลังดำเนินการ..." : "Sign in"}
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
