/**
 * Overdue Detection
 *
 * ตรวจสอบว่าครบกำหนด + เลย grace period หรือยัง
 * grace_period มาจาก policy ไม่ hardcode
 */

export interface OverdueCheck {
  isOverdue: boolean;
  dueDate: Date;
  graceExpiry: Date;
  hoursOverdue: number;
}

export function checkOverdue(
  dueDate: Date,
  gracePeriodHours: number,
  asOf: Date = new Date()
): OverdueCheck {
  const graceExpiry = new Date(dueDate.getTime() + gracePeriodHours * 3600_000);
  const isOverdue = asOf.getTime() > graceExpiry.getTime();
  const hoursOverdue = isOverdue
    ? Math.floor((asOf.getTime() - graceExpiry.getTime()) / 3600_000)
    : 0;

  return { isOverdue, dueDate, graceExpiry, hoursOverdue };
}
