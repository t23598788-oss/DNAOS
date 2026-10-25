'use client'

import { Suspense, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { createBrowserSupabase } from "@/services/supabase/browser"
import { isSafeInternalPath } from "@/core/auth/resolveDestination"

// PUBLIC REGISTRATION (required re-add, 2026-10-24): the system is now
// officially customer-facing, and both middleware.ts and the DB trigger
// (supabase/migrations/20260927000001_identity_email_federation.sql —
// handle_new_user) already route every new auth signup to a `customer`
// profile row + /app role-bounce → /user. NO other system is created here:
// this page is the minimal missing front-end for Supabase Auth's own
// signUp, and email verification follows the ONE canonical path every
// other emailed link already uses: emailRedirectTo → /auth/confirm
// (verifyOtp, type=signup). OAuth providers stay one-click sign-ins on
// /login only (signInWithOAuth already creates accounts provider-side —
// there is no separate "register with Google" call to build).

function RegisterForm() {
  const searchParams = useSearchParams()
  const nextPath = searchParams.get("next")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const emailInputRef = useRef<HTMLInputElement>(null)
  const pwInputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const email = (emailInputRef.current?.value ?? "").trim()
    const password = pwInputRef.current?.value ?? ""
    if (!email || !password) {
      setError("กรุณากรอกอีเมลและรหัสผ่านให้ครบ")
      setLoading(false)
      return
    }
    if (password.length < 8) {
      setError("รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร")
      setLoading(false)
      return
    }

    // ?next= rides along on the emailed confirmation link; /auth/confirm
    // re-validates it server-side with the same isSafeInternalPath guard
    // that covers login redirects (defense-in-depth at the source).
    const safeNext = nextPath && isSafeInternalPath(nextPath) ? nextPath : null
    const redirectTo =
      `${window.location.origin}/auth/confirm?type=signup` +
      (safeNext ? `&next=${encodeURIComponent(safeNext)}` : "")

    try {
      const sb = createBrowserSupabase()
      const { data, error: signUpError } = await sb.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      })
      if (signUpError) {
        setError(signUpError.message)
        setLoading(false)
        return
      }
      // Two sanctioned outcomes, same canonical engine:
      //  - mailer_autoconfirm=false (this project): session is null → the
      //    email must be confirmed via /auth/confirm (type=signup) first.
      //  - autoconfirm ON: signUp returns a session immediately → the browser
      //    client has already persisted the cookies, so go to the destination.
      if (data.session) {
        window.location.href = safeNext ?? "/app"
        return
      }
      setSentTo(email)
      setLoading(false)
    } catch {
      setError("เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่")
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-semibold text-stone-600 mb-2">Email</label>
        <input
          ref={emailInputRef}
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={loading || !!sentTo}
          className="w-full text-base rounded-xl px-4 py-3 bg-[#F7F4EF] border border-[#E3DACE] shadow-[inset_0_1px_2px_rgba(90,72,52,0.06)] transition hover:border-[#D5C8B6] focus:outline-none focus:border-[#B49C7C] focus:bg-white focus:ring-2 focus:ring-[#B49C7C]/25 disabled:opacity-50"
          placeholder="you@company.com"
        />
      </div>
      <div>
        <label className="block text-sm font-semibold text-stone-600 mb-2">รหัสผ่าน</label>
        <input
          ref={pwInputRef}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          disabled={loading || !!sentTo}
          className="w-full text-base rounded-xl px-4 py-3 bg-[#F7F4EF] border border-[#E3DACE] focus:outline-none focus:border-[#B49C7C] focus:bg-white focus:ring-2 focus:ring-[#B49C7C]/25 disabled:opacity-50"
          placeholder="อย่างน้อย 8 ตัวอักษร"
        />
      </div>

      {sentTo && (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3.5 py-2.5">
          สมัครสำเร็จ — ระบบได้ส่งลิงก์ยืนยันไปที่ <b>{sentTo}</b> แล้ว
          เปิดอีเมลแล้วกด “ยืนยัน” เพื่อเข้าใช้งานครั้งแรก
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !!sentTo}
        className="w-full py-3.5 rounded-xl bg-stone-900 text-white text-base font-semibold shadow-[0_2px_8px_-2px_rgba(70,58,44,0.28)] transition hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "กำลังสมัคร..." : sentTo ? "สมัครแล้ว (ตรวจอีเมลได้)" : "สมัครสมาชิก"}
      </button>
      {sentTo && (
        <a href="/login" className="block w-full text-center text-sm text-stone-500 hover:text-stone-700">
          กลับไปหน้าเข้าสู่ระบบ
        </a>
      )}
    </form>
  )
}

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-[#F0EBE5] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="bg-[#FDFBF8] rounded-2xl border border-[#E9E1D6] px-10 py-12 shadow-[0_2px_6px_-2px_rgba(96,78,58,0.10),0_22px_60px_-24px_rgba(96,78,58,0.30)]">
          <div className="mb-10 flex justify-center">
            {/* Same official master brand mark /login uses — one identity,
                one brand, no second logo path. */}
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
            <RegisterForm />
          </Suspense>
        </div>
        <p className="mt-8 text-center text-sm text-stone-400">
          มีบัญชีอยู่แล้ว?{" "}
          <a href="/login" className="text-[#1e6fa8] hover:underline">
            เข้าสู่ระบบ
          </a>
        </p>
      </div>
    </div>
  )
}
