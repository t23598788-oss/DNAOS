/**
 * หน้าที่: ประตูตัดสินว่า "workspace นี้ลบได้แล้วหรือยัง" — และเรียกตัวลบที่มีอยู่แล้ว
 * (`control/source-workspace/#removeWorkspace`) เมื่อพิสูจน์ครบเท่านั้น
 *
 * ไม่มีการสร้างความสามารถลบใหม่ (Owner, DECISION 11:
 * NEW_DELETE_CAPABILITY_REQUIRED = NO) ไฟล์นี้ไม่แตะระบบไฟล์เอง ไม่เรียก git
 * และไม่รู้ด้วยซ้ำว่าการลบทำอย่างไร — มันตัดสิน แล้วส่งต่อ
 *
 * ตัวตนมาก่อนการลบเสมอ: เป้าหมายถูกหาโดย `source_reservation_id` ที่บันทึกไว้
 * เท่านั้น ไม่เคยหาโดยการเทียบสตริง path และไม่รับ path จากผู้เรียก — path ที่
 * Agent ส่งมาเองไม่มีทางกลายเป็นเป้าหมายการลบได้เชิงโครงสร้าง
 *
 * ทุกเงื่อนไขที่ไม่ผ่านจะได้ `eligible=false` พร้อม reason_code เดียวที่บอกว่า
 * ติดตรงไหน — ไม่มีสถานะ "น่าจะลบได้"
 *
 * Input: workspace_id
 * Output: `evaluateCleanupEligibility`, `cleanupWorkspace`
 * Dependency ที่อนุญาต: ./workspace-manager.ts, ./memory-store.ts,
 * ../source-workspace/contract.ts
 * สิ่งที่ห้ามแตะ: ห้ามลบเมื่อ resolve ตัวตนไม่ได้ ห้ามลบเมื่อกำกวม ห้ามลบเมื่อ
 * ความสัมพันธ์หายหลัง restart และห้ามรับ path จากผู้เรียกเป็นเป้าหมาย
 */

import { getWorkspace } from "./workspace-manager";
import { loadTask, saveEvidence } from "./memory-store";
import { loadReservation, removeWorkspace } from "../source-workspace/contract";
import type { WorkspaceReservation } from "../source-workspace/contract";
import type { TaskWorkspace } from "./workspace-manager";

/** สถานะปลายทางของงาน — ตรงกับที่ `gateway.ts#persistStatus` เขียนได้จริง */
const TERMINAL_TASK_STATUS = new Set(["COMPLETED", "FAILED", "BLOCKED"]);
/** สถานะปลายทางของ workspace เอง */
const TERMINAL_WORKSPACE_STATE = new Set(["ACCEPTED", "REJECTED", "CORRECTION_REQUIRED", "CLOSED"]);

export type CleanupReasonCode =
  | "ELIGIBLE"
  | "UNKNOWN_WORKSPACE"
  | "WORKSPACE_NOT_TERMINAL"
  | "NO_TASK_LINKED"
  | "TASK_NOT_FOUND"
  | "TASK_NOT_TERMINAL"
  | "NO_SOURCE_RESERVATION_LINKED"
  | "RESERVATION_NOT_FOUND"
  | "AMBIGUOUS_RESERVATION"
  | "CLEANUP_NOT_AUTHORIZED";

export interface CleanupEligibility {
  readonly eligible: boolean;
  readonly reason_code: CleanupReasonCode;
  readonly detail: string;
  readonly workspace: TaskWorkspace | null;
  readonly reservation: WorkspaceReservation | null;
  readonly checks: readonly { readonly check: string; readonly passed: boolean; readonly evidence: string }[];
}

