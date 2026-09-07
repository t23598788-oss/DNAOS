/**
 * หน้าที่: DNA OS ออกใบมอบอำนาจให้ตัวเองตามงาน โดยผู้ขอไม่ต้องรู้ session หรือ
 * authority_id — ใช้ ./lease.ts เดิมทั้งหมด ไม่มี lease system ใหม่
 *
 * Owner, 2026-09-05: เดิมเจ้าของต้อง curl authenticate แล้ว copy session_id
 * แล้ว grant แล้ว copy authority_id ให้ผู้ขอทุกครั้ง นั่นไม่ใช่ authority model
 * ที่ต้องการ ที่นี่ผู้ขอส่งแค่ "จะทำอะไร" ส่วนการหา session และออกใบเป็นของ DNA OS
 *
 * แต่ไม่ได้ลดด่านลง: session ต้องมาจากการยืนยันตัวตนจริงของเจ้าของเท่านั้น
 * (../owner-authentication/human-verification.ts) โหมดต้องไม่ใช่ OFF และ
 * operation ที่ขอต้องไม่เกินเพดานที่เจ้าของอนุมัติไว้ตอนยืนยัน
 *
 * Input: WorkLeaseRequest (ไม่มี session_id / authority_id)
 * Output: WorkLeaseOutcome — authority_id เป็นตัวชี้ภายใน ไม่ส่งกลับให้ผู้ขอ
 * Dependency ที่อนุญาต: ./lease.ts, ./levels.ts, ../owner-authentication/
 * สิ่งที่ห้ามแตะ:
 * - ห้ามออกใบเมื่อไม่มี session ที่ผ่านการยืนยันตัวตนจริง
 * - ห้ามให้ผู้ขอส่ง executor หรือ owner_session_id มาเอง
 * - ห้ามคืน authority_id ให้ผู้ขอ
 * - ห้ามเดาเพดานเมื่ออ่านไม่ได้ — อ่านไม่ได้คือปฏิเสธ
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { grantAuthority } from "./lease";
import { listLeases } from "./store";
import { OPERATION_LEVEL } from "./levels";
import { findChallenge, type AuthorityClass } from "../owner-authentication/human-verification";
import { validateOwnerSession } from "../owner-authentication/contract";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODE_FILE = join(HERE, "data", "control-mode.jsonl");
const SESSION_FILE = join(process.cwd(), "control/owner-authentication/data/owner-sessions.jsonl");

export type ControlMode = "OFF" | "PER_TASK" | "CONTINUOUS";
export const DEFAULT_MODE: ControlMode = "OFF";

/** ระดับ 0-4 ของ ./levels.ts -> ชั้นความเสี่ยงที่เจ้าของอนุมัติตอนยืนยัน */
const CLASS_ORDER: readonly AuthorityClass[] = [
  "CLASS_0_READ", "CLASS_1_NAVIGATION", "CLASS_2_INPUT",
  "CLASS_3_SECURITY_OR_EXTERNAL_CONFIG", "CLASS_4_IRREVERSIBLE",
];
export function classOfOperation(op: string): AuthorityClass {
  // operation ที่แคตตาล็อกไม่รู้จัก = ถือเป็นชั้นสูงสุด ไม่ใช่ปล่อยผ่าน
  const known = (OPERATION_LEVEL as Record<string, number>)[op];
  if (known === undefined) return "CLASS_4_IRREVERSIBLE";
  const level = Math.max(0, Math.min(known, CLASS_ORDER.length - 1));
  return CLASS_ORDER[level]!;
}
function rank(c: AuthorityClass): number { return CLASS_ORDER.indexOf(c); }

