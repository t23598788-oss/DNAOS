"use client"

import { useState, useEffect, useCallback } from "react"
import { SecretaryChat } from "@/components/admin/SecretaryChat"

// ── Types ──────────────────────────────────────────────────────────────────────
// Kept minimal — this page no longer renders pulse data as UI cards (owner,
// 2026-07-30: turn the screen into a pure chat board, keep the numbers as AI
// context only), so only the shape needed to build the chat's opening text
// remains here.

interface PulseData {
  metrics: { todayRevenue: number; activeJobs: number; pendingDocs: number }
  activeJobs: unknown[]
  pendingDocs: unknown[]
  recentDocs: unknown[]
  generatedAt: string
}

// ── สรุป "วันนี้ต้องทำอะไรบ้าง" สำหรับข้อความเปิดแชต ──────────────────────────────

function buildOpeningText(pulse: PulseData, pendingDraftCount: number | null): string {
  const lines: string[] = []
  if (pulse.pendingDocs.length > 0) {
    lines.push(`เอกสารรอยืนยัน ${pulse.pendingDocs.length} ใบ`)
  }
  if (pulse.activeJobs.length > 0) {
    lines.push(`งานที่กำลังเดิน ${pulse.activeJobs.length} งาน`)
  }
  if (pendingDraftCount && pendingDraftCount > 0) {
    lines.push(`ข้อความ LINE รอเฮียอนุมัติก่อนส่งลูกค้า ${pendingDraftCount} รายการ`)
  }
  if (lines.length === 0) return "วันนี้ยังไม่มีอะไรค้างครับ พิมพ์สั่งงานได้เลย"
  return `วันนี้เฮียมี:\n${lines.map((l) => `• ${l}`).join("\n")}`
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [pulse, setPulse] = useState<PulseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshAt, setRefreshAt] = useState<Date | null>(null)
  const [pendingDraftCount, setPendingDraftCount] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/pulse")
      if (!res.ok) throw new Error(`${res.status}`)
      setPulse(await res.json())
      setRefreshAt(new Date())
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ข้อความ LINE ที่ระบบตัดสินใจส่งลูกค้าเองไม่ได้ ต้องรอเฮียอนุมัติ (Rule 72) —
  // นับมาโชว์ในข้อความเปิดแชต แทนที่จะสร้างคิวตรวจสอบใหม่ซ้ำซ้อน
  useEffect(() => {
    fetch("/api/admin/outbound-drafts")
      .then((r) => r.json())
      .then((d) => setPendingDraftCount((d.drafts ?? []).filter((x: { status: string }) => x.status === "pending_review").length))
      .catch(() => setPendingDraftCount(null))
  }, [])

  const openingText = pulse ? buildOpeningText(pulse, pendingDraftCount) : undefined

  // auto-refresh ทุก 2 นาที — ทำงานเงียบ ไม่กระพริบ
  useEffect(() => {
    const t = setInterval(load, 120_000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div className="h-full bg-stone-50 flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm font-bold text-stone-800">DNA OS</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            เลขาส่วนตัว — คุยได้เลยว่ารายได้วันนี้เท่าไหร่ งานไหนกำลังเดิน เอกสารไหนรอยืนยัน หรือสั่งงานตรงๆ
          </p>
          {refreshAt && (
            <p className="text-[11px] text-stone-400">
              ข้อมูลอัปเดต {refreshAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-[11px] text-stone-400 hover:text-stone-600 disabled:opacity-40 transition"
        >
          {loading ? "โหลด..." : "↺"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 shrink-0">
          {error}
        </div>
      )}

      {/* ── เลขาส่วนตัว — เป็นแชทบอร์ดเต็มจอ (owner, 2026-07-30): "จัดบล็อกหน้าจอ
          ให้เป็นแชทบอร์ดของระบบ DNA OS เลย box ข้อมูลยอดรายการต่างๆ ออกไปจาก
          หน้าจอนี้...เอาไปเป็นข้อมูลความรู้ของ AI แต่ไม่ต้องเอาขึ้นมาแสดงหน้าจอ"
          — the metric cards / quick-doc buttons / active-jobs / pending-docs /
          recent-docs sections that used to render below the chat are removed
          entirely from this screen. `pulse` (today's revenue, active jobs,
          pending docs) is still fetched — it feeds openingText below and is
          available to the AI as real context — it just never renders as a
          visual card on this page anymore. ── */}
      <div className="flex-1 min-h-0 p-5">
        <div className="max-w-4xl mx-auto h-full">
          <SecretaryChat openingText={openingText} />
        </div>
      </div>
    </div>
  )
}