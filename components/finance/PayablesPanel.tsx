"use client"

import { useCallback, useEffect, useState } from "react"

// PayablesPanel (UNIFIED FINANCE ADMIN mission, 2026-10-11) — คำขอจ่ายเงิน
// พาร์ตเนอร์ผ่าน canonical expense writer (/api/admin/payables):
//   POST  → requestPartnerPayable (status เริ่ม pending เสมอ — Rule 72)
//   PATCH → transitionPartnerPayable (pending → owner_acknowledged →
//           paid_confirmed/completed — row-filtered fail-closed)
// paid_confirmed ต้องแนบบรรยายหลักฐานธนาคารจริง (route บังคับ) —
// เงินออกจริงยังยืนยันด้วยหลักฐานธนาคาร ไม่ใช่ปุ่มเดียว

interface Payable {
  id: string
  partner_name: string
  amount: number
  description: string | null
  status: string
  bank_email_verified: boolean
  created_at: string
}

interface CompanyOption { id: string; name: string; is_individual?: boolean }

const thb = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inputCls =
  "w-full text-sm border border-stone-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200"
const labelCls = "block text-xs font-medium text-stone-600 mb-1"

const STATUS_LABEL: Record<string, string> = {
  pending: "รอดำเนินการ",
  owner_acknowledged: "เจ้าของรับทราบแล้ว",
  paid_confirmed: "ยืนยันจ่ายแล้ว (มีหลักฐานธนาคาร)",
  completed: "เสร็จสมบูรณ์",
}

export default function PayablesPanel() {
  const [items, setItems] = useState<Payable[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [companyId, setCompanyId] = useState("")
  const [partnerName, setPartnerName] = useState("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([
      fetch("/api/admin/payables?limit=20").catch(() => null),
      fetch("/api/admin/partners").catch(() => null),
    ])
    if (p && p.ok) setItems((await p.json()).items ?? [])
    if (c && c.ok) setCompanies((await c.json()).partners ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  async function createPayable(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setSuccess(null)
    const amt = Number(amount)
    if (!partnerName.trim() && !companyId) { setError("ต้องระบุพาร์ตเนอร์"); return }
    if (!Number.isFinite(amt) || amt <= 0) { setError("จำนวนเงินต้องมากกว่า 0"); return }
    setCreating(true)
    const res = await fetch("/api/admin/payables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partner_company_id: companyId || null,
        partner_name: partnerName.trim() || companies.find((c) => c.id === companyId)?.name || "",
        amount: amt,
        description: description.trim() || null,
      }),
    })
    const data = await res.json()
    setCreating(false)
    if (!res.ok) { setError(data.error ?? "สร้างคำขอไม่สำเร็จ"); return }
    setSuccess("สร้างคำขอจ่ายเงิน (สถานะ: รอดำเนินการ) — เจ้าของจะโอนแล้วแนบสลิปในแชตเพื่อยืนยันด้วยหลักฐานธนาคารจริง")
    setCompanyId(""); setPartnerName(""); setAmount(""); setDescription("")
    await load()
  }

  async function transition(id: string, to: string) {
    setError(null); setSuccess(null)
    let evidence: string | null = null
    if (to === "paid_confirmed" || to === "completed") {
      evidence = window.prompt("ยืนยันว่าจ่ายเงินจริงแล้ว — แนบบรรยายหลักฐานธนาคารจริง (เลขอ้างอิงอีเมลธนาคาร/สลิป):")?.trim() ?? null
      if (!evidence) { setError("ต้องมีหลักฐานธนาคารจริงเพื่อยืนยันการจ่ายเงิน"); return }
    }
    setBusyId(id)
    const res = await fetch("/api/admin/payables", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payable_id: id, to, bank_email_evidence: evidence }),
    })
    const data = await res.json()
    setBusyId(null)
    if (!res.ok) { setError(data.error ?? "อัปเดตไม่สำเร็จ"); return }
    await load()
  }

  return (
    <div>
      <div className="text-xs font-semibold text-stone-600 mb-2">คำขอจ่ายเงินพาร์ตเนอร์ (ยังไม่จ่าย = pending — ไม่กระทบเงินสด)</div>
      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
      {success && <div className="mb-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">{success}</div>}

      <form onSubmit={createPayable} className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="sm:col-span-2">
          <label className={labelCls}>พาร์ตเนอร์ (เลือกรายการที่มีอยู่ หรือพิมพ์ชื่อ)</label>
          <select className={inputCls} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">— พิมพ์ชื่อด้านล่าง —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.is_individual ? " (บุคคล)" : ""}</option>
            ))}
          </select>
          {!companyId && (
            <input className={`${inputCls} mt-2`} value={partnerName} onChange={(e) => setPartnerName(e.target.value)} placeholder="ชื่อพาร์ตเนอร์" />
          )}
        </div>
        <div>
          <label className={labelCls}>จำนวนเงิน (บาท) *</label>
          <input type="number" step="0.01" min="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>รายละเอียด</label>
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ค่าวัสดุ/ค่าบริการ ..." />
        </div>
        <div>
          <button type="submit" disabled={creating} className="px-4 py-2 text-sm font-medium rounded-lg bg-stone-800 text-white hover:bg-stone-900 transition disabled:opacity-50">
            {creating ? "กำลังสร้าง..." : "สร้างคำขอจ่ายเงิน"}
          </button>
        </div>
      </form>

      <div className="border border-stone-200 rounded-lg divide-y divide-stone-100 bg-white">
        {items.length === 0 && <div className="px-3 py-3 text-sm text-stone-400">ไม่มีคำขอจ่ายเงิน</div>}
        {items.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <div className="min-w-0">
              <span className="text-stone-800">{p.partner_name}</span>
              <span className="text-xs text-stone-400 ml-2">{p.description ?? ""} · {String(p.created_at).slice(0, 10)}</span>
              <span className={`text-xs ml-2 px-1.5 py-0.5 rounded ${p.status === "paid_confirmed" || p.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {STATUS_LABEL[p.status] ?? p.status}
              </span>
            </div>
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="font-semibold">{thb(p.amount)} ฿</span>
              {p.status === "pending" && (
                <button disabled={busyId === p.id} onClick={() => transition(p.id, "owner_acknowledged")} className="text-xs px-2 py-1 rounded border border-stone-300 hover:bg-stone-50 disabled:opacity-50">
                  เจ้าของรับทราบ
                </button>
              )}
              {(p.status === "pending" || p.status === "owner_acknowledged") && (
                <>
                  <button disabled={busyId === p.id} onClick={() => transition(p.id, "paid_confirmed")} className="text-xs px-2 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                    ยืนยันจ่ายแล้ว
                  </button>
                  <button disabled={busyId === p.id} onClick={() => transition(p.id, "completed")} className="text-xs px-2 py-1 rounded border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:opacity-50">
                    เสร็จ
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

