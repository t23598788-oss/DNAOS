"use client"

import { useEffect, useState } from "react"

// Finance Summary page (owner request 2026-07-25) — real cash-flow summary
// from real documents already in the system, charted. Not a formal balance
// sheet (see honesty_note from the API — no fixed-asset/capital data exists
// to build one honestly). Reached via a small sidebar icon, not a new
// prominent top-level destination — matches the owner's explicit "อย่าไป
// สร้างหน้าจอใหม่เพิ่ม...เอาไว้เป็นฟังก์ชันมุมซ้ายเล็กๆ" instruction.

interface MonthRow {
  month: string
  revenue_documented: number
  payments_received_verified: number
  fuel_bills: number
}

interface ExpenseCategory {
  category: string
  total: number
}

interface FinanceSummary {
  ok: boolean
  months: MonthRow[]
  totals: {
    revenue_documented: number
    revenue_subtotal: number
    revenue_vat_output: number
    revenue_wht_output: number
    revenue_net_payable: number
    payments_received_verified: number
    fuel_bills: number
    outstanding_debt: number
    unverified_transfer_slips: number
    unverified_transfer_slips_count: number
    company_expenses: number
  }
  expense_categories: ExpenseCategory[]
  latest_fuel_price: string | null
  honesty_note: string
}

function thb(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Bars({ months, field, color, label }: { months: MonthRow[]; field: keyof MonthRow; color: string; label: string }) {
  const values = months.map((m) => Number(m[field]))
  const max = Math.max(1, ...values)
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#333" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 140, borderBottom: "1px solid #ddd", padding: "0 4px" }}>
        {months.map((m) => {
          const v = Number(m[field])
          const h = Math.max(2, (v / max) * 130)
          return (
            <div key={m.month} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, minWidth: 0 }}>
              <div title={`${m.month}: ${thb(v)} บาท`} style={{ width: "70%", height: h, background: color, borderRadius: "2px 2px 0 0" }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: "flex", gap: 8, padding: "4px 4px 0" }}>
        {months.map((m) => (
          <div key={m.month} style={{ flex: 1, textAlign: "center", fontSize: 10, color: "#888", minWidth: 0, overflow: "hidden" }}>
            {m.month.slice(2)}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function FinancePage() {
  const [data, setData] = useState<FinanceSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/finance-summary")
      .then((r) => r.json())
      .then((d) => (d.ok ? setData(d) : setError(d.error ?? "โหลดข้อมูลไม่สำเร็จ")))
      .catch((e) => setError(String(e)))
  }, [])

  if (error) return <div style={{ padding: 24, color: "#c00" }}>เกิดข้อผิดพลาด: {error}</div>
  if (!data) return <div style={{ padding: 24 }}>กำลังโหลด...</div>

  return (
    <div style={{ padding: 24, maxWidth: 900, fontFamily: "inherit" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>สรุปการเงิน</h1>
      <p style={{ fontSize: 12, color: "#888", marginBottom: 20 }}>{data.honesty_note}</p>

      {data.totals.unverified_transfer_slips_count > 0 && (
        <div style={{ background: "#fff3cd", border: "1px solid #ffe08a", borderRadius: 8, padding: 12, marginBottom: 20 }}>
          ⚠️ มีสลิปโอนเงิน <b>{data.totals.unverified_transfer_slips_count} ใบ</b> รวม{" "}
          <b>{thb(data.totals.unverified_transfer_slips)} บาท</b> ที่ยังไม่ได้ยืนยันการรับเงิน — เงินก้อนนี้อาจเข้าจริงแล้วแต่ยังไม่ถูกนับเป็นรายรับที่ยืนยัน
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 32 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#888" }}>รายได้จากเอกสารทั้งหมด</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{thb(data.totals.revenue_documented)} ฿</div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#888" }}>เงินเข้าจริงที่ยืนยันแล้ว</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a7f37" }}>{thb(data.totals.payments_received_verified)} ฿</div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#888" }}>ค่าน้ำมันรวม (จากบิลจริง)</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#c00" }}>{thb(data.totals.fuel_bills)} ฿</div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#888" }}>หนี้ค้างชำระรวม</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#c77700" }}>{thb(data.totals.outstanding_debt)} ฿</div>
        </div>
      </div>

      {/* FINANCE CHECK (owner playable loop, 2026-09-25) — แสดงเฉพาะค่าที่ API
          คำนวณจาก document_canonical + payment_allocations ไว้แล้วเท่านั้น
          (ไม่มีการคำนวณซ้ำใน UI): ยอดก่อน VAT · VAT · WHT · ยอดสุทธิ ·
          ยอดชำระ = การ์ด "เงินเข้าจริงที่ยืนยันแล้ว" (payment_allocations) ·
          ยอดคงเหลือ = การ์ด "หนี้ค้างชำระรวม" (company_debt_current) ด้านบน */}
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#333" }}>
        ยอดเอกสารขาย (canonical · document_canonical — ไม่ตัดเอกสาร VOID/ใบเสนอราคา)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 32 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#888" }}>ยอดก่อน VAT</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{thb(data.totals.revenue_subtotal)} ฿</div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#888" }}>VAT (ออก)</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{thb(data.totals.revenue_vat_output)} ฿</div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#888" }}>WHT (หัก ณ ที่จ่าย)</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{thb(data.totals.revenue_wht_output)} ฿</div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#888" }}>ยอดสุทธิ</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a7f37" }}>{thb(data.totals.revenue_net_payable)} ฿</div>
        </div>
      </div>

      {data.months.length === 0 ? (
        <p style={{ color: "#888" }}>ยังไม่มีเอกสารที่มีวันที่จริงพอจะขึ้นกราฟรายเดือนได้</p>
      ) : (
        <>
          <Bars months={data.months} field="revenue_documented" color="#2563eb" label="รายได้จากเอกสาร รายเดือน" />
          <Bars months={data.months} field="payments_received_verified" color="#1a7f37" label="เงินเข้าจริงที่ยืนยันแล้ว รายเดือน" />
          <Bars months={data.months} field="fuel_bills" color="#c00" label="ค่าน้ำมัน รายเดือน" />
        </>
      )}

      {data.latest_fuel_price && (
        <p style={{ fontSize: 12, color: "#888", marginTop: 16 }}>ราคาน้ำมันล่าสุดในระบบ: {data.latest_fuel_price} บาท/ลิตร</p>
      )}

      {/* Real expense category breakdown (owner, 2026-07-31): "แยกหมวดหมู่
          ค่าใช้จ่ายตามในจากตารางเดิม...ตามบิลจริง" — no pie chart per the
          owner's own instruction, just real totals grouped by category from
          company_expenses (document_type/vendor_name), same source as the
          totals cards above. */}
      {data.expense_categories.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#333" }}>
            ค่าใช้จ่ายบริษัทแยกตามหมวดหมู่ (จากบิลจริงในระบบ) — รวม {thb(data.totals.company_expenses)} ฿
          </div>
          <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
            {data.expense_categories.map((c, i) => {
              const pct = data.totals.company_expenses > 0 ? (c.total / data.totals.company_expenses) * 100 : 0
              return (
                <div
                  key={c.category}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid #f0f0f0",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#7c5cd6", flexShrink: 0 }} />
                    <span style={{ fontSize: 13 }}>{c.category}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: "#888" }}>{pct.toFixed(1)}%</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{thb(c.total)} ฿</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
