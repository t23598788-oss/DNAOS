import { NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { SESSION_COOKIE_MAX_AGE } from "@/services/supabase/browser"
import { resolveDestination } from "@/core/auth/resolveDestination"
import type { AppRole } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"

// Auto-login for the native desktop wrap (owner, 2026-07-30): "ล็อกอินกับ
// เครื่องเลย...ถ้าเป็นแอปพลิเคชั่น" — this is a single-owner system today
// (see feedback_single_owner_dev_phase_auth memory), running as a native app
// on the owner's own machine, not a public browser session someone else
// could open. ADMIN_EMAIL/ADMIN_PASSWORD (server-side only, never sent to
// the client) were already sitting in .env.local unused since the earlier
// signup-flow removal — this is their real purpose. Only ever called by
// app/login/page.tsx when it detects it's running inside the Tauri webview
// (window.__TAURI_INTERNALS__) — a normal browser tab still shows the real
// login form untouched.
export async function POST() {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) {
    return NextResponse.json({ error: "ADMIN_EMAIL/ADMIN_PASSWORD ไม่ได้ตั้งค่าไว้" }, { status: 500 })
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { maxAge: SESSION_COOKIE_MAX_AGE },
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    }
  )

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    return NextResponse.json({ error: error?.message ?? "เข้าสู่ระบบไม่สำเร็จ" }, { status: 401 })
  }

  const { data: profile } = await supabaseAdmin()
    .from("profiles").select("role").eq("id", data.session.user.id).single()
  const role = (profile?.role as AppRole) ?? "customer"

  return NextResponse.json({ ok: true, dest: resolveDestination(role, null) })
}
