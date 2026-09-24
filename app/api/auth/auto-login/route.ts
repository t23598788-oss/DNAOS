import { NextResponse } from "next/server"

// RETIRED — single authentication flow (owner, 2026-09-24): authentication is
// now exactly ONE method — /login emails a Supabase magic link
// (supabase.auth.signInWithOtp) and /auth/confirm verifies it (verifyOtp) →
// session → /app role-bounce → workspace. This endpoint used a SECOND identity
// method (env ADMIN_PASSWORD ผ่าน password-grant) for the Tauri wrap; keeping
// any working alternative would violate "one way to prove who you are", so it
// permanently refuses every request (410) instead of staying dormant. Module
// file kept for the registry; its only caller (the Tauri auto-start effect in
// app/login/page.tsx) was removed in the same change. No password env is read
// here anymore — credentials never live in app config.
export function POST() {
  return NextResponse.json(
    {
      error: "เส้นทางนี้ถูกยกเลิก — ระบบใช้การยืนยันตัวตนทางอีเมลลิงก์เดียวที่ /login",
      code: "AUTH_PATH_RETIRED",
    },
    { status: 410 },
  );
}