export function readControlMode(): ControlMode {
  if (!existsSync(MODE_FILE)) return DEFAULT_MODE;
  let mode: ControlMode = DEFAULT_MODE;
  for (const line of readFileSync(MODE_FILE, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    try { const r = JSON.parse(line) as { mode?: ControlMode }; if (r.mode) mode = r.mode; } catch { /* ข้าม */ }
  }
  return mode;
}

/** เปลี่ยนโหมดได้เฉพาะผู้ที่ถือ session ที่ผ่านการยืนยันตัวตนจริง */
export function setControlMode(mode: ControlMode, ownerSessionId: string):
  { ok: true; mode: ControlMode } | { ok: false; reason_code: string; detail: string } {
  const v = validateOwnerSession(ownerSessionId) as { ok: boolean; reason_code?: string; detail?: string };
  if (!v.ok) return { ok: false, reason_code: v.reason_code ?? "OWNER_SESSION_INVALID", detail: v.detail ?? "session ใช้ไม่ได้" };
  mkdirSync(dirname(MODE_FILE), { recursive: true });
  appendFileSync(MODE_FILE, `${JSON.stringify({ mode, set_by: ownerSessionId, at: new Date().toISOString() })}\n`, "utf-8");
  return { ok: true, mode };
}

/** session ที่ยังใช้ได้และ "ผ่านการยืนยันตัวตนจริง" เท่านั้น — presence ล้วนไม่นับ */
function activeVerifiedSession(): { session_id: string; ceiling: AuthorityClass; expires_at: string } | null {
  if (!existsSync(SESSION_FILE)) return null;
  const latest = new Map<string, any>();
  for (const line of readFileSync(SESSION_FILE, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    try { const r = JSON.parse(line); if (r.session_id) latest.set(r.session_id, r); } catch { /* ข้าม */ }
  }
  const now = Date.now();
  for (const s of [...latest.values()].reverse()) {
    if (s.state !== "ACTIVE") continue;
    if (new Date(s.expires_at).getTime() <= now) continue;
    if (!String(s.authenticated_via ?? "").startsWith("human-verification")) continue;
    const ref = String(s.evidence_reference ?? "");
    const challengeId = ref.includes("#") ? ref.split("#")[1]! : "";
    const challenge = challengeId ? findChallenge(challengeId) : null;
    if (challenge === null) continue; // อ่านเพดานไม่ได้ = ไม่ใช้ใบนี้ ไม่ใช่เดาว่าเพดานสูง
    return { session_id: String(s.session_id), ceiling: challenge.requested_authority_class, expires_at: String(s.expires_at) };
  }
  return null;
}

export interface WorkLeaseRequest {
  readonly requester: string;
  readonly objective: string;
  readonly required_operations: readonly string[];
  readonly target: string;
  readonly work_id: string;
  readonly task_id: string | null;
  readonly ttl_seconds?: number;
}

export type WorkLeaseOutcome =
  | { readonly ok: true; readonly executor: string; readonly operations: readonly string[];
      readonly target: string; readonly expires_at: string; readonly mode: ControlMode }
  | { readonly ok: false; readonly reason_code: string; readonly detail: string; readonly mode: ControlMode };

export const DNA_OS_EXECUTOR = "control/computer-use-executor";

export function requestWorkLease(input: WorkLeaseRequest): WorkLeaseOutcome {
  const mode = readControlMode();
  if (mode === "OFF") {
    return { ok: false, reason_code: "COMPUTER_CONTROL_OFF", detail: "สิทธิ์ควบคุมคอมพิวเตอร์ปิดอยู่", mode };
  }
  const session = activeVerifiedSession();
  if (session === null) {
    return { ok: false, reason_code: "HUMAN_VERIFICATION_REQUIRED",
      detail: "ไม่มี session ที่เจ้าของยืนยันตัวตนไว้และยังไม่หมดอายุ", mode };
  }
  const exceeded = input.required_operations.filter((op) => rank(classOfOperation(op)) > rank(session.ceiling));
  if (exceeded.length > 0) {
    return { ok: false, reason_code: "AUTHORITY_CEILING_EXCEEDED",
      detail: `[${exceeded.join(",")}] อยู่เหนือเพดาน ${session.ceiling} ที่เจ้าของอนุมัติไว้`, mode };
  }
  /**
   * สัญญาของ ./lease.ts เดิมต้องการ owner/capability/scope ครบ — ส่งให้ตรงตามนั้น
   * scope ผูกกับ target ของงาน ไม่ใช่ "*" เพื่อให้ใบอนุญาตแคบตามงานจริง
   */
  const granted = grantAuthority({
    owner: session.session_id,
    requester: input.requester,
    executor: DNA_OS_EXECUTOR,
    capability: input.objective,
    operations: [...input.required_operations] as never,
    target: input.target,
    scope: [input.target],
    ttl_seconds: input.ttl_seconds ?? 900,
    high_risk_explicit: rank(session.ceiling) >= rank("CLASS_3_SECURITY_OR_EXTERNAL_CONFIG"),
  }) as { ok: boolean; reason_code?: string; detail?: string; lease?: { expires_at: string; authority_id: string } };

  if (!granted.ok) {
    return { ok: false, reason_code: granted.reason_code ?? "GRANT_DENIED", detail: granted.detail ?? "ออกใบไม่ได้", mode };
  }
  // authority_id เป็นตัวชี้ภายใน — ไม่ส่งกลับให้ผู้ขอโดยเจตนา
  return { ok: true, executor: DNA_OS_EXECUTOR, operations: input.required_operations,
    target: input.target, expires_at: granted.lease?.expires_at ?? "", mode };
}

/**
 * สะพานภายใน — ชั้น authority เป็นผู้ส่งงานเข้า executor เอง
 *
 * Owner, 2026-09-05: executor เดิมบังคับว่าใบงานต้องมี owner_session_id และ
 * authority_id แต่ผู้ขอไม่ควรถือทั้งสองค่า ก่อนหน้านี้จึงไม่มีเส้นทางใดพา lease
 * ไปถึง executor ได้เลย — ช่องว่างนี้เกิดจากการที่ requestWorkLease คืนแค่ผลลัพธ์
 * สาธารณะแล้วปล่อยให้ผู้ขอไปเขียน inbox เอง ซึ่งขัดกับกฎที่ว่าผู้ขอต้องไม่ถือ id
 *
 * ที่นี่ authority เป็นผู้เติม id ภายในและเขียน inbox ในรูปแบบเดิมทุกประการ
 * ผู้ขอไม่เคยเห็นและไม่เคยส่ง id เหล่านั้น — ฟิลด์ใดที่ผู้ขอแนบมาเองถูกทิ้ง
 * เพราะ DispatchRequest ไม่มีช่องให้ใส่ตั้งแต่ต้น
 *
 * ไม่มี lease model ใหม่ ไม่มี executor ใหม่ ไม่มี inbox ใหม่
 */
export interface DispatchRequest {
  readonly requester: string;
  readonly objective: string;
  readonly requested_operations: readonly string[];
  readonly target: string;
  readonly work_id: string;
  readonly task_id?: string | null;
  readonly ttl_seconds?: number;
  /** พารามิเตอร์ของ UI ที่ operation ต้องใช้ — ไม่มีสิทธิ์ใด ๆ อยู่ในนี้ */
  readonly ui?: Readonly<Record<string, unknown>>;
}

export type DispatchOutcome =
  | { readonly ok: true; readonly work_order_ids: readonly string[]; readonly executor: string;
      readonly operations: readonly string[]; readonly target: string; readonly expires_at: string;
      readonly mode: ControlMode }
  | { readonly ok: false; readonly reason_code: string; readonly detail: string;
      readonly mode: ControlMode; readonly dispatched: 0 };

const INBOX_DIR = join(process.cwd(), "control/computer-use-executor/data/inbox");

export function dispatchComputerUseWork(input: DispatchRequest): DispatchOutcome {
  // ด่านทั้งหมดของ requestWorkLease ทำงานก่อน — ปฏิเสธที่ใดก็ไม่มีใบงานถูกเขียน
  const lease = requestWorkLease({
    requester: input.requester, objective: input.objective,
    required_operations: input.requested_operations, target: input.target,
    work_id: input.work_id, task_id: input.task_id ?? null, ttl_seconds: input.ttl_seconds,
  });
  if (!lease.ok) {
    return { ok: false, reason_code: lease.reason_code, detail: lease.detail, mode: lease.mode, dispatched: 0 };
  }
  const session = activeVerifiedSession();
  if (session === null) {
    return { ok: false, reason_code: "HUMAN_VERIFICATION_REQUIRED",
      detail: "session หายไประหว่างการออกใบงาน", mode: lease.mode, dispatched: 0 };
  }
  const authorityId = lastGrantedAuthorityId();
  mkdirSync(INBOX_DIR, { recursive: true });
  const ids: string[] = [];
  // executor รับ operation เดียวต่อใบ — แตกตามจำนวน operation ที่ได้รับอนุญาต
  for (const operation of input.requested_operations) {
    const workOrderId = `wo-${randomUUID()}`;
    const item = {
      work_order_id: workOrderId,
      owner_session_id: session.session_id,   // เติมโดย authority ไม่ใช่ผู้ขอ
      authority_id: authorityId,              // เติมโดย authority ไม่ใช่ผู้ขอ
      requester: input.requester,
      operation, target: input.target,
      scope_needed: [input.target],
      work_id: input.work_id, task_id: input.task_id ?? null,
      ui: { target: input.target, scope: "chrome-tab", risk_confirmed: true, ...(input.ui ?? {}) },
    };
    writeFileSync(join(INBOX_DIR, `${workOrderId}.json`), JSON.stringify(item), "utf-8");
    ids.push(workOrderId);
  }
  return { ok: true, work_order_ids: ids, executor: DNA_OS_EXECUTOR,
    operations: input.requested_operations, target: input.target,
    expires_at: lease.expires_at, mode: lease.mode };
}

/** authority_id ของใบล่าสุด — อ่านจากสโตร์เดิม ไม่ได้เก็บสำเนาไว้เอง */
function lastGrantedAuthorityId(): string {
  try {
    const rows = listLeases() as readonly { authority_id?: string }[];
    return String(rows[rows.length - 1]?.authority_id ?? "");
  } catch { return ""; }
}