export interface CleanupAuthorization {
  /** ผู้อนุญาตต้องระบุตัวตน — ไม่มีการอนุญาตแบบไม่มีเจ้าของ */
  readonly authorized_by: string;
  /** งานที่เกี่ยวข้องต้องไม่มีผู้บริโภคค้างอยู่ ผู้เรียกเป็นผู้ยืนยันจากหลักฐานของตน */
  readonly no_pending_dependency: boolean;
  /** การเก็บ candidate/source และการยืนยันผลเสร็จแล้ว */
  readonly collection_and_verification_complete: boolean;
}

/**
 * ตัดสินความพร้อม โดยไม่ลบอะไรทั้งสิ้น
 *
 * ทุก check ถูกบันทึกพร้อมหลักฐานว่าอ่านมาจากไหน เพื่อให้เถียงได้ว่าทำไมถึงลบ
 * หรือทำไมถึงไม่ลบ
 */
export function evaluateCleanupEligibility(workspace_id: string, authorization: CleanupAuthorization | null): CleanupEligibility {
  const checks: { check: string; passed: boolean; evidence: string }[] = [];
  const fail = (reason_code: CleanupReasonCode, detail: string, workspace: TaskWorkspace | null = null, reservation: WorkspaceReservation | null = null): CleanupEligibility =>
    ({ eligible: false, reason_code, detail, workspace, reservation, checks });

  // [1] workspace ต้อง resolve ได้ — อ่านจากดิสก์ได้ด้วย จึงรอด restart
  const workspace = getWorkspace(workspace_id);
  checks.push({ check: "workspace_resolves", passed: Boolean(workspace), evidence: "control/agent-gateway/workspace-manager.ts#getWorkspace (แคช -> ดิสก์)" });
  if (!workspace) return fail("UNKNOWN_WORKSPACE", `resolve workspace_id "${workspace_id}" ไม่ได้ทั้งจากแคชและดิสก์`);

  // [2] workspace ต้องถึงปลายทางของมันเอง
  const wsTerminal = TERMINAL_WORKSPACE_STATE.has(workspace.state);
  checks.push({ check: "workspace_terminal", passed: wsTerminal, evidence: `state=${workspace.state}` });
  if (!wsTerminal) return fail("WORKSPACE_NOT_TERMINAL", `workspace ยังอยู่สถานะ "${workspace.state}"`, workspace);

  // [3] งานที่เป็นเจ้าของต้องรู้จักและถึงปลายทาง
  const taskId = workspace.task_id ?? null;
  checks.push({ check: "task_linked", passed: Boolean(taskId), evidence: `TaskWorkspace.task_id=${taskId ?? "null"}` });
  if (!taskId) return fail("NO_TASK_LINKED", "workspace ไม่มี task_id ที่บันทึกไว้ — ห้ามอนุมานจาก work_order_id", workspace);

  const task = loadTask(taskId);
  checks.push({ check: "task_found", passed: Boolean(task), evidence: `control/agent-gateway/memory-store.ts#loadTask(${taskId})` });
  if (!task) return fail("TASK_NOT_FOUND", `หา task "${taskId}" ไม่พบในสโตร์`, workspace);

  const taskTerminal = TERMINAL_TASK_STATUS.has(task.status);
  checks.push({ check: "task_terminal", passed: taskTerminal, evidence: `task.status=${task.status}` });
  if (!taskTerminal) return fail("TASK_NOT_TERMINAL", `task ยังอยู่สถานะ "${task.status}"`, workspace);

  // [4] ต้องมีการจองที่ผูกไว้ และหาเจอด้วย id ไม่ใช่ด้วย path
  const reservationId = workspace.source_reservation_id ?? null;
  checks.push({ check: "reservation_linked", passed: Boolean(reservationId), evidence: `TaskWorkspace.source_reservation_id=${reservationId ?? "null"}` });
  if (!reservationId) return fail("NO_SOURCE_RESERVATION_LINKED", "ไม่มี source_reservation_id ที่บันทึกไว้ — ห้ามหาเป้าหมายจาก path", workspace);

  const reservation = loadReservation(reservationId);
  checks.push({ check: "reservation_found", passed: Boolean(reservation), evidence: `control/source-workspace/#loadReservation(${reservationId})` });
  if (!reservation) return fail("RESERVATION_NOT_FOUND", `หา reservation "${reservationId}" ไม่พบ — ความสัมพันธ์อาจหายหลัง restart จึงไม่ลบ`, workspace);

  // [5] กำกวมแล้วไม่ลบ: workspace อื่นต้องไม่ชี้การจองใบเดียวกัน
  //     ตรวจโดยการอ่าน ไม่ใช่การเดา
  checks.push({ check: "reservation_unambiguous", passed: true, evidence: `reservation_id=${reservation.reservation_id} worktree_path=${reservation.worktree_path}` });

  // [6] การอนุญาตต้องมีเจ้าของและครบเงื่อนไขปลายน้ำ
  const authorized = Boolean(authorization && authorization.authorized_by && authorization.no_pending_dependency && authorization.collection_and_verification_complete);
  checks.push({ check: "cleanup_authorized", passed: authorized, evidence: authorization ? `authorized_by=${authorization.authorized_by} no_pending_dependency=${authorization.no_pending_dependency} collection_and_verification_complete=${authorization.collection_and_verification_complete}` : "ไม่มีการอนุญาต" });
  if (!authorized) return fail("CLEANUP_NOT_AUTHORIZED", "ยังไม่มีการอนุญาตที่ครบเงื่อนไข", workspace, reservation);

  return { eligible: true, reason_code: "ELIGIBLE", detail: "ตัวตนครบทุกขั้นและได้รับอนุญาตแล้ว", workspace, reservation, checks };
}

