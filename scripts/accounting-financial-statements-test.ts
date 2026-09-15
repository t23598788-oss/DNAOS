import assert from "node:assert/strict"
import { buildFinancialStatements } from "../engines/accounting/financial-statements"

{
  const statements = buildFinancialStatements({
    revenueDocumented: 100000,
    paymentsReceivedVerified: 65000,
    fuelBills: 8000,
    outstandingDebt: 35000,
    unverifiedTransferSlips: 12000,
    companyExpenses: 22000,
  })

  assert.equal(statements.profit_and_loss.revenue_documented, 100000)
  assert.equal(statements.profit_and_loss.expenses_recorded, 22000)
  assert.equal(statements.profit_and_loss.net_document_margin, 78000)
  assert.equal(statements.cash_basis.net_cash_movement, 43000)
  assert.equal(statements.statement_of_financial_position.cash_verified, 65000)
  assert.equal(statements.statement_of_financial_position.receivables_known, 35000)
  assert.equal(statements.statement_of_financial_position.pending_verification_assets, 12000)
  assert.equal(statements.statement_of_financial_position.liabilities_known, null)
  assert.equal(statements.statement_of_financial_position.equity_known, null)
}

{
  const statements = buildFinancialStatements({
    revenueDocumented: 50000,
    paymentsReceivedVerified: 30000,
    fuelBills: 7000,
    outstandingDebt: 0,
    unverifiedTransferSlips: 0,
    companyExpenses: 0,
  })

  assert.equal(statements.profit_and_loss.expenses_recorded, 7000)
  assert.equal(statements.statement_of_financial_position.receivables_known, 20000)
}

console.log("accounting-financial-statements-test: PASS")
