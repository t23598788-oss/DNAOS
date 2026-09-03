/**
 * หน้าที่: อนุมานสถานะของทุกขั้นจากหลักฐานจริง และตอบว่าขั้นไหนไปต่อได้
 * โดยให้ตัวตัดสินเดิมของระบบเป็นผู้ตัดสิน (Owner, CONTINUATION CONTROLLER).
 *
 * ไม่มีตัวตัดสินตัวที่สอง: การเลื่อนขั้นถูกแปลงเป็นคำถามเดียวกับที่
 * `control/work-continuation/evaluate.ts` ตอบอยู่แล้ว — "คีย์ที่รออยู่ครบหรือยัง"
 * ขั้นหนึ่งกลายเป็น `WaitingWork` ที่ `blocked_on` เป็นคีย์ของขั้นก่อนหน้า และ
 * `RESUME_ELIGIBLE` จากตัวเดิมคือใบอนุญาตเดียวที่ทำให้ขั้นเป็น READY ได้
 * ผลคือกฎความปลอดภัยทั้งหมดของ evaluate (terminal, owner decision, loop safety,
 * retry budget, stale resolution) มีผลกับการเลื่อนขั้นด้วยโดยไม่ต้องเขียนซ้ำ
 *
 * ทำไมสถานะเป็นผลลัพธ์เสมอ ไม่มีที่เก็บ: สถานะที่เก็บไว้จะเก่ากว่าความจริงทันทีที่
 * ข้อมูลจริงเปลี่ยน และช่องว่างนั้นคือที่ที่ "เขียนว่าเสร็จ" เข้ามาแทน "เสร็จ"
 *
 * Input: ./stages.ts + ./conditions.ts + ./links.ts (ของจริงทั้งหมด).
 * Output: `deriveLifecycle`, `decideContinuation`.
 * Dependency ที่อนุญาต: ./types, ./stages, ./conditions, ./links,
 * ../work-continuation/contract.
 * สิ่งที่ห้ามแตะ: ห้ามให้ขั้นเป็น ACTIVE ขณะที่ขั้นก่อนหน้ายังไม่ COMPLETE,
 * ห้ามเขียนกติกาการเลื่อนขั้นชุดที่สอง, ห้ามให้ UI เป็นผู้เลือกขั้นปัจจุบัน.
 */

import { evaluate } from "../work-continuation/contract";
import type { DependencyEvent, WaitingWork } from "../work-continuation/contract";
import { evaluateCondition } from "./conditions";
import { linksForStage, loadStageLinks } from "./links";
import { stagesInOrder } from "./stages";
import { stageKey } from "./types";
import type { ContinuationDecision, LifecycleStageDeclaration, LifecycleStageState, StageStatus } from "./types";

/**
 * แปลงขั้นเป็นแถวที่ตัวตัดสินเดิมเข้าใจ
 * `resume_condition` เป็น ALL_AVAILABLE เสมอ เพราะ depends_on คือ "ต้องครบ"
 * ขั้นที่ขนานกันไม่ได้แสดงด้วยเงื่อนไขที่หลวมกว่า แต่ด้วยการ *ไม่ประกาศ* ว่าขึ้นแก่กัน
 */
function asWaitingWork(stage: LifecycleStageDeclaration): WaitingWork {
  const blockedOn = stage.depends_on_stage_ids.map(stageKey);
  return {
    work_id: stage.stage_id,
    current_phase: `stage:${String(stage.sequence)}`,
    status: "WAITING",
    blocked_on: blockedOn,
    required_evidence: [], required_resources: [], required_capabilities: [],
    required_runtime_state: [], required_external_state: [],
    resume_condition: "ALL_AVAILABLE",
    exact_state: null,
    next_action: stage.entry_condition,
    resolved_work_context_ref: null,
    last_verified_revision: null,
    evidence_refs: [],
    resume_attempt_count: 0,
    last_resume_reason: null, last_input_digest: null, last_result_digest: null,
    required_worker_class: null,
    recorded_at: "1970-01-01T00:00:00.000Z",
  };
}

/**
 * ขั้นถัดไป = ขั้นลำดับต่ำสุดที่ประกาศว่าขึ้นกับขั้นนี้
 * ไม่ใช่ "ขั้นที่มีเลขถัดไป" เพราะเลขถัดไปไม่ได้แปลว่าขึ้นต่อกัน
 */
