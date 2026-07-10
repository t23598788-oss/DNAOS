/**
 * Debt Transition — เปลี่ยนสถานะจาก Event
 *
 * Engine เปลี่ยนสถานะ ไม่ใช่ AI
 * ทุก transition ถูก log เป็น audit trail
 */

import { type DebtStatus, nextStatus, isTerminal } from "./status";

export interface TransitionEvent {
  debtId: string;
  event: string;
  actor: "system" | "human";
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface TransitionResult {
  ok: boolean;
  from: DebtStatus;
  to: DebtStatus | null;
  event: string;
  error?: string;
}

export function applyTransition(
  currentStatus: DebtStatus,
  event: TransitionEvent
): TransitionResult {
  if (isTerminal(currentStatus)) {
    return { ok: false, from: currentStatus, to: null, event: event.event, error: "บัญชีปิดแล้ว ไม่สามารถเปลี่ยนสถานะได้" };
  }

  const to = nextStatus(event.event);
  if (!to) {
    return { ok: false, from: currentStatus, to: null, event: event.event, error: `ไม่รู้จัก event: ${event.event}` };
  }

  return { ok: true, from: currentStatus, to, event: event.event };
}

export function buildTransitionChain(events: TransitionEvent[]): {
  finalStatus: DebtStatus;
  transitions: TransitionResult[];
} {
  let current: DebtStatus = "ACTIVE_CREDIT";
  const transitions: TransitionResult[] = [];

  for (const ev of events) {
    const result = applyTransition(current, ev);
    transitions.push(result);
    if (result.ok && result.to) current = result.to;
  }

  return { finalStatus: current, transitions };
}
