/**
 * DNA OS Objective Contract
 *
 * โครงสร้างข้อมูลกลางที่ทุก Module ใช้ร่วมกัน
 * Objective เป็น Immutable — ห้าม Module ใดแก้ไข
 * ถ้าต้องเปลี่ยนเป้าหมาย ต้องสร้าง Objective ใหม่
 */

export interface SessionSnapshot {
  who: string | null;
  who_id: string | null;
  current_goal: string | null;
  current_workspace: string | null;
  current_business_object: { type: string; id: string | null; name: string | null } | null;
  pending_actions: string[];
  last_tool_results: unknown[];
  history: string[];
}

export interface Objective {
  readonly id: string;
  readonly type: string;
  readonly scope: "session" | "global";
  readonly priority: number;
  readonly businessObjects: string[];
  readonly who: string | null;
  readonly who_id: string | null;
  readonly expectedOutcome: string;
  readonly raw_input: string;
  readonly context: SessionSnapshot;
  readonly constraints: string[];
  readonly success_criteria: string[];
}

export function createObjective(fields: Omit<Objective, "id">): Objective {
  return Object.freeze({
    id: `obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...fields,
  });
}