function nextStageIdOf(stage: LifecycleStageDeclaration, all: readonly LifecycleStageDeclaration[]): string | null {
  const successors = all.filter((s) => s.depends_on_stage_ids.includes(stage.stage_id));
  if (successors.length === 0) return null;
  return successors.reduce((a, b) => (a.sequence <= b.sequence ? a : b)).stage_id;
}

/** อนุมานสถานะของทุกขั้นในรอบเดียว — ต้องรอบเดียวเพราะขั้นหลังอ่านผลของขั้นหน้า */
export function deriveLifecycle(now: string = new Date().toISOString()): readonly LifecycleStageState[] {
  const stages = stagesInOrder();
  const allLinks = loadStageLinks();
  const states: LifecycleStageState[] = [];
  const completeKeys = new Set<string>();

  for (const stage of stages) {
    const conditions = stage.completion_condition_ids.map(evaluateCondition);
    const allSatisfied = conditions.length > 0 && conditions.every((c) => c.satisfied);
    // หลักฐานคือ evidence_ref ของเงื่อนไขที่วัดได้จริง — ไม่ใช่การมีอยู่ของไฟล์เอกสาร
    const evidenceRefs = conditions.filter((c) => c.evidence_ref !== "NONE" && c.evidence_ref !== "MEASUREMENT_FAILED").map((c) => c.evidence_ref);
    const verificationSatisfied = allSatisfied && evidenceRefs.length === conditions.length;

    // ตัวตัดสินเดิมเป็นผู้บอกว่าขั้นนี้เปิดได้หรือยัง
    const row = asWaitingWork(stage);
    const trigger: DependencyEvent = {
      key: `lifecycle:evaluation:${stage.stage_id}`, value: null,
      source: "operational-lifecycle", evidence_ref: "derive", occurred_at: now,
    };
    const verdict = row.blocked_on.length === 0
      ? { verdict: "RESUME_ELIGIBLE" as const, missing: [] as readonly string[], reason: "ไม่มีขั้นก่อนหน้า" }
      : evaluate(row, trigger, completeKeys, null, null);
    const blockedByStages = stage.depends_on_stage_ids.filter((id) => !completeKeys.has(stageKey(id)));

    const links = linksForStage(stage.stage_id, allLinks);
    const activeWorkId = links.find((l) => l.kind === "ACTIVE_WORK")?.ref ?? null;
    const incidentId = links.find((l) => l.kind === "INCIDENT")?.ref ?? null;
    const ownerDecisionId = links.find((l) => l.kind === "OWNER_DECISION")?.ref ?? null;

    const failing = conditions.filter((c) => !c.satisfied);
    const blocker = allSatisfied ? null
      : failing.map((c) => `${c.condition_id} (${c.measured})`).join(" · ");

    let status: StageStatus;
    let why: string;
    /**
     * ลำดับการตรวจคือทั้งหมดของกฎห้ามข้ามขั้น
     *
     * ขั้นก่อนหน้าต้องถูกตรวจ *ก่อน* เงื่อนไขจบของขั้นนี้เสมอ ไม่ใช่หลัง — รอบแรก
     * ของไฟล์นี้ตรวจกลับด้าน แล้วขั้น 09 กับ 10 ขึ้น COMPLETE ทั้งที่ขั้น 05 ที่มัน
     * ประกาศว่าขึ้นกับยังไม่จบ นั่นคือการกระโดด 5 -> 9 ที่เอกสารสั่งห้ามพอดี
     * เงื่อนไขของตัวเองที่ผ่านแล้วไม่ใช่ใบอนุญาตให้จบก่อนคิว มันเป็นเพียงข้อมูล
     */
    if (blockedByStages.length > 0) {
      status = "NOT_STARTED";
      why = allSatisfied
        ? `เงื่อนไขจบของขั้นนี้ผ่านแล้ว แต่ขั้นก่อนหน้ายังไม่จบ: ${blockedByStages.join(", ")} — ห้ามจบก่อนคิว`
        : `ขั้นก่อนหน้ายังไม่จบ: ${blockedByStages.join(", ")} — ขั้นนี้เปิดไม่ได้`;
    } else if (allSatisfied && verificationSatisfied) {
      status = "COMPLETE";
      why = `เงื่อนไขจบครบทุกข้อและมีหลักฐานครบ: ${conditions.map((c) => c.measured).join(" · ")}`;
    } else if (allSatisfied) {
      // ผ่านเงื่อนไขแต่หลักฐานไม่ครบ — ห้ามนับว่าจบ นี่คือกฎ NO FAKE COMPLETION
      status = "BLOCKED";
      why = "เงื่อนไขจบผ่าน แต่หลักฐานไม่ครบทุกข้อ — ยังไม่นับว่าจบ";
    } else if (ownerDecisionId !== null) {
      status = "WAITING_OWNER";
      why = `รอการตัดสินของเจ้าของ ${ownerDecisionId}`;
    } else if (incidentId !== null) {
      status = "FAILED";
      why = `มีเหตุที่ยังเปิดอยู่ผูกกับขั้นนี้: ${incidentId}`;
    } else if (activeWorkId !== null) {
      status = "ACTIVE";
      why = `กำลังทำอยู่โดยงาน ${activeWorkId}`;
    } else if (verdict.verdict === "RESUME_ELIGIBLE") {
      status = "BLOCKED";
      why = `ขั้นก่อนหน้าครบแล้ว แต่เงื่อนไขจบของขั้นนี้ยังไม่ผ่าน: ${String(blocker)}`;
    } else {
      status = "NOT_STARTED";
      why = verdict.reason;
    }

    const nextStageId = nextStageIdOf(stage, stages);
    // ค่าคงที่ ORPHANED — ตรวจที่หลังบ้าน ไม่ใช่ที่หน้าจอ
    const terminal = status === "COMPLETE";
    const orphaned = !terminal && nextStageId === null && activeWorkId === null
      && blocker === null && incidentId === null && ownerDecisionId === null;

    states.push({
      stage_id: stage.stage_id, sequence: stage.sequence, title: stage.title,
      stage_kind: stage.stage_kind, document_id: stage.document_id, source_location: stage.source_location,
      depends_on_stage_ids: stage.depends_on_stage_ids, parallel_group: stage.parallel_group,
      status, entry_condition: stage.entry_condition,
      completion_conditions: conditions,
      verification_requirement: stage.verification_requirement, verification_satisfied: verificationSatisfied,
      started_at: activeWorkId !== null ? (links.find((l) => l.kind === "ACTIVE_WORK")?.recorded_at ?? null) : null,
      completed_at: status === "COMPLETE" ? now : null,
      evidence_refs: evidenceRefs, blocker, next_stage_id: nextStageId,
      blocked_on: row.blocked_on, blocked_by_stage_ids: blockedByStages, why_this_status: why,
      active_work_id: activeWorkId, incident_id: incidentId, owner_decision_id: ownerDecisionId,
      orphaned,
    });

    if (status === "COMPLETE") completeKeys.add(stageKey(stage.stage_id));
  }

  return states;
}

