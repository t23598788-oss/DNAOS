import { requireAuthPage } from "@/core/auth/requireAuthPage"
import ChangePasswordForm from "./ChangePasswordForm"

// TWO entries, ONE flow, ONE verifier (M030, 2026-10-31):
//   ?first=1    — landed from /auth/confirm after the FIRST verified login
//                 (magic link / OAuth) while the account has no stored
//                 password yet. Setting a password here is what makes
//                 future logins work with Email + Password directly.
//   ?recovery=1 — landed from /auth/confirm on a "ลืมรหัสผ่าน" recovery link.
//                 Same page, same Supabase Auth API (updateUser), new password.
// Any authenticated user can reach this (ANY_AUTHENTICATED default). No new
// auth system: the password itself is stored by Supabase Auth (GoTrue) and
// this module never sees it — /api/account/password-state records only a
// timestamp afterward.
export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ first?: string; recovery?: string; next?: string }>
}) {
  const user = await requireAuthPage("/account/change-password")
  const sp = await searchParams
  const mode: "first" | "recovery" = sp.recovery === "1" ? "recovery" : "first"
  const next = sp.next && typeof sp.next === "string" ? sp.next : null

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-100 to-stone-200 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl px-8 py-10">
          <div className="mb-8">
            <div className="text-[10px] font-bold tracking-[0.2em] text-stone-400 uppercase mb-3">
              DNA OS
            </div>
            <h1 className="text-2xl font-bold text-stone-900 leading-tight">
              {mode === "recovery" ? "ตั้งรหัสผ่านใหม่" : "ตั้งรหัสผ่าน"}
            </h1>
            <p className="mt-2 text-xs text-stone-400">
              {mode === "recovery"
                ? `ยืนยันผ่านลิงก์กู้คืนแล้ว — ตั้งรหัสผ่านใหม่สำหรับ ${user.email}`
                : `ยืนยันตัวตนสำเร็จ — ตั้งรหัสผ่านสำหรับ ${user.email} เพื่อใช้ Email + Password เข้าสู่ระบบในครั้งต่อไป`}
            </p>
          </div>

          <ChangePasswordForm mode={mode} next={next} />
        </div>
      </div>
    </div>
  )
}
