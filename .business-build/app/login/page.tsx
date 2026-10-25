'use client'

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { createBrowserSupabase } from "@/services/supabase/browser"
import { resolveIdentityContext } from "@/core/identity/identity"
import { isSafeInternalPath } from "@/core/auth/resolveDestination"

// THE ONE login page for the whole system (TASK-001 SSO): Admin, Business,
// Partner, and User Portal all redirect here when unauthenticated
// (middleware.ts), and every method resolves through the SAME Supabase Auth
// session into the SAME profiles row (core/auth/session.ts + Identity Layer).
//
// LOGIN RESTORED (owner, 2026-10-18): the visual contract is the Browse AI
// login reference — one centred card, logo, email field, 6-digit email OTP,
// confirm button, then real provider buttons (Google / Apple ID / GitHub).
// No icon wall, no second auth system:
//   Email → signInWithOtp → 6-digit code → verifyOtp(type:"email") → session
//   → /app role-bounce (resolveDestination) → /workspace → chat home
// Provider buttons are rendered ONLY when Supabase reports the provider as
// enabled (/api/auth/providers reads the live /auth/v1/settings response).
// Choosing a provider never assigns a role: identity/role/tenant are still
// read from the existing profiles + org_members authorities after sign-in.
//
// Email magic links stay valid (the same signInWithOtp call can email a
// link); /auth/confirm remains the ONE link verifier. The OTP field is the
// primary path requested by the owner, not an additional auth system.
//
// Sign-in only, no sign-up: during the single-owner phase there is one real
// account and no public users are meant to reach this system yet.

type ProviderId = "google" | "apple" | "azure" | "github"

const PROVIDERS: {
  id: ProviderId
  label: string
  action: string
  logo: string
}[] = [
  { id: "google", label: "Google", action: "ดำเนินการต่อด้วย Google", logo: "/brand/providers/google.svg" },
  { id: "apple", label: "Apple ID", action: "ดำเนินการต่อด้วย Apple ID", logo: "/brand/providers/apple.svg" },
  // Kept in the supported map for the existing auth contract; rendered only
  // when Supabase reports `external.azure=true` (currently disabled).
  { id: "azure", label: "Microsoft", action: "ดำเนินการต่อด้วย Microsoft", logo: "/brand/providers/microsoft.svg" },
  { id: "github", label: "GitHub", action: "ดำเนินการต่อด้วย GitHub", logo: "/brand/providers/github.svg" },
]

// Supabase issues a numeric email OTP. This repo's config sets otp_length = 6
// (supabase/config.toml), but the HOSTED project's live `mailer_otp_length` is
// authoritative and is not exposed by /auth/v1/settings — a live check
// (2026-10-18) showed an 8-digit code, so the field accepts the digit count the
// project actually sends (6–8) instead of locking a truncated 6.
const OTP_MIN_LENGTH = 6
const OTP_MAX_LENGTH = 8
// Matches Supabase's minimum resend interval for the email provider. This is
// UX only; the server still enforces its own rate limit.
const RESEND_COOLDOWN_SECONDS = 60

