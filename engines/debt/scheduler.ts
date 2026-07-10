/**
 * Debt Scheduler — ตรวจครบกำหนด + สร้าง Event อัตโนมัติ
 *
 * ระบบเรียกตรวจเป็นรอบ (cron / realtime)
 * ถ้าครบเงื่อนไข → สร้าง TransitionEvent ให้ Engine
 */

import { checkOverdue } from "./overdue";
import type { TransitionEvent } from "./transition";

export interface DebtRecord {
  id: string;
  status: string;
  dueDate: string;
  gracePeriodHours: number;
}

export interface SchedulerResult {
  debtId: string;
  action: "none" | "remind" | "overdue_trigger" | "already_processed";
  event?: TransitionEvent;
}

export function checkDebtSchedule(
  debt: DebtRecord,
  now: Date = new Date()
): SchedulerResult {
  if (debt.status !== "OUTSTANDING" && debt.status !== "WAIT_PAYMENT") {
    return { debtId: debt.id, action: "already_processed" };
  }

  const due = new Date(debt.dueDate);
  const overdueCheck = checkOverdue(due, debt.gracePeriodHours, now);

  // ก่อนครบกำหนด 24 ชม. → แจ้งเตือน
  const reminderTime = new Date(due.getTime() - 24 * 3600_000);
  if (now >= reminderTime && now < due && debt.status === "OUTSTANDING") {
    return {
      debtId: debt.id,
      action: "remind",
      event: { debtId: debt.id, event: "due_date_reached", actor: "system", timestamp: now.getTime() },
    };
  }

  // เลย grace period → trigger overdue
  if (overdueCheck.isOverdue) {
    return {
      debtId: debt.id,
      action: "overdue_trigger",
      event: { debtId: debt.id, event: "grace_period_expired", actor: "system", timestamp: now.getTime() },
    };
  }

  return { debtId: debt.id, action: "none" };
}

export function checkBatch(debts: DebtRecord[], now: Date = new Date()): SchedulerResult[] {
  return debts.map((d) => checkDebtSchedule(d, now));
}
