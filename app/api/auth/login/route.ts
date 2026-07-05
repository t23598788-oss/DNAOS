import { NextRequest, NextResponse } from "next/server"

const SESSION_COOKIE = "admin_session"
const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 วัน

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD

  if (!adminEmail || !adminPassword) {
    return NextResponse.json({ error: "ระบบยังไม่ได้ตั้งค่า ADMIN_EMAIL/ADMIN_PASSWORD" }, { status: 500 })
  }

  if (email !== adminEmail || password !== adminPassword) {
    return NextResponse.json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" }, { status: 401 })
  }

  // token = base64(email:timestamp) — ง่าย เพียงพอสำหรับ internal use
  const token = Buffer.from(`${email}:${Date.now()}`).toString("base64")

  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    path: "/",
    maxAge: SESSION_MAX_AGE,
    sameSite: "lax",
  })
  return res
}