function LoginForm() {
  const searchParams = useSearchParams()
  const nextPath = searchParams.get("next")

  // Surface ANY ?error= from the verifier — the old page only knew
  // "forbidden", so too_many_attempts/invalid_link/oauth_denied failed
  // SILENTLY (a real run had 10 login attempts look like "nothing happened").
  const urlError = searchParams.get("error")
  const initialError =
    urlError === "forbidden"
      ? "บัญชีนี้ไม่มีสิทธิ์เข้าถึงหน้าที่ขอ — ลองเข้าสู่ระบบด้วยบัญชีอื่น"
      : urlError === "too_many_attempts"
        ? "ระบบกันการยิงรหัสซ้ำ (5 ครั้ง/10 นาที) — รอสักครู่แล้วขอลิงก์ใหม่จากหน้านี้"
        : urlError === "invalid_link"
          ? "ลิงก์หรือรหัสไม่ถูกต้อง/หมดอายุ/ถูกใช้ไปแล้ว — กด “ส่งรหัสอีกครั้ง” ด้านล่างได้เลย"
          : urlError === "oauth_denied"
            ? "การเข้าสู่ระบบผ่าน provider ถูกยกเลิก หรือยังไม่ได้เปิดใช้งานใน Supabase Dashboard"
            : null

  const [error, setError] = useState<string | null>(initialError)
  const [step, setStep] = useState<"email" | "otp">("email")
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [otp, setOtp] = useState("")
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [oauthBusy, setOauthBusy] = useState<string | null>(null)
  const [pwLoading, setPwLoading] = useState(false)
  const [pwMaintenance, setPwMaintenance] = useState(false)
  const [enabledProviders, setEnabledProviders] = useState<ProviderId[] | null>(null)

  // Provider availability comes from the LIVE Supabase auth settings, never a
  // guessed list — an unconfigured provider is not rendered at all.
  useEffect(() => {
    let alive = true
    fetch("/api/auth/providers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((data: { providers?: string[] }) => {
        if (!alive) return
        const ids = PROVIDERS.map((p) => p.id)
        setEnabledProviders(
          Array.isArray(data.providers)
            ? (data.providers.filter((p): p is ProviderId => ids.includes(p as ProviderId)))
            : [],
        )
      })
      .catch(() => {
        if (alive) setEnabledProviders([])
      })
    return () => {
      alive = false
    }
  }, [])

  // Recheck on return from the email/browser tab. Never mint a session here;
  // /app still resolves the destination and enforces server-side authority.
  useEffect(() => {
    if (urlError === "forbidden") return
    const sb = createBrowserSupabase()
    let disposed = false
    let checking = false
    const resume = async () => {
      if (checking || disposed) return
      checking = true
      try {
        const { data: { user } } = await sb.auth.getUser()
        if (!user || disposed) return
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
        window.location.replace("/app");
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
  }, [urlError]);

  // DOM refs so submit reads the actual input values, not React state — some
  // autofill mechanisms set value via the native setter, bypassing onChange.
  const emailInputRef = useRef<HTMLInputElement>(null)
  const pwInputRef = useRef<HTMLInputElement>(null)
  const otpInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === "otp") otpInputRef.current?.focus()
  }, [step])

  // Supabase resend cooldown (UI mirror of the server limit).
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  // Email step: send the 6-digit OTP through the SAME Supabase Auth call the
  // system already uses. The redirect target keeps the emailed magic link
  // working through /auth/confirm; the code is verified in-app below.
  async function sendOtp(email: string): Promise<boolean> {
    setLoading(true)
    setError(null)

    // ?next= rides along on the emailed link; /auth/confirm re-validates it
    // server-side with isSafeInternalPath and falls back to /app when unsafe.
    // Guard here too (defense-in-depth — the ONE next-guard, applied at source).
    const safeNext = nextPath && isSafeInternalPath(nextPath) ? nextPath : null
    const redirectTo = `${window.location.origin}/auth/confirm${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`

    // Silent auto-retry (owner, 2026-07-29, kept): a transient network-level
    // fetch failure shouldn't force a human to click again.
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
          : (result?.error?.message ?? "ส่งรหัสไม่สำเร็จ กรุณาลองใหม่"),
      )
      setLoading(false)
      return false
    }

    setSentTo(email)
    setOtp("")
    setCooldown(RESEND_COOLDOWN_SECONDS)
    setStep("otp")
    setLoading(false)
    return true
  }

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault()
    const email = (emailInputRef.current?.value ?? "").trim()
    if (!email) {
      setError("กรุณากรอกอีเมล")
      return
    }
    await sendOtp(email)
  }

  // OTP step: verify the 6-digit code with Supabase Auth, then let the ONE
  // server-side identity/role/tenant authorities decide where the session may
  // land (/app role-bounce → /workspace → chat home).
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    if (!sentTo) {
      setStep("email")
      return
    }
    const code = otp.trim()
    if (!new RegExp(`^\\d{${OTP_MIN_LENGTH},${OTP_MAX_LENGTH}}$`).test(code)) {
      setError(`กรุณากรอกรหัสจากอีเมลให้ครบ (${OTP_MIN_LENGTH} หลักขึ้นไป)`)
      return
    }
    setVerifying(true)
    setError(null)
    try {
      const sb = createBrowserSupabase()
      const { data, error: verifyError } = await sb.auth.verifyOtp({ email: sentTo, token: code, type: "email" })
      if (verifyError || !data.session) {
        const message = verifyError?.message ?? ""
        setError(
          /expired/i.test(message)
            ? "รหัส OTP หมดอายุแล้ว — กด “ส่งรหัสอีกครั้ง” ด้านล่าง"
            : /rate|too many/i.test(message)
              ? "ลองผิดหลายครั้งเกินไป — รอสักครู่แล้วขอลิงก์ใหม่"
              : "รหัส OTP ไม่ถูกต้อง — ตรวจตัวเลข 6 หลักในอีเมลอีกครั้ง",
        )
        setVerifying(false)
        return
      }

      const user = data.user
      if (!user) {
        setError("ยืนยันรหัสแล้ว แต่ไม่พบผู้ใช้ในระบบ — กรุณาลองใหม่")
        setVerifying(false)
        return
      }
      // Same Identity Layer as server-side getAuthedUser; never mint a role here.
      const identity = await resolveIdentityContext(user, async ({ field, value }) => {
        const { data: row, error: profileError } = await sb.from("profiles").select("id, role").eq(field, value).maybeSingle()
        if (profileError) throw profileError
        return row
      })
      if (!identity) {
        await sb.auth.signOut().catch(() => {})
        setError("ยืนยันรหัสแล้ว แต่ยังไม่พบสิทธิ์ผู้ใช้ในระบบ กรุณาให้ผู้ดูแลตรวจบัญชี")
        setVerifying(false)
        return
      }

      window.location.assign(nextPath && isSafeInternalPath(nextPath) ? nextPath : "/app")
    } catch {
      setError("เชื่อมต่อไม่ได้ ลองใหม่")
      setVerifying(false)
    }
  }

  // Provider sign-in (only rendered for providers Supabase reports as
  // enabled). Supabase returns to /auth/confirm, which exchanges the PKCE code
  // and applies the SAME safe-next guard. The provider never grants a role.
  async function startOAuth(provider: ProviderId) {
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
      setError("เชื่อมต่อไม่ได้ ลองใหม่ — หรือใช้รหัสทางอีเมลด้านบนแทน")
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
    setStep("email")
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
      window.location.assign(nextPath && isSafeInternalPath(nextPath) ? nextPath : "/app")
    } catch {
      setError("เชื่อมต่อไม่ได้ ลองใหม่")
      setPwLoading(false)
    }
  }

  const providers = (enabledProviders ?? []).map((id) => PROVIDERS.find((p) => p.id === id)!).filter(Boolean)
  const busy = oauthBusy !== null || loading || verifying || pwLoading
  const openingLabel = PROVIDERS.find((p) => p.id === oauthBusy)?.label

  return (
    <div>
      <div className="mb-4 flex justify-center sm:mb-5 [@media(max-height:520px)_and_(orientation:landscape)]:mb-1">
        {/* Official DNA OS brand mark (Owner-provided, byte-identical —
            see public/brand/dna-os-mark-d.png). Never recoloured. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/dna-os-mark-d.png"
          alt="DNA OS"
          width={280}
          height={94}
          className="h-[46px] w-[137px] object-cover object-center sm:h-[54px] sm:w-[161px] [@media(max-height:520px)_and_(orientation:landscape)]:h-[38px] [@media(max-height:520px)_and_(orientation:landscape)]:w-[113px]"
        />
      </div>

      <div className="mb-4 text-center sm:mb-5 [@media(max-height:520px)_and_(orientation:landscape)]:mb-1">
        <h1 className="text-base font-bold text-stone-800 sm:text-lg">เข้าสู่ระบบ DNA OS</h1>
        <p className="mt-1 text-[11px] leading-relaxed text-stone-500 sm:text-xs [@media(max-height:520px)_and_(orientation:landscape)]:hidden">
          {step === "email" ? "ใช้อีเมลของคุณเพื่อรับรหัสยืนยันทางอีเมล" : "กรอกรหัสจากอีเมลเพื่อเข้าสู่ระบบ"}
        </p>
      </div>

      {step === "email" ? (
        <form onSubmit={handleSendLink} className="space-y-2.5">
          <label htmlFor="login-email" className="block text-xs font-semibold text-stone-600">
            อีเมล
          </label>
          <input
            id="login-email"
            ref={emailInputRef}
            name="email"
            type="email"
            /* WHATWG autofill: ฟอร์มล็อกอินใช้ token "username" (ตัวระบุล็อกอิน
               ซึ่งมักเป็นอีเมล) — "email" หมายถึงข้อมูลติดต่อใน profile
               ไม่ใช่ identifier ของ login form */
            autoComplete="username"
            required
            disabled={loading}
            className="w-full rounded-xl border border-[#E3DACE] bg-[#F7F4EF] px-3.5 py-2.5 text-base shadow-[inset_0_1px_2px_rgba(90,72,52,0.06)] transition hover:border-[#D5C8B6] focus:border-[#B49C7C] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#B49C7C]/25 disabled:opacity-50 sm:text-sm [@media(max-height:520px)_and_(orientation:landscape)]:py-2"
            placeholder="you@company.com"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-stone-900 py-2.5 text-sm font-semibold text-white shadow-[0_2px_8px_-2px_rgba(70,58,44,0.28)] transition hover:bg-stone-800 active:translate-y-[0.5px] disabled:cursor-not-allowed disabled:opacity-40 sm:py-3 [@media(max-height:520px)_and_(orientation:landscape)]:py-2"
          >
            {loading ? "กำลังส่งรหัส..." : "ส่งรหัส OTP"}
          </button>
          <p className="text-center text-[10px] leading-relaxed text-stone-400 sm:text-[11px] [@media(max-height:520px)_and_(orientation:landscape)]:hidden">
            ระบบจะส่งรหัส OTP ไปที่อีเมล — รหัสใช้ได้ครั้งเดียวและมีวันหมดอายุ
          </p>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-2.5">
          <div className="rounded-lg border border-[#E9E1D6] bg-[#F7F4EF] px-3 py-2 text-center text-[11px] leading-relaxed text-stone-600 sm:text-xs [@media(max-height:520px)_and_(orientation:landscape)]:px-2 [@media(max-height:520px)_and_(orientation:landscape)]:py-1 [@media(max-height:520px)_and_(orientation:landscape)]:text-[10px]">
            ส่งรหัส OTP ไปที่ <b>{sentTo}</b> แล้ว — เปิดอีเมลเพื่อดูรหัส
            <br />
            ถ้าอีเมลมีปุ่มยืนยัน สามารถกดลิงก์นั้นแทนได้
          </div>
          <label htmlFor="login-otp" className="block text-xs font-semibold text-stone-600">
            รหัส OTP จากอีเมล
          </label>
          <input
            id="login-otp"
            ref={otpInputRef}
            name="otp"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6,8}"
            maxLength={OTP_MAX_LENGTH}
            autoComplete="one-time-code"
            required
            disabled={verifying}
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, OTP_MAX_LENGTH))}
            className="w-full rounded-xl border border-[#E3DACE] bg-[#F7F4EF] px-3.5 py-2.5 text-center font-mono text-xl tracking-[0.45em] text-stone-800 shadow-[inset_0_1px_2px_rgba(90,72,52,0.06)] transition hover:border-[#D5C8B6] focus:border-[#B49C7C] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#B49C7C]/25 disabled:opacity-50 [@media(max-height:520px)_and_(orientation:landscape)]:py-1.5 [@media(max-height:520px)_and_(orientation:landscape)]:text-lg"
            placeholder="______"
            title="กรอกรหัสตัวเลขจากอีเมล (6 หลัก หรือตามที่ระบบส่งจริง)"
            aria-describedby="otp-hint"
          />
          <button
            type="submit"
            disabled={verifying || loading || otp.length < OTP_MIN_LENGTH}
            className="w-full rounded-xl bg-stone-900 py-2.5 text-sm font-semibold text-white shadow-[0_2px_8px_-2px_rgba(70,58,44,0.28)] transition hover:bg-stone-800 active:translate-y-[0.5px] disabled:cursor-not-allowed disabled:opacity-40 sm:py-3 [@media(max-height:520px)_and_(orientation:landscape)]:py-2"
          >
            {verifying ? "กำลังยืนยัน..." : "ยืนยันเข้าสู่ระบบ"}
          </button>
          <div className="flex items-center justify-between gap-2 pt-0.5 [@media(max-height:520px)_and_(orientation:landscape)]:pt-0">
            <button
              type="button"
              onClick={() => {
                setStep("email")
                setOtp("")
                setError(null)
              }}
              className="text-[10px] text-stone-500 transition hover:text-stone-700 sm:text-[11px]"
            >
              เปลี่ยนอีเมล
            </button>
            <button
              type="button"
              disabled={loading || cooldown > 0}
              onClick={() => {
                if (sentTo) void sendOtp(sentTo)
              }}
              className="text-[10px] text-[#1e6fa8] transition hover:underline disabled:cursor-not-allowed disabled:text-stone-400 disabled:no-underline sm:text-[11px]"
            >
              {loading ? "กำลังส่ง..." : cooldown > 0 ? `ส่งรหัสอีกครั้ง (${cooldown}s)` : "ส่งรหัสอีกครั้ง"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div role="alert" className="mt-2.5 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-600 sm:text-sm">
          {error}
        </div>
      )}

      {openingLabel && (
        <p role="status" aria-live="polite" className="mt-2 text-center text-[11px] text-stone-500">
          กำลังเปิด {openingLabel}…
        </p>
      )}

      {/* Providers: only what Supabase actually has enabled. Full-width rows
          with the real provider marks — no large icon grid. */}
      {providers.length > 0 && (
        <div className="mt-4">
          <div className="mb-3 flex items-center gap-2 text-[10px] text-stone-400 sm:text-[11px]">
            <div className="h-px flex-1 bg-[#E9E1D6]" />
            หรือดำเนินการต่อด้วย
            <div className="h-px flex-1 bg-[#E9E1D6]" />
          </div>
          <div className="space-y-2">
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => startOAuth(provider.id)}
                disabled={busy}
                aria-label={provider.action}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-[#E3DACE] bg-white py-2.5 text-sm font-medium text-stone-700 transition hover:border-[#C9B9A4] hover:bg-[#FCFAF7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B49C7C]/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={provider.logo} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
                {provider.action}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* MAINTENANCE / BACKFLOOR ONLY — password login never becomes the main
          path (owner, 2026-09-24). Email is reused from the field above. */}
      {step === "email" && (
        <div className="mt-3 border-t border-[#E9E1D6] pt-2 [@media(max-height:520px)_and_(orientation:landscape)]:hidden">
          {!pwMaintenance ? (
            <button
              type="button"
              onClick={() => {
                setPwMaintenance(true)
                setError(null)
              }}
              className="w-full text-[10px] text-stone-400 transition hover:text-stone-600 sm:text-[11px]"
            >
              ลืมรหัสผ่าน / เข้าสู่ระบบด้วยรหัสผ่าน (สำหรับบำรุงรักษา)
            </button>
          ) : (
            <form onSubmit={handlePasswordFallback} className="space-y-2 pt-1">
              <p className="text-[10px] text-stone-500 sm:text-[11px]">
                ใช้อีเมลช่องด้านบน + รหัสผ่านเดิม — ทางนี้มีไว้ซ่อมบำรุงเท่านั้น
              </p>
              <input
                ref={pwInputRef}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={pwLoading}
                className="w-full rounded-xl border border-[#E3DACE] bg-[#F7F4EF] px-3.5 py-2.5 text-base focus:border-[#B49C7C] focus:outline-none focus:ring-2 focus:ring-[#B49C7C]/25 disabled:opacity-50 sm:text-sm"
                placeholder="••••••••"
              />
              <button
                type="submit"
                disabled={pwLoading}
                className="w-full rounded-xl border border-[#E3DACE] bg-white py-2 text-xs font-semibold text-stone-700 transition hover:border-[#D5C8B6] disabled:opacity-40"
              >
                {pwLoading ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบด้วยรหัสผ่าน"}
              </button>
            </form>
          )}
        </div>
      )}

      <p className="mt-3 text-center text-[9px] leading-relaxed text-stone-400 sm:text-[10px] [@media(max-height:520px)_and_(orientation:landscape)]:hidden">
        การเลือกผู้ให้บริการไม่ได้กำหนดสิทธิ์ — ระบบอ่านสิทธิ์จากบัญชีที่ยืนยันแล้วเท่านั้น
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    // LOCKED VIEWPORT: fixed to the visible viewport, no document scroll in
    // either axis. The card scrolls internally with the scrollbar hidden only
    // as a last resort on very short screens, so no field is clipped.
    <div className="fixed inset-0 flex h-[100dvh] w-full items-center justify-center overflow-hidden overscroll-none bg-[#F0EBE5] px-3 py-3 sm:px-6 sm:py-6">
      <div className="w-full max-w-[400px]">
        <div className="max-h-[calc(100dvh-1.5rem)] w-full overflow-y-auto overflow-x-hidden rounded-2xl border border-[#E9E1D6] bg-[#FDFBF8] px-5 py-6 shadow-[0_2px_6px_-2px_rgba(96,78,58,0.10),0_22px_60px_-24px_rgba(96,78,58,0.30)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-8 sm:py-8 [@media(max-height:520px)_and_(orientation:landscape)]:px-4 [@media(max-height:520px)_and_(orientation:landscape)]:py-3">
          <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-stone-100" />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>

      <p className="absolute inset-x-0 bottom-1.5 text-center text-[10px] text-stone-400 [@media(max-height:520px)_and_(orientation:landscape)]:hidden sm:text-xs">
        DNA OS — Single Sign-On
        <br />
        <a href="/install" className="mt-0.5 inline-block text-[10px] text-[#1e6fa8] hover:underline sm:text-xs">
          วิธีติดตั้งแอปลงเครื่อง (iOS / Android / คอมพิวเตอร์)
        </a>
      </p>
    </div>
  )
}
