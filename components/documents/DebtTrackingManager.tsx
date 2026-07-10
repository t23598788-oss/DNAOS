'use client'

import { Fragment, useState, useEffect, useCallback, useMemo } from "react"
import Link from "next/link"
import { formatMoney } from "@/engines/documents/document-editor"
import type { DebtTrackingSummary } from "@/engines/debt/tracking"

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

interface RecentDocument {
  id: string
  document_type: string
  document_number: string
  status: string
  party_name: string
  net_amount: number
  issue_date: string | null
  created_at: string
}

const DOC_TYPE_LABEL: Record<string, string> = {
  invoice: "ใบแจ้งหนี้",
  RCP: "ใบเสร็จ",
  PMT: "ใบสำคัญจ่าย",
  PV: "ใบสำคัญรับ",
  quotation: "ใบเสนอราคา",
  QUO: "ใบเสนอราคา",
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
  const [recentDocs, setRecentDocs] = useState<RecentDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
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

  const loadRecentDocs = useCallback(async () => {
    const [invoicesRes, receiptsRes] = await Promise.all([
      fetch("/api/admin/documents?perPage=8"),
      fetch("/api/admin/documents?type=RCP&perPage=8"),
    ])
    const [invoicesData, receiptsData] = await Promise.all([invoicesRes.json(), receiptsRes.json()])
    const merged: RecentDocument[] = [...(invoicesData.documents ?? []), ...(receiptsData.documents ?? [])]
    merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setRecentDocs(merged.slice(0, 8))
  }, [])

  useEffect(() => {
    loadRows()
    loadPartners()
    loadRecentDocs()
  }, [loadRows, loadPartners, loadRecentDocs])

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

      {/* ── Header: page identity (ธุรกิจการเงิน — เอกสาร + ติดตามหนี้ รวมหน้าเดียว) ── */}
      <div className="shrink-0 bg-white border-b border-stone-200 px-6 py-3">
        <h1 className="text-base font-bold text-stone-900">ธุรกิจการเงิน</h1>
        <p className="text-xs text-stone-600 mt-0.5">เอกสารการเงินที่ออกล่าสุด และรายการติดตามทวงหนี้ — รวมอยู่หน้าเดียว</p>
      </div>

      {/* ── Grand Total Banner ── */}
      {grandTotal && (
        <div className="shrink-0 bg-rose-950 border-b border-rose-800/60 px-6 py-4">
          <div className="text-xs font-semibold text-rose-200 uppercase tracking-widest mb-3">
            ยอดรวมการวางบิลของบริษัทฯ · ครบกำหนดชำระและยังไม่ได้รับชำระจากพาร์ตเนอร์
          </div>
          <div className="flex flex-wrap gap-6 items-end">
            <div className="flex-1 min-w-[180px]">
              <div className="text-xs text-rose-200 mb-1">ยอดรวมทั้งหมด ({grandTotal.count} เจ้า)</div>
              <div className="text-3xl font-bold text-white tabular-nums leading-none">
                {formatMoney(grandTotal.total)}
              </div>
              {grandTotal.overdue > 0 && (
                <div className="mt-1.5 text-xs font-semibold text-rose-200">
                  ⚠ ผิดนัดชำระแล้ว {grandTotal.overdue} เจ้า
                </div>
              )}
            </div>
            <div className="flex gap-5 flex-wrap">
              <div className="text-right">
                <div className="text-xs text-rose-200 mb-0.5">เงินต้นรวม</div>
                <div className="text-sm font-semibold text-white tabular-nums">{formatMoney(grandTotal.principal)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-rose-200 mb-0.5">ค่าธรรมเนียมรวม</div>
                <div className="text-sm font-semibold text-white tabular-nums">{formatMoney(grandTotal.fee)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-rose-200 mb-0.5">ดอกเบี้ย 25%/ปี</div>
                <div className="text-sm font-semibold text-amber-300 tabular-nums">{formatMoney(grandTotal.interest)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-rose-200 mb-0.5">ค่าปรับ 100฿/วัน</div>
                <div className="text-sm font-semibold text-orange-300 tabular-nums">{formatMoney(grandTotal.penalty)}</div>
              </div>
              <div className="text-right border-l border-rose-700 pl-5">
                <div className="text-xs font-semibold text-rose-200 mb-0.5">ยอดรวมพร้อมดอกเบี้ย</div>
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

        {/* Right: recent documents + debt table */}
        <div className="flex-1 overflow-y-auto bg-stone-50 p-6 space-y-6">

          {/* Recent financial documents — no more clicking through separate pages to see what was issued today */}
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 bg-stone-100">
              <span className="text-sm font-bold text-stone-900">เอกสารการเงินล่าสุด</span>
            </div>
            {recentDocs.length === 0 ? (
              <div className="text-center text-stone-500 text-sm py-6">ยังไม่มีเอกสารออก</div>
            ) : (
              <div className="divide-y divide-stone-100">
                {recentDocs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-stone-50 transition">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200">
                        {DOC_TYPE_LABEL[doc.document_type] ?? doc.document_type}
                      </span>
                      <span className="text-sm font-medium text-stone-900 truncate">{doc.document_number}</span>
                      <span className="text-sm text-stone-600 truncate">{doc.party_name || "—"}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-semibold text-stone-900 tabular-nums">{formatMoney(doc.net_amount)}</span>
                      <span className="text-xs text-stone-500">{fmtDate(doc.issue_date || doc.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 bg-stone-100">
              <span className="text-sm font-bold text-stone-900">รายการติดตามทวงหนี้</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-stone-700">
                  <th className="text-left font-bold uppercase tracking-wide px-4 py-2.5">ลูกค้า</th>
                  <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">ผิดนัดชำระมากี่วัน</th>
                  <th className="text-right font-bold uppercase tracking-wide px-4 py-2.5">ยอดรวมวันนี้</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {loading && (
                  <tr><td colSpan={3} className="text-center text-stone-500 py-8 animate-pulse">โหลด...</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-stone-500 py-8">ยังไม่มีลูกหนี้</td></tr>
                )}
                {rows.map((row) => {
                  const isOpen = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <tr
                        onClick={() => setExpandedId(isOpen ? null : row.id)}
                        className="hover:bg-stone-50 transition cursor-pointer"
                      >
                        <td className="px-4 py-3 font-semibold text-stone-900">
                          <span className="inline-block w-3 text-stone-400">{isOpen ? "▾" : "▸"}</span>{" "}
                          {row.customer_name || "—"}
                        </td>
                        <td className="px-3 py-3 text-stone-700">
                          {row.summary.daysOverdue > 0 ? `${row.summary.daysOverdue} วัน` : "ยังไม่ผิดนัด"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-stone-900">{formatMoney(row.summary.totalAmount)}</td>
                      </tr>
                      {isOpen && (
                        <tr key={`${row.id}-detail`} className="bg-stone-50">
                          <td colSpan={3} className="px-4 py-4">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                              <div>
                                <div className="text-xs text-stone-500 mb-0.5">เงินต้น</div>
                                <div className="text-sm font-semibold text-stone-900 tabular-nums">{formatMoney(row.principal_amount)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-stone-500 mb-0.5">ค่าธรรมเนียม {row.fee_rate}%</div>
                                <div className="text-sm font-semibold text-stone-900 tabular-nums">{formatMoney(row.summary.feeAmount)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-stone-500 mb-0.5">ดอกเบี้ย 25%/ปี ({row.summary.daysElapsed} วัน)</div>
                                <div className="text-sm font-semibold text-amber-700 tabular-nums">{formatMoney(row.summary.interestAmount)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-stone-500 mb-0.5">ค่าปรับ 100฿/วัน</div>
                                <div className="text-sm font-semibold text-orange-700 tabular-nums">
                                  {row.summary.daysOverdue > 0 ? formatMoney(row.summary.penaltyAmount) : "—"}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-stone-500 mb-0.5">เริ่มคิดดอกเบี้ย</div>
                                <div className="text-sm text-stone-800">{fmtDate(row.interest_start_at)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-stone-500 mb-0.5">วันครบกำหนด (ผิดนัดหลังจากนี้)</div>
                                <div className="text-sm text-stone-800">{fmtDate(row.summary.defaultDate)}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              <Link
                                href={`/admin/create-document?fromDebtTracking=${row.id}`}
                                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 transition"
                              >
                                ออกใบทวงหนี้
                              </Link>
                              <button onClick={() => startEdit(row)} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-100 transition">แก้ไข</button>
                              <button onClick={() => remove(row.id)} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 transition">ลบ</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
