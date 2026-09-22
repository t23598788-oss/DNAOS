/**
 * Shared pure debt formula for Node and Supabase Edge runtimes.
 *
 * @deprecated LEGACY (Phase E5.5, 2026-09-22) — NOT a financial production path.
 * The debt figure every finance route now reads is the canonical ledger projection
 * (`company_debt_current` → `engines/canonical/debt-write.ts#refreshDebtSnapshotFromLedger`).
 * This calculator accrues interest/penalty from a principal snapshot, which is a
 * DIFFERENT number from the ledger and must never be used to derive money for
 * finance/credit/reminder paths again. Remaining callers are the debt-tracking
 * tracker UI/API only (its own domain) — do not add new callers.
 */

export const DEBT_TRACKING_INTEREST_RATE = 0.25
export const DEBT_TRACKING_PENALTY_PER_DAY = 100
export const DEBT_TRACKING_GRACE_DAYS = 30

export interface FreezeWindow { from: string; until: string | null }

export interface DebtTrackingInput {
  principalAmount: number
  feeRate: number
  interestStartAt: string
  asOfDate?: string
  freezeFrom?: string | null
  freezeUntil?: string | null
  freezeWindows?: FreezeWindow[]
  // Manual corrections (owner, admin-triggered via debt-trackings/[id]/events
  // "adjust_fee"/"adjust_interest" — a signed delta, reason required at the
  // API layer). Optional/defaulted to 0 so existing callers that never pass
  // these are unaffected.
  manualAdjustmentAmount?: number
  manualInterestAdjustmentAmount?: number
}

export interface DebtEventRow { event_type: string; occurred_at: string; amount?: number | null }

export interface DebtTrackingSummary {
  principalAmount: number
  feeRate: number
  feeAmount: number
  daysElapsed: number
  interestRate: number
  interestAmount: number
  defaultDate: string
  daysOverdue: number
  penaltyAmount: number
  manualAdjustmentAmount: number
  manualInterestAdjustmentAmount: number
  totalAmount: number
}

function roundMoney(value: number): number { return Math.round(value * 100) / 100 }
function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000))
}
function frozenOverlapDays(start: Date, end: Date, from: Date | null, until: Date | null): number {
  if (!from) return 0
  const freezeEnd = until ?? end
  const overlapStart = from > start ? from : start
  const overlapEnd = freezeEnd < end ? freezeEnd : end
  return Math.max(0, Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / 86_400_000))
}
function totalFrozenDays(start: Date, end: Date, windows: FreezeWindow[]): number {
  return windows.reduce((sum, window) => sum + frozenOverlapDays(
    start, end, new Date(window.from), window.until ? new Date(window.until) : null,
  ), 0)
}

export function deriveFreezeWindows(events: DebtEventRow[]): FreezeWindow[] {
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
  const windows: FreezeWindow[] = []
  let openFrom: string | null = null
  for (const event of sorted) {
    if (event.event_type === "collection_paused" && !openFrom) openFrom = event.occurred_at
    else if (event.event_type === "collection_resumed" && openFrom) {
      windows.push({ from: openFrom, until: event.occurred_at })
      openFrom = null
    }
  }
  if (openFrom) windows.push({ from: openFrom, until: null })
  return windows
}

export function calcDebtTrackingSummary(input: DebtTrackingInput): DebtTrackingSummary {
  const start = new Date(input.interestStartAt)
  const asOf = input.asOfDate ? new Date(input.asOfDate) : new Date()
  const windows = input.freezeWindows?.length
    ? input.freezeWindows
    : input.freezeFrom ? [{ from: input.freezeFrom, until: input.freezeUntil ?? null }] : []
  const daysElapsedRaw = daysBetween(start, asOf)
  const daysElapsed = Math.max(0, daysElapsedRaw - totalFrozenDays(start, asOf, windows))
  const feeAmount = roundMoney(input.principalAmount * (input.feeRate / 100))
  const base = input.principalAmount + feeAmount
  const interestAmount = roundMoney((base * DEBT_TRACKING_INTEREST_RATE * daysElapsed) / 365)
  const defaultDate = new Date(start)
  defaultDate.setDate(defaultDate.getDate() + DEBT_TRACKING_GRACE_DAYS)
  const daysOverdueRaw = daysBetween(defaultDate, asOf)
  const daysOverdue = Math.max(0, daysOverdueRaw - totalFrozenDays(defaultDate, asOf, windows))
  const penaltyAmount = roundMoney(daysOverdue * DEBT_TRACKING_PENALTY_PER_DAY)
  const manualAdjustmentAmount = roundMoney(input.manualAdjustmentAmount ?? 0)
  const manualInterestAdjustmentAmount = roundMoney(input.manualInterestAdjustmentAmount ?? 0)
  return {
    principalAmount: input.principalAmount,
    feeRate: input.feeRate,
    feeAmount,
    daysElapsed,
    interestRate: DEBT_TRACKING_INTEREST_RATE,
    interestAmount,
    defaultDate: defaultDate.toISOString().split("T")[0],
    daysOverdue,
    penaltyAmount,
    manualAdjustmentAmount,
    manualInterestAdjustmentAmount,
    totalAmount: roundMoney(base + interestAmount + penaltyAmount + manualAdjustmentAmount + manualInterestAdjustmentAmount),
  }
}
