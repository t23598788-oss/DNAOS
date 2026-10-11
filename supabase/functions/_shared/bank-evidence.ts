/**
 * Shared bank-evidence helpers for incoming-payment verification
 * (CANONICAL PAYMENT INTEGRITY & RECOVERY, owner mission 2026-10-11).
 *
 * WHY: bank-statement-reconcile matched a pending receipt on calendar-day +
 * amount ±5 ALONE — two facts the owner explicitly forbade as sufficient
 * ("ห้ามยืนยันเงินเข้าโดยอาศัยเพียง: จำนวนเงินตรงกัน / วันที่ตรงกัน / LINE
 * User ID ตรงกัน" — mission rule). The real statement row carries two more
 * pieces of bank-side evidence the matcher never read:
 *   · account_number — the RECEIVER account the money actually landed in
 *   · description    — the bank's own payer line ("จาก X2223 บจก. เคที คอนสตรัค++")
 *
 * This module is PURE evidence logic + one claim write. It never confirms a
 * payment, never writes money, and never runs without a caller that owns the
 * canonical chain (tryAutoConfirmPayment → Connect payment-confirm bridge →
 * receipt-confirm-flow → confirmPayment → confirm_payment_allocation RPC).
 *
 * Fail-closed contract: every function returns an explicit outcome and the
 * caller must map anything other than { kind: "matched" } to PENDING_REVIEW —
 * never AUTO_CONFIRM.
 */

// ── pure name/description matching (unit-tested, no I/O) ─────────────────────

/** Strip everything the bank pads/truncates with: punctuation, spaces, channel codes. */
export function normalizeBankName(s: string | null | undefined): string {
  return (s ?? "").replace(/[^0-9a-zA-z฀-๿]/g, "").toLowerCase()
}

/**
 * True when the bank's own description line plausibly names the slip's sender.
 *
 * Statement descriptions are TRUNCATED by the statement parser ("...++" marks
 * the cut, see scripts/bank-statement-sync parseStatementText), so we compare
 * the longest common prefix instead of full equality, and we strip the leading
 * bank noise the statement prepends ("จาก X2223 ", "KTB ", "SCB ", ...).
 *
 * MIN_COMMON_PREFIX = 8 normalized chars — long enough that a different payer
 * with the same amount on the same day cannot slip through on "นาย" or "บจก.".
 */
const MIN_COMMON_PREFIX = 8

export function descriptionMatchesSender(
  description: string | null | undefined,
  senderName: string | null | undefined,
): boolean {
  const sender = normalizeBankName(senderName)
  if (sender.length < MIN_COMMON_PREFIX) return false // sender unreadable → fail closed
  let desc = normalizeBankName(description)
  if (desc.length < MIN_COMMON_PREFIX) return false
  // drop leading bank noise: channel words + origin account code ("จากx2223", "ktbx3448")
  desc = desc.replace(/^(จาก|โอนเข้า|รับโอนเงินจาก|ktb|scb|kbank|bbl|tmb)/, "")
  desc = desc.replace(/^[0-9a-z]{4,}/, "") // bare origin account token e.g. "x2223"
  if (desc.length < MIN_COMMON_PREFIX) return false
  const n = Math.min(sender.length, desc.length)
  let common = 0
  while (common < n && sender[common] === desc[common]) common++
  return common >= MIN_COMMON_PREFIX
}

// ── statement row outcomes (the caller maps anything ≠ matched → PENDING) ────

export type StatementEvidenceOutcome =
  | { kind: "matched"; rowId: string }
  | { kind: "no_match" }
  | { kind: "ambiguous"; matches: number }
  | { kind: "insufficient"; reason: string }

export interface StatementCandidateRow {
  id: string
  account_number: string | null
  description: string | null
  matched_receipt_document_id: string | null
}

/**
 * Evaluate ONE pending claim against candidate statement rows already filtered
 * by day + amount ±5 + incoming kind by the caller's query.
 *
 * Evidence required beyond date/amount (mission rule):
 *   1. receiver account present on the statement row
 *   2. statement description names the slip's sender (bank's own payer line)
 *   3. exactly one candidate row (more than one = genuinely ambiguous)
 *   4. the row is not already claimed by ANOTHER receipt (double-use guard)
 */
export function evaluateStatementEvidence(opts: {
  candidates: StatementCandidateRow[]
  senderName: string | null | undefined
  receiptDocumentId: string
}): StatementEvidenceOutcome {
  const { candidates, senderName, receiptDocumentId } = opts
  if (candidates.length === 0) return { kind: "no_match" }
  if (candidates.length > 1) return { kind: "ambiguous", matches: candidates.length }

  const row = candidates[0]
  if (!row.account_number) {
    return { kind: "insufficient", reason: "statement row has no receiver account number" }
  }
  if (row.matched_receipt_document_id && row.matched_receipt_document_id !== receiptDocumentId) {
    return {
      kind: "insufficient",
      reason: `statement row already claimed by receipt ${row.matched_receipt_document_id}`,
    }
  }
  if (!descriptionMatchesSender(row.description, senderName)) {
    return {
      kind: "insufficient",
      reason: `bank description does not name sender "${senderName ?? "-"}" (statement: "${row.description ?? "-"}")`,
    }
  }
  return { kind: "matched", rowId: row.id }
}

// ── claim write (the ONE write in this module — evidence pointer, no money) ──

/**
 * The single UPDATE site for the statement-row claim (Connect Boundary Census
 * counts business write sites — claim AND release share this one site).
 *
 * nextOwner = receipt id → claim: the row may only be taken when it is free or
 * already owned by the same receipt (atomic single-use evidence).
 * nextOwner = null        → release: give the row back, but only if the
 * guardOwner receipt still owns it (failed confirm never strands evidence).
 */
async function applyStatementClaim(
  supabase: { from: (t: string) => any },
  rowId: string,
  nextOwner: string | null,
  guardOwner: string,
): Promise<boolean> {
  try {
    const filter =
      nextOwner === null
        ? `matched_receipt_document_id.eq.${guardOwner}`
        : `matched_receipt_document_id.is.null,matched_receipt_document_id.eq.${nextOwner}`
    const { data, error } = await supabase
      .from("bank_statement_transactions")
      .update({ matched_receipt_document_id: nextOwner })
      .eq("id", rowId)
      .or(filter)
      .select("id")
    if (error) return false // fail closed — caller leaves the receipt pending
    return (data ?? []).length === 1
  } catch {
    return false
  }
}

/**
 * Atomically claim a statement row for one receipt. Returns false when another
 * receipt won the row between match and claim (double-confirmation guard) or
 * on any error. The caller MUST releaseStatementClaim() when the canonical
 * writer rejects, so a failed attempt never strands the row.
 */
export function claimStatementRow(
  supabase: { from: (t: string) => any },
  rowId: string,
  receiptDocumentId: string,
): Promise<boolean> {
  return applyStatementClaim(supabase, rowId, receiptDocumentId, receiptDocumentId)
}

/** Give the row back when the confirm attempt did NOT succeed (best-effort). */
export function releaseStatementClaim(
  supabase: { from: (t: string) => any },
  rowId: string,
  receiptDocumentId: string,
): Promise<boolean> {
  return applyStatementClaim(supabase, rowId, null, receiptDocumentId)
}

