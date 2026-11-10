'use client'

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { isAuthSessionMissingError } from "@supabase/supabase-js"
import { createBrowserSupabase } from "@/services/supabase/browser"
import { resolveIdentityContext } from "@/core/identity/identity"
import { isSafeInternalPath } from "@/core/auth/resolveDestination"

// The ONE login page for the whole system (TASK-001 SSO) — Admin, Business,
// Partner, and User Portal all redirect here when unauthenticated
// (middleware.ts), and all sign in against the same Supabase Auth session.
// The requested safe path is preserved; otherwise successful email OTP
// opens Workspace. Profile identity and all later data scopes remain enforced
// by the existing server-side auth and authority layers.
//
// Sign-in only, no sign-up (owner, 2026-07-29): during this single-owner
// development phase there is exactly one real account (dnaos.tech@gmail.com)
// and no public users are meant to reach this system at all yet. A visible
// "create account" toggle was pure surface area to get confused by (or land
// on by accident) while troubleshooting something unrelated — removed
// entirely rather than hidden behind a flag, since re-adding it later (once
// the system is actually customer-facing) is a small, deliberate change, not
// a regression risk today.

function getLoginDestination(nextPath: string | null): string {
  return nextPath && isSafeInternalPath(nextPath) ? nextPath : "/workspace"
}

