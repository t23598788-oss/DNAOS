'use client'

import { useState, useEffect, useCallback } from "react"
import type { Session } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase/queries"
import type { CompanySettings } from "@/lib/config/company-settings"

const EMPTY_SETTINGS: CompanySettings = {
  companyName: "",
  companyTaxId: "",
  paymentBankName: "",
  paymentAccountNumber: "",
  paymentAccountName: "",
}

/**
 * แผงตั้งค่า — เปิดทับหน้าจอเดิม ไม่เปลี่ยนหน้า ไม่เปลี่ยนลิงก์
 * ต้อง login (Supabase Auth) ก่อนถึงจะแก้ไขได้ — สร้าง user แรกผ่าน Supabase Dashboard
 */
export default function SettingsDrawer() {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<Session | null | "loading">("loading")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loginMsg, setLoginMsg] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)

  const [settings, setSettings] = useState<CompanySettings>(EMPTY_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const loadSession = useCallback(async () => {
    const { data } = await supabase().auth.getSession()
    setSession(data.session)
  }, [])

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/admin/settings")
    const data = await res.json()
    if (data.settings) setSettings(data.settings)
    setSettingsLoaded(true)
  }, [])

  useEffect(() => {
    if (!open) return
    loadSession()
    loadSettings()
  }, [open, loadSession, loadSettings])

  useEffect(() => {
    const { data } = supabase().auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  async function login() {
    setLoggingIn(true)
    setLoginMsg(null)
    try {
      const { error } = await supabase().auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
      setPassword("")
    } catch (e: unknown) {
      setLoginMsg(e instanceof Error ? e.message : "เข้าสู่ระบบไม่สำเร็จ")
    } finally {
      setLoggingIn(false)
    }
  }

  async function logout() {
    await supabase().auth.signOut()
  }

  async function save() {
    if (session === "loading" || !session) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "บันทึกไม่สำเร็จ")
      setSaveMsg({ ok: true, text: "บันทึกแล้ว" })
    } catch (e: unknown) {
      setSaveMsg({ ok: false, text: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition"
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-stone-400" />
        <span className="flex-1 text-left">ตั้งค่า</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-stone-900/30" onClick={() => setOpen(false)} />
          <div className="relative w-[420px] max-w-full h-full bg-white shadow-xl flex flex-col">
            <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
              <div className="font-semibold text-stone-800">ตั้งค่าระบบ</div>
              <button onClick={() => setOpen(false)} className="text-stone-400 hover:text-stone-600 text-sm">ปิด ✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {session === "loading" && (
                <div className="text-center text-xs text-stone-400 py-8 animate-pulse">กำลังตรวจสอบสิทธิ์...</div>
              )}

              {session === null && (
                <div className="space-y-3">
                  <div className="text-xs text-stone-500">ต้องเข้าสู่ระบบก่อนแก้ไขข้อมูลบริษัท/บัญชีรับเงิน</div>
                  {loginMsg && <div className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600">{loginMsg}</div>}
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="อีเมล"
                    className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && login()}
                    placeholder="รหัสผ่าน"
                    className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
                  />
                  <button
                    onClick={login}
                    disabled={loggingIn || !email || !password}
                    className="w-full py-2.5 bg-stone-800 text-white rounded-xl text-sm font-semibold hover:bg-stone-700 disabled:opacity-40 transition"
                  >
                    {loggingIn ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
                  </button>
                </div>
              )}

              {session && session !== "loading" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-stone-500">
                    <span>เข้าสู่ระบบ: {session.user.email}</span>
                    <button onClick={logout} className="text-stone-400 hover:text-stone-700 underline">ออกจากระบบ</button>
                  </div>

                  {saveMsg && (
                    <div className={`text-xs px-3 py-1.5 rounded-lg ${saveMsg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                      {saveMsg.text}
                    </div>
                  )}

                  {!settingsLoaded ? (
                    <div className="text-center text-xs text-stone-400 py-8 animate-pulse">โหลด...</div>
                  ) : (
                    <>
                      <div>
                        <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">ข้อมูลบริษัท</div>
                        <div className="space-y-2">
                          <input
                            value={settings.companyName}
                            onChange={(e) => setSettings((s) => ({ ...s, companyName: e.target.value }))}
                            placeholder="ชื่อบริษัท"
                            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
                          />
                          <input
                            value={settings.companyTaxId}
                            onChange={(e) => setSettings((s) => ({ ...s, companyTaxId: e.target.value }))}
                            placeholder="เลขผู้เสียภาษี"
                            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">บัญชีรับเงิน</div>
                        <div className="space-y-2">
                          <input
                            value={settings.paymentBankName}
                            onChange={(e) => setSettings((s) => ({ ...s, paymentBankName: e.target.value }))}
                            placeholder="ชื่อธนาคาร"
                            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
                          />
                          <input
                            value={settings.paymentAccountNumber}
                            onChange={(e) => setSettings((s) => ({ ...s, paymentAccountNumber: e.target.value }))}
                            placeholder="เลขที่บัญชี"
                            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
                          />
                          <input
                            value={settings.paymentAccountName}
                            onChange={(e) => setSettings((s) => ({ ...s, paymentAccountName: e.target.value }))}
                            placeholder="ชื่อบัญชี"
                            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
                          />
                        </div>
                      </div>

                      <button
                        onClick={save}
                        disabled={saving}
                        className="w-full py-2.5 bg-stone-800 text-white rounded-xl text-sm font-semibold hover:bg-stone-700 disabled:opacity-40 transition"
                      >
                        {saving ? "กำลังบันทึก..." : "บันทึก"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
