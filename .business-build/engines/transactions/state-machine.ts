/**
 * Transaction State Machine
 *
 * Thin wrapper เหนือ Workflow Registry
 * State (TxEvent) เป็น universal — ความหมายต่อประเภทงานอยู่ใน workflows.ts
 */

export { type TxEvent, type TxType, type TxWorkflow, type WorkflowStep, type ExpectedDoc } from "./workflows";

import { getWorkflow, getNextStep, isFinalEvent, isPendingEvent } from "./workflows";

/** ปุ่ม action ที่กดได้จาก current event ของ tx_type นั้น (มักได้ 1 step เสมอ) */
export function getAvailableActions(txType: string, currentEvent: string) {
  const workflow = getWorkflow(txType);
  const next = getNextStep(workflow, currentEvent);
  return next ? [next] : [];
}

/** ยืนยันว่า action นี้ถูก state และ tx_type นั้น */
export function resolveTransition(txType: string, currentEvent: string, action: string) {
  const workflow = getWorkflow(txType);
  const next = getNextStep(workflow, currentEvent);
  if (!next || next.action !== action) return undefined;
  return { to: next.event, biz_event: next.biz_event, label: next.action_label };
}

export { getWorkflow, isFinalEvent, isPendingEvent };
