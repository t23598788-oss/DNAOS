export interface FinanceStatementInputs {
  revenueDocumented: number
  paymentsReceivedVerified: number
  fuelBills: number
  outstandingDebt: number
  unverifiedTransferSlips: number
  companyExpenses: number
}

export interface FinancialStatements {
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

function money(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100
}

export function buildFinancialStatements(input: FinanceStatementInputs): FinancialStatements {
  const revenueDocumented = money(input.revenueDocumented)
  const paymentsReceivedVerified = money(input.paymentsReceivedVerified)
  const fuelBills = money(input.fuelBills)
  const outstandingDebt = money(input.outstandingDebt)
  const unverifiedTransferSlips = money(input.unverifiedTransferSlips)
  const companyExpenses = money(input.companyExpenses)

  const expensesRecorded = companyExpenses > 0 ? companyExpenses : fuelBills
  const receivablesKnown = outstandingDebt > 0
    ? outstandingDebt
    : Math.max(0, revenueDocumented - paymentsReceivedVerified)

  return {
    profit_and_loss: {
      revenue_documented: revenueDocumented,
      expenses_recorded: money(expensesRecorded),
      gross_cash_margin: money(paymentsReceivedVerified - expensesRecorded),
      net_document_margin: money(revenueDocumented - expensesRecorded),
    },
    statement_of_financial_position: {
      cash_verified: paymentsReceivedVerified,
      receivables_known: money(receivablesKnown),
      pending_verification_assets: unverifiedTransferSlips,
      liabilities_known: null,
      equity_known: null,
      data_gap_note:
        "งบฐานะการเงินนี้แสดงเฉพาะเงินสดที่ยืนยันแล้ว ลูกหนี้/ยอดค้างรับที่ระบบมี และสลิปที่รอตรวจสอบ ระบบยังไม่มีบัญชีทุน สินทรัพย์ถาวร และหนี้สินโครงสร้างจริง จึงไม่เติมตัวเลขฝั่ง liabilities/equity",
    },
    cash_basis: {
      cash_in_verified: paymentsReceivedVerified,
      cash_out_recorded: money(expensesRecorded),
      net_cash_movement: money(paymentsReceivedVerified - expensesRecorded),
    },
  }
}
