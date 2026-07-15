'use client'

import { useState, useEffect, useCallback } from "react"
import type { CompanySettings } from "@/core/config/company-settings"

const EMPTY_SETTINGS: CompanySettings = {
  companyName: "",
  companyTaxId: "",
  paymentBankName: "",
  paymentAccountNumber: "",
  paymentAccountName: "",
  vatRate: 0.07,
  documentTerms: "",
  documentFooterNote: "",
  debtReminderAutoEnabled: false,
  debtReminderHour: 9,
}

/**
 * แผงตั้งค่า — เปิดทับหน้าจอเดิม ไม่เปลี่ยนหน้า ไม่เปลี่ยนลิงก์
 * ใช้ Session เดียวกับทั้งระบบ (TASK-001 SSO) — ไม่มี login ของตัวเอง
 * ถูกเรียกจากในหน้าที่ requireAuthPage ป้องกันไว้แล้วเท่านั้น (เช่น /admin)
 */
export default function SettingsDrawer({ onSettingsLoaded }: { onSettingsLoaded?: (settings: CompanySettings) => void }) {
  const [open, setOpen] = useState(false)

  const [settings, setSettings] = useState<CompanySettings>(EMPTY_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Owner request 2026-07-11: Automation Engine status (debt-reminder auto-
  // send on/off + hour) needs to be visible on the main workspace without
  // opening this drawer — reuses this same fetch instead of a second one.
  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/admin/settings")
    const data = await res.json()
    if (data.settings) {
      setSettings(data.settings)
      onSettingsLoaded?.(data.settings)
    }
    setSettingsLoaded(true)
  }, [onSettingsLoaded])

  useEffect(() => {
    if (!open) return
    loadSettings()
  }, [open, loadSettings])

  // Load once on mount (regardless of drawer open state) so onSettingsLoaded
  // can feed the always-visible automation status pill without requiring the
  // owner to open this drawer first.
  useEffect(() => {
    loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
              <div className="space-y-4">
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

                    <div>
                      <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">ภาษี / ข้อตกลง (แสดงบนการ์ดเอกสารที่ส่งลูกค้า)</div>
                      <div className="space-y-2">
                        <input
                          type="number"
                          step="0.01"
                          value={settings.vatRate}
                          onChange={(e) => setSettings((s) => ({ ...s, vatRate: Number(e.target.value) }))}
                          placeholder="อัตราภาษี VAT (เช่น 0.07)"
                          className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
                        />
                        <textarea
                          value={settings.documentTerms}
                          onChange={(e) => setSettings((s) => ({ ...s, documentTerms: e.target.value }))}
                          placeholder="ข้อตกลง/เงื่อนไขมาตรฐาน (ไม่บังคับ)"
                          rows={3}
                          className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
                        />
                        <textarea
                          value={settings.documentFooterNote}
                          onChange={(e) => setSettings((s) => ({ ...s, documentFooterNote: e.target.value }))}
                          placeholder="หมายเหตุท้ายเอกสารมาตรฐาน (ไม่บังคับ)"
                          rows={2}
                          className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">แจ้งยอดค้างชำระอัตโนมัติ</div>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-stone-700">
                          <input
                            type="checkbox"
                            checked={settings.debtReminderAutoEnabled}
                            onChange={(e) => setSettings((s) => ({ ...s, debtReminderAutoEnabled: e.target.checked }))}
                          />
                          เปิดส่งอัตโนมัติวันละ 1 รอบ
                        </label>
                        <select
                          value={settings.debtReminderHour}
                          onChange={(e) => setSettings((s) => ({ ...s, debtReminderHour: Number(e.target.value) }))}
                          disabled={!settings.debtReminderAutoEnabled}
                          className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 bg-white disabled:opacity-40"
                        >
                          {Array.from({ length: 24 }, (_, h) => (
                            <option key={h} value={h}>{String(h).padStart(2, "0")}:00 น.</option>
                          ))}
                        </select>
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
            </div>
          </div>
        </div>
      )}
    </>
  )
}