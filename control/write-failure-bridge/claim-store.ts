/**
 * หน้าที่: ขอบเขตการ "อ้างสิทธิ์เหตุการณ์ต้นทาง" ที่แคบที่สุด — ทำให้
 * (source_event_type, source_event_id, purpose) สร้างงานแก้ไขได้อย่างมากหนึ่งงาน
 * ตลอดไป ข้ามการ restart และข้ามสถานะปลายทางของงานนั้น
 *
 * ทำไมไม่ใช้ idempotency ของ submitTask อย่างเดียว: วัดมาแล้วว่าการกันซ้ำใน
 * `control/agent-gateway/gateway.ts#submitTask` ทำงานเฉพาะเมื่องานเดิมมีสถานะ
 * อยู่ในรายการที่ยัง active — งานที่จบเป็น FAILED จะไม่ถูกกัน ซึ่งเป็นสถานะที่
 * งานซ่อมมีโอกาสจบบ่อยที่สุด การแก้รายการนั้นจะเปลี่ยนความหมายให้ caller ทุกราย
 * ในระบบ จึงไม่แตะ และสร้างขอบเขตนี้ขึ้นมารับผิดชอบเฉพาะเรื่องนี้แทน
 *
 * ATOMIC มาจากของที่พิสูจน์แล้ว ไม่ได้เขียนใหม่: `execution/process-lock/`
 * ใช้ O_CREAT|O_EXCL จริงระดับ OS เป็น mutex ข้ามโปรเซส — รูปแบบเดียวกับที่
 * `control/duplicate-reservation/resolver.ts` ใช้ปิดช่อง TOCTOU ของการลงทะเบียน
 *
 * PERMANENT มาจาก JSONL ไม่ใช่จาก lock: lock มีอายุและถูกปล่อยเสมอ ส่วนบันทึก
 * การอ้างสิทธิ์อยู่บนดิสก์แบบ append-only ตามแบบของ store อื่นในที่นี้ การอ่าน
 * เกิดสด ๆ ภายใน critical section ทุกครั้ง จึงเห็นผู้ชนะก่อนหน้าเสมอแม้คนละโปรเซส
 *
 * การอ้างสิทธิ์ไม่ถูกปล่อยเมื่อขั้นถัดไปล้มเหลว: ถ้าอ้างสำเร็จแล้วสร้างงานไม่ได้
 * จะบันทึกสถานะ CLAIM_HELD_WORK_NOT_CREATED ไว้ ไม่ปล่อยเหตุการณ์กลับให้ลองใหม่
 * เอง — นโยบาย retry เป็นเรื่องที่ Owner ต้องสั่ง ไม่ใช่สิ่งที่ไฟล์นี้คิดขึ้น
 *
 * Input: ตัวตนของเหตุการณ์ + purpose + holder
 * Output: `claimSourceEvent`, `bindCorrectiveTask`, `markWorkNotCreated`,
 * `listClaims`, `findClaim`, `CLAIM_FILE`
 * Dependency ที่อนุญาต: node:fs, node:path, node:crypto,
 * ../../execution/process-lock/contract.ts
 * สิ่งที่ห้ามแตะ: ห้ามลบหรือเขียนทับแถวเดิม (append-only) และห้ามเพิ่มทางที่
 * ปล่อยการอ้างสิทธิ์อัตโนมัติ
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { acquireLock, releaseLock } from "../../execution/process-lock/contract";

export const CLAIM_PURPOSE_CORRECTIVE_WORK = "CORRECTIVE_WORK";

function claimFilePath(): string {
  return process.env.WRITE_FAILURE_CLAIM_FILE
    ?? join(__dirname, "data", "source-event-claims.jsonl");
}
export const CLAIM_FILE = claimFilePath;

export type ClaimState =
  | "CLAIMED"
  | "BOUND"
  | "CLAIM_HELD_WORK_NOT_CREATED";

export interface SourceEventClaim {
  readonly claim_id: string;
  readonly source_event_type: string;
  readonly source_event_id: string;
  readonly purpose: string;
  readonly state: ClaimState;
  /** null จนกว่างานแก้ไขจะถูกสร้างจริงและผูกกลับมา */
  readonly corrective_task_id: string | null;
  readonly holder_id: string;
  readonly recorded_at: string;
  /** เหตุผลเชิงเครื่อง ไม่ใช่คำบรรยาย */
  readonly reason_code: string | null;
}

function claimKey(type: string, id: string, purpose: string): string {
  return `${type}::${id}::${purpose}`;
}