function LoginForm() {
  const searchParams = useSearchParams()
  const nextPath = searchParams.get("next")

  // Email OTP uses the existing Supabase Auth identity and cookie session.
  // Provider callbacks remain supported by /auth/confirm for existing
  // identities; this page exposes only the email-code sign-in path.
  const urlError = searchParams.get("error")
  const initialError =
    urlError === "forbidden"
      ? "บัญชีนี้ไม่มีสิทธิ์เข้าถึงหน้าที่ขอ — ลองเข้าสู่ระบบด้วยบัญชีอื่น"
      : urlError === "too_many_attempts"
        ? "มีการยืนยันไม่สำเร็จหลายครั้ง — รอสักครู่แล้วลองใหม่"
        : urlError === "invalid_link"
          ? "รหัสหรือลิงก์ไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว — ขอรหัสใหม่ได้"
          : urlError === "oauth_denied"
            ? "การเข้าสู่ระบบผ่าน provider ถูกยกเลิก หรือยังไม่ได้เปิดใช้งานใน Supabase Dashboard (Google/Apple/Microsoft)"
            : null

  const [error, setError] = useState<string | null>(initialError)
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<"email" | "otp">("email")
  const [email, setEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [resendCooldown, setResendCooldown] = useState(0)

  // Reuse a valid session instead of requiring a new OTP. Supabase's
  // getUser() verifies the persisted cookie; profile resolution stays in the
  // existing Identity Layer before navigation.
  useEffect(() => {
    if (urlError === "forbidden") return;
    const sb = createBrowserSupabase();
    let disposed = false;
    let checking = false;
    const resume = async () => {
      if (checking || disposed) return;
      checking = true;
      try {
        const { data: { user }, error: authError } = await sb.auth.getUser();
        // "ยังไม่ login" ไม่ใช่ error: getUser() คืน AuthSessionMissingError (400)
        // ให้ทุกคนที่ยังไม่มี session ถ้า throw ตรงนี้ ผู้เยี่ยมชมหน้า login ทุกคน
        // จะเห็นแบนเนอร์แดง "ตรวจสอบบัญชีหรือสิทธิ์ไม่สำเร็จ" ทั้งที่ยังไม่ได้ทำอะไรผิด
        if (authError && !isAuthSessionMissingError(authError)) throw authError;
        if (!user || disposed) return;
        const identity = await resolveIdentityContext(user, async ({ field, value }) => {
          const { data, error } = await sb.from("profiles").select("id, role").eq(field, value).maybeSingle();
          if (error) throw error;
          return data;
        });
        if (disposed) return;
        if (!identity) {
          setError("ยืนยันบัญชีแล้ว แต่ยังไม่พบข้อมูลสิทธิ์ผู้ใช้ในระบบ กรุณาให้ผู้ดูแลตรวจบัญชี ไม่ต้องขอลิงก์ซ้ำ");
          return;
        }
        window.location.replace(getLoginDestination(nextPath));
      } catch {
        if (!disposed) setError("ตรวจสถานะบัญชีหรือสิทธิ์ไม่สำเร็จ ยังไม่สามารถเปิดพื้นที่ทำงานได้");
      } finally {
        checking = false;
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void resume(); };
    void resume();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [urlError, nextPath]);

  const emailInputRef = useRef<HTMLInputElement>(null)
  const otpInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === "otp") otpInputRef.current?.focus()
  }, [step])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setInterval(() => {
      setResendCooldown((remaining) => Math.max(0, remaining - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [resendCooldown])

  async function requestOtp(targetEmail: string): Promise<void> {
    const { error: requestError } = await createBrowserSupabase().auth.signInWithOtp({
      email: targetEmail,
      options: { shouldCreateUser: false },
    })
    if (requestError) {
      setError("ส่งรหัสไม่สำเร็จ หรือมีการขอรหัสถี่เกินไป กรุณารอสักครู่แล้วลองใหม่")
      return
    }
    setEmail(targetEmail)
    setOtp("")
    setResendCooldown(30)
    setError(null)
    setStep("otp")
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const targetEmail = (emailInputRef.current?.value ?? "").trim()
    if (!targetEmail) {
      setError("กรุณากรอกอีเมล")
      setLoading(false)
      return
    }

    try {
      await requestOtp(targetEmail)
    } catch {
      setError("เชื่อมต่อระบบยืนยันตัวตนไม่ได้ กรุณาลองใหม่")
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    const token = (otpInputRef.current?.value ?? otp).replace(/\D/g, "").slice(0, 6)
    if (!/^\d{6}$/.test(token)) {
      setError("กรอกรหัส OTP 6 หลัก")
      return
    }

    setLoading(true)
    setError(null)

    try {
      const supabase = createBrowserSupabase()
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "email",
      })
      if (verifyError || !data.session || !data.user) {
        setError("รหัส OTP ไม่ถูกต้องหรือหมดอายุ กรุณาตรวจรหัสแล้วลองใหม่")
        return
      }

      const { data: { user }, error: sessionError } = await supabase.auth.getUser()
      if (sessionError || !user || user.id !== data.user.id) {
        setError("ยืนยันรหัสแล้วแต่ตรวจสอบ Session ไม่สำเร็จ กรุณาลองใหม่")
        return
      }

      const identity = await resolveIdentityContext(user, async ({ field, value }) => {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, role")
          .eq(field, value)
          .maybeSingle()
        if (profileError) throw profileError
        return profile
      })
      if (!identity) {
        setError("ยืนยันตัวตนแล้ว แต่ไม่พบข้อมูลสิทธิ์ผู้ใช้ กรุณาติดต่อผู้ดูแลระบบ")
        return
      }

      window.location.replace(getLoginDestination(nextPath))
    } catch {
      setError("ยืนยันรหัส OTP ไม่สำเร็จ กรุณาตรวจรหัสแล้วลองใหม่")
    } finally {
      setLoading(false)
    }
  }

  async function handleResendOtp() {
    if (loading || resendCooldown > 0) return
    setLoading(true)
    try {
      await requestOtp(email)
    } catch {
      setError("ส่งรหัสไม่สำเร็จ กรุณารอสักครู่แล้วลองใหม่")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {step === "email" ? (
        <form onSubmit={handleSendOtp} className="space-y-5">
          <div>
            <label htmlFor="login-email" className="block text-sm font-semibold text-stone-600 mb-2">
              อีเมล
            </label>
            <input
              ref={emailInputRef}
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              disabled={loading}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full text-base rounded-xl px-4 py-3 bg-[#F7F4EF] border border-[#E3DACE] shadow-[inset_0_1px_2px_rgba(90,72,52,0.06)] transition hover:border-[#D5C8B6] focus:outline-none focus:border-[#B49C7C] focus:bg-white focus:ring-2 focus:ring-[#B49C7C]/25 disabled:opacity-50"
              placeholder="you@company.com"
            />
          </div>

          {error && (
            <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-stone-900 text-white text-base font-semibold shadow-[0_2px_8px_-2px_rgba(70,58,44,0.28)] transition hover:bg-stone-800 hover:shadow-[0_5px_16px_-4px_rgba(70,58,44,0.30)] active:translate-y-[0.5px] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {loading ? "กำลังส่งรหัส..." : "ส่งรหัส OTP"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-5">
          <p className="text-center text-sm text-stone-600">
            กรอกรหัส 6 หลักที่ส่งไปยัง <b>{email}</b>
          </p>
          <div>
            <label htmlFor="login-otp" className="block text-sm font-semibold text-stone-600 mb-2">
              รหัส OTP
            </label>
            <input
              ref={otpInputRef}
              id="login-otp"
              name="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              disabled={loading}
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full text-center text-2xl tracking-[0.5em] font-semibold rounded-xl px-4 py-3 bg-[#F7F4EF] border border-[#E3DACE] focus:outline-none focus:border-[#B49C7C] focus:bg-white focus:ring-2 focus:ring-[#B49C7C]/25 disabled:opacity-50"
              placeholder="••••••"
              aria-describedby="otp-help"
            />
            <p id="otp-help" className="mt-2 text-xs text-stone-500">
              วางรหัสจากอีเมลได้ รหัสจะไม่ถูกบันทึกหลังออกจากหน้านี้
            </p>
          </div>

          {error && (
            <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="w-full py-3.5 rounded-xl bg-stone-900 text-white text-base font-semibold shadow-[0_2px_8px_-2px_rgba(70,58,44,0.28)] transition hover:bg-stone-800 hover:shadow-[0_5px_16px_-4px_rgba(70,58,44,0.30)] active:translate-y-[0.5px] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {loading ? "กำลังตรวจสอบ..." : "ยืนยันและเข้า Workspace"}
          </button>

          <div className="flex items-center justify-between gap-4 text-sm">
            <button
              type="button"
              onClick={() => {
                setStep("email")
                setOtp("")
                setError(null)
                setResendCooldown(0)
              }}
              disabled={loading}
              className="text-stone-500 underline underline-offset-2 disabled:opacity-50"
            >
              เปลี่ยนอีเมล
            </button>
            <button
              type="button"
              onClick={handleResendOtp}
              disabled={loading || resendCooldown > 0}
              className="text-stone-700 underline underline-offset-2 disabled:text-stone-400 disabled:no-underline"
            >
              {loading ? "กำลังส่ง..." : resendCooldown > 0 ? `ส่งรหัสอีกครั้งใน ${resendCooldown} วินาที` : "ส่งรหัสอีกครั้ง"}
            </button>
          </div>
        </form>
      )}

      <p className="text-center text-xs text-stone-400">
        เข้าสู่ระบบด้วยรหัสยืนยันอีเมล — ระบบเดิมของ DNA OS
      </p>
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
          <a href="/register" className="mt-1 inline-block text-sm text-[#1e6fa8] hover:underline">
            ยังไม่มีบัญชี? สมัครสมาชิก
          </a>
          <a href="/install" className="mt-1 inline-block text-xs text-[#1e6fa8] hover:underline">
            วิธีติดตั้งแอปลงเครื่อง (iOS / Android / คอมพิวเตอร์)
          </a>
        </p>
      </div>
    </div>
  )
}
