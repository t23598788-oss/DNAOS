"use client"

import { useEffect, useState } from "react"

// Finance Summary tab (เดิมคือหน้า /admin/finance ทั้งหน้า — owner request
// 2026-07-25) — real cash-flow summary from real documents already in the
// system, charted. ย้ายมาเป็น tab "ภาพรวม" ของ FinanceWorkspace
// (UNIFIED FINANCE ADMIN mission 2026-10-11) เนื้อหาไม่เปลี่ยน

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
  financial_statements: {
    profit_and_loss: {
      revenue_documented: number
      expenses_recorded: number
      gross_cash_margin: number
      net_document_margin: number
    }
    statement_of_financial_position: {
      cash_verified: number
      receivables_known: number
      pending_verification_assets: number
      liabilities_known: number | null
      equity_known: number | null
      data_gap_note: string
    }
    cash_basis: {
      cash_in_verified: number
      cash_out_recorded: number
      net_cash_movement: number
    }
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

export default function SummaryTab() {
  const [data, setData] = useState<FinanceSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/finance-summary")
      .then((r) => r.json())
      .then((d) => (d.ok ? setData(d) : setError(d.error ?? "โหลดไม่สำเร็จ")))
      .catch(() => setError("โหลดสรุปการเงินไม่สำเร็จ"))
  }, [])

  if (error) return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>
  if (!data) return <div className="text-sm text-stone-400">กำลังโหลด...</div>

  const totals = data.totals
  const fs = data.financial_statements

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 32 }}>
        {[
          { label: "รายได้ (เอกสาร)", value: totals.revenue_documented, color: "#2f9e44" },
          { label: "เงินเข้า verified", value: totals.payments_received_verified, color: "#1971c2" },
          { label: "ลูกหนี้/ค้างรับ", value: totals.outstanding_debt, color: "#e8590c" },
          { label: "รอตรวจสอบ", value: totals.unverified_transfer_slips, color: "#f08c00", sub: `${totals.unverified_transfer_slips_count} สลิป` },
          { label: "ค่าใช้จ่ายบริษัท", value: totals.company_expenses, color: "#c92a2a" },
        ].map((c) => (
          <div key={c.label} style={{ border: "1px solid #eee", borderRadius: 8, padding: 14, background: "#fff" }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{thb(c.value)}</div>
            <div style={{ fontSize: 11, color: "#888" }}>฿{c.sub ? ` · ${c.sub}` : ""}</div>
          </div>
        ))}
      </div>

      {data.months.length > 0 && (
        <div>
          <Bars months={data.months} field="revenue_documented" color="#2f9e44" label="รายได้ตามเดือน (฿)" />
          <Bars months={data.months} field="payments_received_verified" color="#1971c2" label="เงินเข้า verified ตามเดือน (฿)" />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 24 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>งบกำไร-ขาดทุน (cash basis)</div>
          <div style={{ fontSize: 12, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>รายได้</span><b>{thb(fs.profit_and_loss.revenue_documented)} ฿</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>ค่าใช้จ่าย</span><b>{thb(fs.profit_and_loss.expenses_recorded)} ฿</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>กำไรขั้นต้น</span><b>{thb(fs.profit_and_loss.gross_cash_margin)} ฿</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>กำไรสุทธิ (เอกสาร)</span><b>{thb(fs.profit_and_loss.net_document_margin)} ฿</b></div>
          </div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>กระแสเงินสด</div>
          <div style={{ fontSize: 12, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>เงินเข้า verified</span><b>{thb(fs.cash_basis.cash_in_verified)} ฿</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>เงินออกที่บันทึก</span><b>{thb(fs.cash_basis.cash_out_recorded)} ฿</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>เงินสดสุทธิ</span><b>{thb(fs.cash_basis.net_cash_movement)} ฿</b></div>
          </div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>ฐานะการเงิน</div>
          <div style={{ fontSize: 12, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>เงินสด verified</span><b>{thb(fs.statement_of_financial_position.cash_verified)} ฿</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>ลูกหนี้/ค้างรับ</span><b>{thb(fs.statement_of_financial_position.receivables_known)} ฿</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>รอตรวจสอบ</span><b>{thb(fs.statement_of_financial_position.pending_verification_assets)} ฿</b></div>
          </div>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "#888", marginTop: 8 }}>{fs.statement_of_financial_position.data_gap_note}</p>
      {/* Real expense category breakdown (owner, 2026-07-31): แยกตามบิลจริง
         จาก company_expenses — same source as the totals cards above */}
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
