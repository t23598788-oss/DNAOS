/**
 * Debt Status — State Machine
 *
 * Event เปลี่ยนสถานะ ไม่ใช่ AI
 */

export type DebtStatus =
  | "ACTIVE_CREDIT"
  | "WAIT_PAYMENT"
  | "OVERDUE"
  | "DEBT"
  | "COLLECTION"
  | "PARTIAL_PAYMENT"
  | "CLOSED";

export interface StatusTransition {
  from: DebtStatus;
  to: DebtStatus;
  trigger: string;
  timestamp: number;
}

const transitions: Record<string, DebtStatus> = {
  "customer_received":    "ACTIVE_CREDIT",
  "due_date_reached":     "WAIT_PAYMENT",
  "grace_period_expired": "OVERDUE",
  "customer_acknowledged":"DEBT",
  "collection_started":   "COLLECTION",
  "partial_payment":      "PARTIAL_PAYMENT",
  "full_payment":         "CLOSED",
};

export function nextStatus(event: string): DebtStatus | null {
  return transitions[event] ?? null;
}

export function isTerminal(status: DebtStatus): boolean {
  return status === "CLOSED";
}

export function canAccrueInterest(status: DebtStatus): boolean {
  return status === "DEBT" || status === "COLLECTION" || status === "PARTIAL_PAYMENT";
}

export function canChargeCollectionFee(status: DebtStatus): boolean {
  return status === "COLLECTION";
}