function append(row: SourceEventClaim): void {
  const p = claimFilePath();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(row)}\n`, "utf-8");
}

/** อ่านสด ๆ จากดิสก์เสมอ — ไม่มี cache ในหน่วยความจำ จึงปลอดภัยข้าม restart */
export function listClaims(): readonly SourceEventClaim[] {
  const p = claimFilePath();
  if (!existsSync(p)) return [];
  const rows: SourceEventClaim[] = [];
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as SourceEventClaim); } catch { /* แถวเสียข้ามไป ไม่ลบ */ }
  }
  return rows;
}

/** แถวล่าสุดของกุญแจนั้น — append-only จึงตัดสินด้วย "แถวหลังสุดชนะ" */
export function findClaim(type: string, id: string, purpose: string): SourceEventClaim | null {
  const key = claimKey(type, id, purpose);
  return listClaims().filter((c) => claimKey(c.source_event_type, c.source_event_id, c.purpose) === key).at(-1) ?? null;
}

export type ClaimOutcome =
  | { readonly status: "CLAIMED"; readonly claim: SourceEventClaim }
  | { readonly status: "DENIED"; readonly reason_code: "ALREADY_CLAIMED" | "LOCK_CONFLICT"; readonly existing: SourceEventClaim | null; readonly held_by: string | null };

export interface ClaimInput {
  readonly source_event_type: string;
  readonly source_event_id: string;
  readonly purpose: string;
  readonly holder_id: string;
  readonly lease_ms?: number;
}

/**
 * อ้างสิทธิ์หนึ่งเหตุการณ์ ครั้งเดียวตลอดไป
 *
 * ลำดับสำคัญ: ล็อกก่อน -> อ่านดิสก์สดภายในล็อก -> ตัดสิน -> เขียน -> ปลดล็อก
 * การอ่านก่อนล็อกจะเปิดช่อง TOCTOU ที่ทำให้สองผู้เรียกพร้อมกันชนะทั้งคู่
 */
export function claimSourceEvent(input: ClaimInput): ClaimOutcome {
  const lockKey = `SOURCE_EVENT_CLAIM:${claimKey(input.source_event_type, input.source_event_id, input.purpose)}`;
  const lock = acquireLock({ lock_key: lockKey, holder_id: input.holder_id, lease_ms: input.lease_ms ?? 30_000 });
  if (lock.status !== "ACQUIRED") {
    return { status: "DENIED", reason_code: "LOCK_CONFLICT", existing: null, held_by: lock.held_by?.holder_id ?? null };
  }
  try {
    const existing = findClaim(input.source_event_type, input.source_event_id, input.purpose);
    if (existing) {
      // มีเจ้าของแล้ว ไม่ว่างานปลายทางจะจบอย่างไร — COMPLETED, FAILED หรือยังไม่ถูกสร้าง
      return { status: "DENIED", reason_code: "ALREADY_CLAIMED", existing, held_by: null };
    }
    const claim: SourceEventClaim = {
      claim_id: `claim-${randomUUID()}`,
      source_event_type: input.source_event_type,
      source_event_id: input.source_event_id,
      purpose: input.purpose,
      state: "CLAIMED",
      corrective_task_id: null,
      holder_id: input.holder_id,
      recorded_at: new Date().toISOString(),
      reason_code: null,
    };
    append(claim);
    return { status: "CLAIMED", claim };
  } finally {
    releaseLock(lockKey, input.holder_id);
  }
}

/** ผูกงานที่สร้างสำเร็จกลับเข้ากับการอ้างสิทธิ์ — append แถวใหม่ ไม่แก้แถวเดิม */
export function bindCorrectiveTask(claim: SourceEventClaim, correctiveTaskId: string): SourceEventClaim {
  const bound: SourceEventClaim = { ...claim, state: "BOUND", corrective_task_id: correctiveTaskId, recorded_at: new Date().toISOString(), reason_code: null };
  append(bound);
  return bound;
}

/**
 * อ้างสิทธิ์สำเร็จแต่สร้างงานไม่ได้ — บันทึกไว้ตรง ๆ และ **ไม่ปล่อย**
 * เหตุการณ์กลับ กุญแจยังถูกถือไว้ การส่ง event เดิมมาอีกจะยังถูกปฏิเสธ
 */
export function markWorkNotCreated(claim: SourceEventClaim, reasonCode: string): SourceEventClaim {
  const held: SourceEventClaim = { ...claim, state: "CLAIM_HELD_WORK_NOT_CREATED", corrective_task_id: null, recorded_at: new Date().toISOString(), reason_code: reasonCode };
  append(held);
  return held;
}