/**
 * คำตอบเดียวของ "ตอนนี้อยู่ขั้นไหน ต่อไปทำอะไร"
 *
 * ขั้นปัจจุบันคือขั้นลำดับต่ำสุดที่ยังไม่จบ — ไม่ใช่ขั้นที่ใครคลิกล่าสุด
 * เมื่อไม่มีขั้นถัดไปที่เลือกได้ ต้องได้ตัวขวางหรือการตัดสินของเจ้าของเสมอ
 * ห้ามคืน "ไม่รู้" เงียบ ๆ
 */
export function decideContinuation(states: readonly LifecycleStageState[] = deriveLifecycle()): ContinuationDecision {
  const ordered = [...states].sort((a, b) => a.sequence - b.sequence);
  const completed = ordered.filter((s) => s.status === "COMPLETE");
  const unfinished = ordered.filter((s) => s.status !== "COMPLETE");
  const current = unfinished[0] ?? null;
  const eligible = unfinished.filter((s) => s.blocked_by_stage_ids.length === 0);
  const next = eligible.find((s) => s.stage_id !== current?.stage_id) ?? null;
  const orphaned = ordered.filter((s) => s.orphaned).map((s) => s.stage_id);

  /**
   * ไม่มีขั้นถัดไปที่เลือกได้ ต้องพูดออกมาเสมอว่าเพราะอะไร
   * "ไม่มีขั้นถัดไป" ที่ไม่มีเหตุผลกำกับ คือการหยุดเงียบ ซึ่งแยกไม่ออกจากการทำเสร็จ
   */
  const nextBlockedReason = next !== null ? null
    : unfinished.length === 0 ? null
    : current === null ? "มีขั้นค้างอยู่แต่เลือกขั้นปัจจุบันไม่ได้"
    : `ทุกขั้นที่เหลือถูกกั้นด้วยขั้น ${current.stage_id} ที่ยังไม่จบ — ตัวขวางคือ ${current.blocker ?? current.why_this_status}`;

  return {
    current_stage: current?.stage_id ?? null,
    last_completed_stage: completed.length > 0 ? completed[completed.length - 1].stage_id : null,
    next_eligible_stage: next?.stage_id ?? null,
    why_this_stage: current === null
      ? "ทุกขั้นจบแล้ว"
      : `ขั้นลำดับ ${String(current.sequence)} เป็นขั้นแรกที่ยังไม่จบ — ${current.why_this_status}`,
    blocked_by: current?.blocked_by_stage_ids ?? [],
    required_capabilities: current?.blocked_on ?? [],
    required_evidence: current?.completion_conditions.filter((c) => !c.satisfied).map((c) => c.evidence_ref) ?? [],
    orphaned_stage_ids: orphaned,
    owner_decision_required: orphaned.length > 0 || ordered.some((s) => s.status === "WAITING_OWNER"),
    next_blocked_reason: nextBlockedReason,
  };
}

