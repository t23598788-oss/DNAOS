import { requireAuthPage } from "@/core/auth/requireAuthPage"
import ChangePasswordForm from "./ChangePasswordForm"

// Reached after the backup magic-link login (2026-07-14) — the account gets
// in via a passwordless link first, then sets a real password here. Any
// authenticated user can reach this (ANY_AUTHENTICATED default), not just
// the account that used the magic link.
export default async function ChangePasswordPage() {
  const user = await requireAuthPage("/account/change-password")

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-100 to-stone-200 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl px-8 py-10">
          <div className="mb-8">
            <div className="text-[10px] font-bold tracking-[0.2em] text-stone-400 uppercase mb-3">
              DNA OS
            </div>
            <h1 className="text-2xl font-bold text-stone-900 leading-tight">
              ตั้งรหัสผ่านใหม่
            </h1>
            <p className="mt-2 text-xs text-stone-400">
              เข้าสู่ระบบด้วยลิงก์สำรองแล้ว — ตั้งรหัสผ่านใหม่สำหรับ {user.email}
            </p>
          </div>

          <ChangePasswordForm />
        </div>
      </div>
    </div>
  )
}
