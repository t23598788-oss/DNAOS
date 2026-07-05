'use client'

import { useState, useEffect, useCallback, useMemo } from "react"
import Link from "next/link"
import { formatMoney } from "@/lib/documents/document-editor"
import type { DebtTrackingSummary } from "@/lib/v3-engines/debt/tracking"

interface Partner {
  id: string
  name: string
  phone?: string | null
  partner_type_label?: string | null
}

interface DebtTrackingRow {
  id: string
  partner_id: string | null
  customer_name: string
  principal_amount: number
  fee_rate: number
  interest_start_at: string
  created_at: string
  summary: DebtTrackingSummary
}

const EMPTY_FORM = {
  partnerId: "",
  principalAmount: "",
  feeRate: "5",
  interestStartAt: new Date().toISOString().split("T")[0],
}

function fmtDate(d: string) {
  if (!d) return ""
  return new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })
}

export default function DebtTrackingManager() {
  const [rows, setRows] = useState<DebtTrackingRow[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/debt-trackings")
      const data = await res.json()
      setRows(data.debtTrackings ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadPartners = useCallback(async () => {
    const res = await fetch("/api/admin/partners?debtorsOnly=true")
    const data = await res.json()
    setPartners(data.partners ?? [])
  }, [])

  useEffect(() => {
    loadRows()
    loadPartners()
  }, [loadRows, loadPartners])

  function startEdit(row: DebtTrackingRow) {
    setEditingId(row.id)
    setForm({
      partnerId: row.partner_id ?? "",
      principalAmount: String(row.principal_amount),
      feeRate: String(row.fee_rate),
      interestStartAt: row.interest_start_at?.split("T")[0] ?? "",
    })
    if (row.partner_id) {
      const partnerId = row.partner_id
      setPartners((prev) => (prev.some((p) => p.id === partnerId) ? prev : [...prev, { id: partnerId, name: row.customer_name, phone: null, partner_type_label: null }]))
    }
  }

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function save() {
    if (!form.partnerId || !form.principalAmount) {
      setMsg({ ok: false, text: "ต้องเลือกพาร์ทเนอร์และระบุเงินต้น" })
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      const partner = partners.find((p) => p.id === form.partnerId)
      const payload = {
        partnerId: form.partnerId,
        customerName: partner?.name ?? "",
        principalAmount: Number(form.principalAmount),
        feeRate: Number(form.feeRate),
        interestStartAt: form.interestStartAt,
      }
      const res = await fetch(editingId ? `/api/admin/debt-trackings/${editingId}` : "/api/admin/debt-trackings", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "บันทึกไม่สำเร็จ")
      setMsg({ ok: true, text: editingId ? "แก้ไขแล้ว" : "เพิ่มลูกหนี้แล้ว" })
      resetForm()
      loadRows()
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" })
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm("ลบรายการลูกหนี้นี้?")) return
    await fetch(`/api/admin/debt-trackings/${id}`, { method: "DELETE" })
    if (editingId === id) resetForm()
    loadRows()
  }

  // ── ยอดรวมทั้งหมด (คำนวณ live จาก rows ที่โหลดมา) ────────────────────────
  const grandTotal = useMemo(() => {
    if (!rows.length) return null
    return {
      count:     rows.length,
      overdue:   rows.filter((r) => r.summary.daysOverdue > 0).length,
      principal: rows.reduce((s, r) => s + r.principal_amount, 0),
      fee:       rows.reduce((s, r) => s + r.summary.feeAmount, 0),
      interest:  rows.reduce((s, r) => s + r.summary.interestAmount, 0),
      penalty:   rows.reduce((s, r) => s + r.summary.penaltyAmount, 0),
      total:     rows.reduce((s, r) => s + r.summary.totalAmount, 0),
    }
  }, [rows])

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* ── Grand Total Banner ── */}
      {grandTotal && (
        <div className="shrink-0 bg-rose-950 border-b border-rose-800/60 px-6 py-4">
          <div className="text-[10px] font-semibold text-rose-300 uppercase tracking-widest mb-3">
            ยอดรวมการวางบิลของบริษัทฯ · ครบกำหนดชำระและยังไม่ได้รับชำระจากพาร์ตเนอร์
          </div>
          <div className="flex flex-wrap gap-6 items-end">
            <div className="flex-1 min-w-[180px]">
              <div className="text-[10px] text-rose-400 mb-1">ยอดรวมทั้งหมด ({grandTotal.count} เจ้า)</div>
              <div className="text-3xl font-bold text-white tabular-nums leading-none">
                {formatMoney(grandTotal.total)}
              </div>
              {grandTotal.overdue > 0 && (
                <div className="mt-1.5 text-[10px] text-rose-300">
                  ⚠ ผิดนัดชำระแล้ว {grandTotal.overdue} เจ้า
                </div>
              )}
            </div>
            <div className="flex gap-5 flex-wrap">
              <div className="text-right">
                <div className="text-[10px] text-rose-400 mb-0.5">เงินต้นรวม</div>
                <div className="text-sm font-semibold text-rose-100 tabular-nums">{formatMoney(grandTotal.principal)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-rose-400 mb-0.5">ค่าธรรมเนียมรวม</div>
                <div className="text-sm font-semibold text-rose-100 tabular-nums">{formatMoney(grandTotal.fee)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-rose-400 mb-0.5">ดอกเบี้ย 25%/ปี</div>
                <div className="text-sm font-semibold text-amber-200 tabular-nums">{formatMoney(grandTotal.interest)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-rose-400 mb-0.5">ค่าปรับ 100฿/วัน</div>
                <div className="text-sm font-semibold text-orange-300 tabular-nums">{formatMoney(grandTotal.penalty)}</div>
              </div>
              <div className="text-right border-l border-rose-700 pl-5">
                <div className="text-[10px] text-rose-300 mb-0.5">ยอดรวมพร้อมดอกเบี้ย</div>
                <div className="text-lg font-bold text-white tabular-nums">{formatMoney(grandTotal.total)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Main layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: form */}
        <div className="w-96 shrink-0 border-r border-stone-200 bg-white overflow-y-auto">
          <div className="px-5 py-4 border-b border-stone-100 sticky top-0 bg-white z-10">
            <div className="font-semibold text-stone-800">{editingId ? "แก้ไขลูกหนี้" : "เพิ่มลูกหนี้"}</div>
            {msg && (
              <div className={`mt-2 text-xs px-3 py-1.5 rounded-lg ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                {msg.text}
              </div>
            )}
          </div>
          <div className="px-5 py-4 space-y-4">
            <div>
              <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">ลูกค้า</label>
              <select
                value={form.partnerId}
                onChange={(e) => setForm((p) => ({ ...p, partnerId: e.target.value }))}
                className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
              >
                <option value="">— เลือกพาร์ทเนอร์ —</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.partner_type_label ? ` (${p.partner_type_label})` : ""}</option>
                ))}
              </select>
              {partners.length === 0 && (
                <div className="mt-1.5 text-[11px] text-stone-400">ไม่มีพาร์ทเนอร์ที่ยังเป็นลูกหนี้ (มีบิลส่งของ/ใบแจ้งหนี้ที่ยังไม่ชำระ)</div>
              )}
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">เงินต้น (บาท)</label>
              <input
                type="number"
                value={form.principalAmount}
                onChange={(e) => setForm((p) => ({ ...p, principalAmount: e.target.value }))}
                className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500 text-right"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">ค่าธรรมเนียม (%)</label>
              <input
                type="number"
                value={form.feeRate}
                onChange={(e) => setForm((p) => ({ ...p, feeRate: e.target.value }))}
                className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500 text-right"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">วันเริ่มคิดดอกเบี้ย</label>
              <input
                type="date"
                value={form.interestStartAt}
                onChange={(e) => setForm((p) => ({ ...p, interestStartAt: e.target.value }))}
                className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 py-2.5 bg-stone-800 text-white rounded-xl text-sm font-semibold hover:bg-stone-700 disabled:opacity-40 transition"
              >
                {saving ? "กำลังบันทึก..." : editingId ? "บันทึกการแก้ไข" : "เพิ่มลูกหนี้"}
              </button>
              {editingId && (
                <button onClick={resetForm} className="px-4 py-2.5 rounded-xl text-sm border border-stone-200 text-stone-600 hover:bg-stone-50 transition">
                  ยกเลิก
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right: table */}
        <div className="flex-1 overflow-y-auto bg-stone-50 p-6">
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-stone-500">
                  <th className="text-left font-semibold uppercase tracking-wider px-4 py-2.5">ลูกค้า</th>
                  <th className="text-left font-semibold uppercase tracking-wider px-3 py-2.5">เริ่มคิดดอกเบี้ย</th>
                  <th className="text-left font-semibold uppercase tracking-wider px-3 py-2.5">ผิดนัดชำระ</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2.5">เงินต้น</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2.5">ค่าธรรมเนียม</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2.5">วันสะสม</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2.5">ดอกเบี้ย 25%</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2.5">ค่าปรับ</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2.5">ยอดรวม</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {loading && (
                  <tr><td colSpan={10} className="text-center text-stone-400 py-8 animate-pulse">โหลด...</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={10} className="text-center text-stone-400 py-8">ยังไม่มีลูกหนี้</td></tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-stone-50 transition">
                    <td className="px-4 py-2.5 font-medium text-stone-800">{row.customer_name || "—"}</td>
                    <td className="px-3 py-2.5 text-stone-500">{fmtDate(row.interest_start_at)}</td>
                    <td className="px-3 py-2.5 text-stone-500">{fmtDate(row.summary.defaultDate)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(row.principal_amount)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-500">{row.fee_rate}% ({formatMoney(row.summary.feeAmount)})</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-500">{row.summary.daysElapsed} วัน</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-500">{formatMoney(row.summary.interestAmount)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-500">
                      {row.summary.daysOverdue > 0
                        ? `${formatMoney(row.summary.penaltyAmount)} (${row.summary.daysOverdue} วัน)`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-stone-800">{formatMoney(row.summary.totalAmount)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        <Link
                          href={`/admin/create-document?fromDebtTracking=${row.id}`}
                          className="text-[11px] px-2.5 py-1 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 transition"
                        >
                          ออกใบทวงหนี้
                        </Link>
                        <button onClick={() => startEdit(row)} className="text-[11px] px-2.5 py-1 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition">แก้ไข</button>
                        <button onClick={() => remove(row.id)} className="text-[11px] px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition">ลบ</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