/** ผลของการกลับเข้าวงจรหลังการซ่อม — ต้องระบุขั้นที่กลับไปเสมอ */
export interface ResumeAfterRepair {
  readonly returned_to_stage_id: string;
  readonly stage_status: StageStatus;
  readonly advanced: boolean;
  readonly advanced_to_stage_id: string | null;
  readonly blocker: string | null;
  readonly reason: string;
}

/**
 * หลังซ่อมเสร็จ ให้กลับไปที่ขั้นที่ล้ม แล้ว *ประเมินเงื่อนไขจบของขั้นนั้นใหม่*
 * ไม่ใช่ไปทำงานอะไรก็ได้ที่ค้างอยู่
 *
 * การเลื่อนไปขั้นถัดไปเกิดได้ทางเดียว: ขั้นเดิมกลายเป็น COMPLETE จากหลักฐานจริง
 * ถ้ายังไม่จบ ต้องอยู่ที่ขั้นเดิมพร้อมตัวขวาง — การกระโดดไปขั้นหลังหลังการซ่อม
 * คืออาการเดิมที่ทั้งไฟล์นี้มีไว้เพื่อกัน
 */
export function resumeAfterRepair(stageId: string, states: readonly LifecycleStageState[] = deriveLifecycle()): ResumeAfterRepair {
  const stage = states.find((s) => s.stage_id === stageId);
  if (!stage) {
    return { returned_to_stage_id: stageId, stage_status: "FAILED", advanced: false, advanced_to_stage_id: null,
      blocker: `ไม่มีขั้นชื่อ ${stageId} ในสารบัญ`, reason: "ขั้นที่อ้างไม่มีจริง — ไม่เดาขั้นใกล้เคียง" };
  }
  if (stage.status !== "COMPLETE") {
    return { returned_to_stage_id: stage.stage_id, stage_status: stage.status, advanced: false, advanced_to_stage_id: null,
      blocker: stage.blocker, reason: `กลับมาที่ขั้นเดิมและประเมินใหม่แล้ว ยังไม่จบ — ${stage.why_this_status}` };
  }
  return { returned_to_stage_id: stage.stage_id, stage_status: "COMPLETE", advanced: stage.next_stage_id !== null,
    advanced_to_stage_id: stage.next_stage_id, blocker: null,
    reason: stage.next_stage_id === null ? "ขั้นนี้จบและไม่มีขั้นถัดไปที่ขึ้นกับมัน" : "ขั้นเดิมจบจริงจากหลักฐาน จึงเลื่อนไปขั้นที่ขึ้นกับมัน" };
}