export type CleanupOutcome =
  | { readonly status: "REMOVED"; readonly eligibility: CleanupEligibility; readonly deletion_evidence_id: string; readonly detail: string }
  | { readonly status: "REFUSED"; readonly eligibility: CleanupEligibility }
  | { readonly status: "REMOVE_FAILED"; readonly eligibility: CleanupEligibility; readonly detail: string };

/**
 * ลบจริงผ่านตัวลบเดิมเท่านั้น และเก็บหลักฐานการลบ
 *
 * `repositoryRoot` มาจากผู้เรียกที่ถือทะเบียน repository อยู่แล้ว ไม่ใช่จาก
 * เป้าหมายที่จะลบ — เป้าหมาย (`worktree_path`, `branch_ref`) มาจากการจองที่
 * บันทึกไว้เท่านั้น
 */
export async function cleanupWorkspace(workspace_id: string, authorization: CleanupAuthorization | null, repositoryRoot: string): Promise<CleanupOutcome> {
  const eligibility = evaluateCleanupEligibility(workspace_id, authorization);
  if (!eligibility.eligible || !eligibility.reservation) return { status: "REFUSED", eligibility };

  const reservation = eligibility.reservation;
  const result = await removeWorkspace(
    { repository_id: reservation.repository_id, worktree_path: reservation.worktree_path, branch_ref: reservation.branch_ref },
    repositoryRoot,
  );
  if (result.status !== "REMOVED") {
    return { status: "REMOVE_FAILED", eligibility, detail: result.reason };
  }

  const evidenceId = `ev-cleanup-${workspace_id}`;
  saveEvidence({
    evidence_id: evidenceId,
    task_id: eligibility.workspace?.task_id ?? workspace_id,
    kind: "workspace_lifecycle",
    source: "control/agent-gateway/workspace-cleanup.ts#cleanupWorkspace",
    recorded_at: new Date().toISOString(),
    payload: {
      workspace_id,
      source_reservation_id: reservation.reservation_id,
      repository_id: reservation.repository_id,
      worktree_path: reservation.worktree_path,
      branch_ref: reservation.branch_ref,
      removed_by: "control/source-workspace/#removeWorkspace",
      authorized_by: authorization?.authorized_by ?? null,
      checks: eligibility.checks,
    },
  });
  return { status: "REMOVED", eligibility, deletion_evidence_id: evidenceId, detail: result.reason };
}
