'use client'

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"
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
  // Password visibility toggle (presentation only): toggles the input's `type`
  // attribute. The password value itself is never read/copied/rewritten here —
  // handleSignIn still reads the DOM value straight off passwordInputRef, so the
  // submitted credential is identical whether the field is shown or hidden.
  const [showPassword, setShowPassword] = useState(false)

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
    <form onSubmit={handleSignIn} className="space-y-5">
      <div>
        <label className="block text-sm font-semibold text-stone-600 mb-2">Email</label>
        <input
          ref={emailInputRef}
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={loading}
          className="w-full text-base rounded-xl px-4 py-3 bg-[#F7F4EF] border border-[#E3DACE] shadow-[inset_0_1px_2px_rgba(90,72,52,0.06)] transition hover:border-[#D5C8B6] focus:outline-none focus:border-[#B49C7C] focus:bg-white focus:ring-2 focus:ring-[#B49C7C]/25 disabled:opacity-50"
          placeholder="you@company.com"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-stone-600 mb-2">Password</label>
        <div className="relative">
          <input
            ref={passwordInputRef}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            disabled={loading}
            className="w-full text-base rounded-xl pl-4 pr-12 py-3 bg-[#F7F4EF] border border-[#E3DACE] shadow-[inset_0_1px_2px_rgba(90,72,52,0.06)] transition hover:border-[#D5C8B6] focus:outline-none focus:border-[#B49C7C] focus:bg-white focus:ring-2 focus:ring-[#B49C7C]/25 disabled:opacity-50"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            disabled={loading}
            aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
            aria-pressed={showPassword}
            title={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-stone-400 transition hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B49C7C]/40 disabled:opacity-40"
          >
            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {forbidden && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3.5 py-2.5">
          บัญชีนี้ไม่มีสิทธิ์เข้าถึงหน้าที่ขอ — ลองเข้าสู่ระบบด้วยบัญชีอื่น
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 rounded-xl bg-stone-900 text-white text-base font-semibold shadow-[0_2px_8px_-2px_rgba(70,58,44,0.28)] transition hover:bg-stone-800 hover:shadow-[0_5px_16px_-4px_rgba(70,58,44,0.30)] active:translate-y-[0.5px] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
      >
        {loading ? "กำลังดำเนินการ..." : "Sign in"}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#F0EBE5] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="bg-[#FDFBF8] rounded-2xl border border-[#E9E1D6] px-10 py-12 shadow-[0_2px_6px_-2px_rgba(96,78,58,0.10),0_22px_60px_-24px_rgba(96,78,58,0.30)]">
          <div className="mb-10 flex justify-center">
            {/* Official DNA OS master brand mark (D icon + wordmark).
                Source: DNA-OS-INFRASTRUCTURE connections/connection-registry/
                brand-assets/dna-os/dna-os-mark-d.png — Owner-provided official
                logo, PROVENANCE sha256 e48d08e6…4c55, allowed surfaces include
                "Owner / system identity". Copied byte-identical, never redrawn.
                The art sits at 692x244 +offset(167,383) inside a 1024x1024
                near-white (254,254,254) canvas, so object-cover/center trims
                only that invisible padding — the mark itself is unmodified. */}
            {/* No frame, no filter/glow: the asset is fully opaque with near-white
                padding baked in, so any CSS shadow would render a soft RECTANGLE
                around the whole 280x94 box (reads as a frame — explicitly not
                wanted). Dimension comes from sizing + spacing only. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/dna-os-mark-d.png"
              alt="DNA OS"
              width={280}
              height={94}
              className="h-[94px] w-[280px] object-cover object-center"
            />
          </div>

          <Suspense fallback={<div className="h-48 animate-pulse bg-stone-100 rounded-xl" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-8 text-center text-sm text-stone-400">
          DNA OS — Single Sign-On
        </p>
      </div>
    </div>
  )
}
