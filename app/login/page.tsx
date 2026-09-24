'use client'

import { Suspense, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { createBrowserSupabase } from "@/services/supabase/browser"
import { isSafeInternalPath } from "@/core/auth/resolveDestination"

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

  // Canonical auth = "one identity, many providers" (owner, 2026-09-24):
  // Google / Apple / Microsoft buttons are PRIMARY (sign in with the account
  // already on the machine), email magic link is the fallback, and password
  // login survives ONLY inside an explicit maintenance/fallback section —
  // never the main path. All methods resolve through the SAME Supabase Auth
  // into the SAME user + profiles row (identity resolved by email — see
  // core/auth/session.ts#getAuthedUser + migration
  // 20260927000001_identity_email_federation.sql). No separate owner/admin/
  // developer logins; /auth/confirm is the ONE verifier for emailed links
  // and OAuth PKCE returns alike.
  // Surface ANY ?error= from the verifier — the old page only knew
  // "forbidden", so too_many_attempts/invalid_link/oauth_denied failed
  // SILENTLY (a real run had 10 login attempts look like "nothing happened").
  const urlError = searchParams.get("error")
  const initialError =
    urlError === "forbidden"
      ? "บัญชีนี้ไม่มีสิทธิ์เข้าถึงหน้าที่ขอ — ลองเข้าสู่ระบบด้วยบัญชีอื่น"
      : urlError === "too_many_attempts"
        ? "ระบบกันการยิงลิงก์ซ้ำ (5 ครั้ง/10 นาที) — รอสักครู่แล้วขอลิงก์ใหม่จากหน้านี้"
        : urlError === "invalid_link"
          ? "ลิงก์ไม่ถูกต้อง/หมดอายุ/ถูกใช้ไปแล้ว — กด “ส่งลิงก์ใหม่” ด้านล่างได้เลย (ลิงก์ใช้ได้1ครั้ง)"
          : urlError === "oauth_denied"
            ? "การเข้าสู่ระบบผ่าน provider ถูกยกเลิก หรือยังไม่ได้เปิดใช้งานใน Supabase Dashboard (Google/Apple/Microsoft)"
            : null

  const [error, setError] = useState<string | null>(initialError)
  const [loading, setLoading] = useState(false)
  const [oauthBusy, setOauthBusy] = useState<string | null>(null)
  const [pwLoading, setPwLoading] = useState(false)
  const [pwMaintenance, setPwMaintenance] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  // DOM refs so submit reads the actual input values, not React state — some
  // autofill mechanisms set value via the native setter, bypassing onChange.
  const emailInputRef = useRef<HTMLInputElement>(null)
  const pwInputRef = useRef<HTMLInputElement>(null)

  // Email magic-link action (fallback tier, same verifier): the link lands on
  // /auth/confirm (verifyOtp) → session → SAME isSafeInternalPath ?next= guard
  // → /app role-bounce → workspace. The identical emailed link is also the
  // recovery path.
  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const email = (emailInputRef.current?.value ?? "").trim()
    if (!email) {
      setError("กรุณากรอกอีเมล")
      setLoading(false)
      return
    }

    // ?next= rides along on the emailed link; /auth/confirm re-validates it
    // server-side with isSafeInternalPath and falls back to /app when unsafe.
    // Guard here too (defense-in-depth — the ONE next-guard, applied at source).
    const safeNext = nextPath && isSafeInternalPath(nextPath) ? nextPath : null
    const redirectTo = `${window.location.origin}/auth/confirm${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`

    // Silent auto-retry (owner, 2026-07-29, kept): a transient network-level
    // fetch failure shouldn't force a human to click again. Real Supabase
    // outages are alerted separately by supabase/functions/system-health-check.
    let result: Awaited<ReturnType<ReturnType<typeof createBrowserSupabase>["auth"]["signInWithOtp"]>> | null = null
    let networkFailed = false
    for (let attempt = 0; attempt < 3; attempt++) {
      networkFailed = false
      try {
        const sb = createBrowserSupabase()
        result = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })
      } catch {
        networkFailed = true
      }
      if (!networkFailed) break
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }

    if (networkFailed || !result || result.error) {
      setError(
        networkFailed
          ? "เชื่อมต่อ Supabase ไม่ได้ ลองเช็คอินเทอร์เน็ต หรือเปิด Incognito window ดู"
          : (result?.error?.message ?? "ส่งลิงก์ไม่สำเร็จ กรุณาลองใหม่"),
      )
      setLoading(false)
      return
    }

    setSentTo(email)
    setLoading(false)
  }

  // PRIMARY: provider sign-in (one identity, many providers). Supabase comes
  // back to /auth/confirm which exchangeCodeForSession()s the PKCE code
  // (Google/Apple/Microsoft) or verifyOtp()s a magic link — ONE verifier, one
  // safe-next guard, one /app role-bounce. The provider must be enabled in
  // Supabase Dashboard first; until then GoTrue returns an error and
  // ?error=oauth_denied is surfaced above (no silent failure).
  async function startOAuth(provider: "google" | "apple" | "azure") {
    setOauthBusy(provider)
    setError(null)
    try {
      const safeNext = nextPath && isSafeInternalPath(nextPath) ? nextPath : null
      const redirectTo = `${window.location.origin}/auth/confirm${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`
      const { error: oauthError } = await createBrowserSupabase().auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      })
      if (oauthError) {
        setError(oauthError.message)
        setOauthBusy(null)
      }
      // success = browser navigating away; keep busy until then
    } catch {
      setError("เชื่อมต่อไม่ได้ ลองใหม่ — หรือใช้ลิงก์อีเมลด้านล่างแทน")
      setOauthBusy(null)
    }
  }

  // MAINTENANCE/BACKFLOOR ONLY (explicit owner directive, 2026-09-24):
  // password sign-in stays reachable but gated behind its own toggle so it
  // is never the main path. Email comes from the single email field above
  // (no second email input → no duplicated autofill fields).
  async function handlePasswordFallback(e: React.FormEvent) {
    e.preventDefault()
    setPwLoading(true)
    setError(null)
    const email = (emailInputRef.current?.value ?? "").trim()
    const password = pwInputRef.current?.value ?? ""
    if (!email) {
      setError("กรอกอีเมลด้านบนก่อน แล้วค่อยกรอกรหัสผ่านตรงนี้")
      setPwLoading(false)
      return
    }
    try {
      const { data, error: pwError } = await createBrowserSupabase().auth.signInWithPassword({ email, password })
      if (pwError || !data.session) {
        setError(pwError?.message ?? "อีเมลหรือรหัสผ่านไม่ถูกต้อง")
        setPwLoading(false)
        return
      }
      window.location.href = nextPath && isSafeInternalPath(nextPath) ? nextPath : "/app"
    } catch {
      setError("เชื่อมต่อไม่ได้ ลองใหม่")
      setPwLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* PRIMARY — one identity, many providers: sign in with the account
          this device/browser already has (owner, 2026-09-24). */}
      <div className="space-y-3">
        <p className="text-center text-sm font-semibold text-stone-600">
          เข้าสู่ระบบด้วยบัญชีที่เครื่องมีอยู่แล้ว
        </p>
        <button
          type="button"
          onClick={() => startOAuth("google")}
          disabled={oauthBusy !== null || loading || pwLoading}
          className="w-full py-3 rounded-xl border border-[#E3DACE] bg-white text-base font-semibold text-stone-700 transition hover:border-[#D5C8B6] disabled:opacity-40"
        >
          {oauthBusy === "google" ? "กำลังเปิด Google..." : "Google"}
        </button>
        <button
          type="button"
          onClick={() => startOAuth("apple")}
          disabled={oauthBusy !== null || loading || pwLoading}
          className="w-full py-3 rounded-xl border border-[#E3DACE] bg-white text-base font-semibold text-stone-700 transition hover:border-[#D5C8B6] disabled:opacity-40"
        >
          {oauthBusy === "apple" ? "กำลังเปิด Apple..." : "Apple"}
        </button>
        <button
          type="button"
          onClick={() => startOAuth("azure")}
          disabled={oauthBusy !== null || loading || pwLoading}
          className="w-full py-3 rounded-xl border border-[#E3DACE] bg-white text-base font-semibold text-stone-700 transition hover:border-[#D5C8B6] disabled:opacity-40"
        >
          {oauthBusy === "azure" ? "กำลังเปิด Microsoft..." : "Microsoft"}
        </button>
      </div>

      <div className="flex items-center gap-3 text-xs text-stone-400">
        <div className="flex-1 h-px bg-[#E9E1D6]" />
        หรือ — ลิงก์อีเมล (สำรอง)
        <div className="flex-1 h-px bg-[#E9E1D6]" />
      </div>

      <form onSubmit={handleSendLink} className="space-y-5">
        <div>
          <label className="block text-sm font-semibold text-stone-600 mb-2">Email</label>
          <input
            ref={emailInputRef}
            name="email"
            type="email"
            /* WHATWG autofill: ฟอร์มล็อกอินใช้ token "username" (ตัวระบุล็อกอิน
               ซึ่งมักเป็นอีเมล) — "email" หมายถึงข้อมูลติดต่อใน profile
               ไม่ใช่ identifier ของ login form (Chrome/iCloud Keychain
               อ่านตาม token นี้) */
            autoComplete="username"
            required
            disabled={loading}
            className="w-full text-base rounded-xl px-4 py-3 bg-[#F7F4EF] border border-[#E3DACE] shadow-[inset_0_1px_2px_rgba(90,72,52,0.06)] transition hover:border-[#D5C8B6] focus:outline-none focus:border-[#B49C7C] focus:bg-white focus:ring-2 focus:ring-[#B49C7C]/25 disabled:opacity-50"
            placeholder="you@company.com"
          />
        </div>

        {sentTo && (
          <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3.5 py-2.5">
            ส่งลิงก์เข้าสู่ระบบไปที่ <b>{sentTo}</b> แล้ว — เปิดลิงก์ในอีเมลเพื่อเข้าใช้งาน
            (ลิงก์ชุดเดียวกันใช้ได้ทั้งเข้าสู่ระบบใหม่และกู้คืน ไม่ต้องจำรหัสผ่าน)
            · ไม่เห็นเมล? ตรวจโฟลเดอร์ Junk แล้วกด "ส่งลิงก์อีกครั้ง" ด้านล่าง
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
          {loading ? "กำลังส่งลิงก์..." : sentTo ? "ส่งลิงก์อีกครั้ง" : "ส่งลิงก์เข้าใช้งานทางอีเมล"}
        </button>
      </form>

      {/* MAINTENANCE / BACKFLOOR ONLY — password login never becomes the main
          path (owner, 2026-09-24). Email is reused from the field above. */}
      <div className="border-t border-[#E9E1D6] pt-3">
        {!pwMaintenance ? (
          <button
            type="button"
            onClick={() => setPwMaintenance(true)}
            className="w-full text-xs text-stone-400 transition hover:text-stone-600"
          >
            ลืมรหัสผ่าน / เข้าสู่ระบบด้วยรหัสผ่าน (สำหรับบำรุงรักษา)
          </button>
        ) : (
          <form onSubmit={handlePasswordFallback} className="space-y-4 pt-3">
            <p className="text-xs text-stone-500">
              ใช้อีเมลช่องด้านบน + รหัสผ่านเดิม — ทางนี้มีไว้ซ่อมบำรุงเท่านั้น ไม่ใช่ช่องหลัก
            </p>
            <input
              ref={pwInputRef}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={pwLoading}
              className="w-full text-base rounded-xl px-4 py-3 bg-[#F7F4EF] border border-[#E3DACE] focus:outline-none focus:border-[#B49C7C] focus:ring-2 focus:ring-[#B49C7C]/25 disabled:opacity-50"
              placeholder="••••••••"
            />
            <button
              type="submit"
              disabled={pwLoading}
              className="w-full py-2.5 rounded-xl border border-[#E3DACE] bg-white text-sm font-semibold text-stone-700 transition hover:border-[#D5C8B6] disabled:opacity-40"
            >
              {pwLoading ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบด้วยรหัสผ่าน"}
            </button>
          </form>
        )}
      </div>
    </div>
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
          <br />
          <a href="/install" className="mt-1 inline-block text-xs text-[#1e6fa8] hover:underline">
            วิธีติดตั้งแอปลงเครื่อง (iOS / Android / คอมพิวเตอร์)
          </a>
        </p>
      </div>
    </div>
  )
}
