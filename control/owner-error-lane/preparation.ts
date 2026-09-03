/**
 * หน้าที่: M3 — ผู้ประสานงานเตรียมการซ่อมอัตโนมัติ ที่หยุดก่อนการลงมือเสมอ
 *
 * ขอบเขตอำนาจที่ Owner กำหนด:
 *   AUTO OBSERVE -> AUTO CLASSIFY -> AUTO QUEUE -> AUTO PRIORITIZE
 *   -> AUTO PREPARE -> HARD STOP -> EXECUTION AUTHORITY REQUIRED
 *
 * ── ไม่มีตัวจัดคิว ล็อก สโตร์ หรือเครื่องซ่อมตัวใหม่ ──
 * ล็อกใช้ `work-coordination#claimWork("repair-cycle")` ซึ่งสร้างบน
 * `O_CREAT|O_EXCL` ของ `execution/process-lock` · การกันซ้ำใช้
 * `claimSourceEvent` + `gap_id` ที่คำนวณจากเนื้อหา · ที่เก็บใช้ evidence store
 * เดิมของ agent-gateway · การวิเคราะห์และสร้างงานซ่อมใช้ `repair-loop` เดิม
 * ไฟล์นี้เพียงเรียงลำดับให้ถูกและบันทึกผลไว้ให้การอ่านไม่ต้องคำนวณ
 *
 * ── ทำไมต้องบันทึกผลการวิเคราะห์ ──
 * `analyzeRootCause` และ `preDispatchStop` เป็นการคำนวณ ถ้าให้ read model
 * เรียกตอนอ่าน การเปิดหน้าจอของ Owner จะมีต้นทุนและผลข้างเคียงแฝง การอ่านคิว
 * ต้องไม่มีผลข้างเคียง ผลจึงถูกบันทึกตอนเตรียม แล้วอ่านกลับเฉย ๆ
 *
 * ── ห้ามสร้างตัวตนจากเวลา ──
 * `work_id` ของช่องว่างที่ `scanGaps` เจอเอง คำนวณจาก `gap_id` ด้วย sha256
 * ให้อยู่ในรูป uuid เดิม ความล้มเหลวเดิมจึงได้สายเลือดเดิมทุกครั้ง แม้คนละรอบ
 * คนละโปรเซส และคนละวัน
 *
 * ── สิ่งที่ไฟล์นี้ทำไม่ได้เลย ──
 * ไม่ส่ง Agent ไม่ยื่น WorkOrder ที่รันได้ ไม่เขียนซอร์ส/คอนฟิก/สิทธิ์/credential
 * ไม่แตะ topology ไม่เรียกปลายทางภายนอก — ไม่มี import ใดในไฟล์นี้ที่ทำได้
 *
 * Input: `runPreparationCycle`, `setPreparationState`
 * Output: `PreparedRepairRecord`, `PreparationCycleResult`
 * Dependency ที่อนุญาต: ./repair-link.ts, ./unified-queue.ts, ./console-feed.ts,
 * ../repair-loop/contract.ts, ../work-coordination/contract.ts,
 * ../agent-gateway/contract.ts, node:crypto
 * สิ่งที่ห้ามแตะ: ห้าม import ตัวส่งงาน ห้ามเขียนไฟล์ซอร์ส และห้ามให้ PAUSED
 * ไปควบคุม M6 — สองขอบเขตอำนาจนี้แยกกัน
 */

import { createHash } from "node:crypto";
import { saveEvidence, loadEvidenceForTask } from "../agent-gateway/contract";
import { claimWork, releaseWorkClaim } from "../work-coordination/contract";
import { analyzeRootCause, buildRepairWorkItem, preDispatchStop, scanGaps, MAX_ATTEMPTS_PER_GAP } from "../repair-loop/contract";
import type { GapRecord, RootCauseClass, RepairType, StopCondition } from "../repair-loop/contract";
import { loadAdmittedConsoleItems } from "./lane";
import { bindFailureEvidence } from "./evidence-binding";
import type { BindingStatus, EvidenceBinding, MissingEvidenceKind } from "./evidence-binding";
import { classifyNonDefect, gapFromConsoleItem, gapIdForError } from "./repair-link";
import { MAX_REPAIR_DEPTH } from "./types";
import type { NonDefectReason } from "./repair-link";

const SOURCE_MARKER = "control/owner-error-lane/preparation.ts";
const STATE_TASK_ID = "dna-os/auto-repair-preparation";
const PREPARED_TASK_ID = "dna-os/prepared-repairs";
const COORDINATOR_WORK_ID = "repair-cycle";

/** ขอบเขตของหนึ่งรอบ — ประกาศไว้ ไม่ซ่อนในเงื่อนไข */
export const MAX_ITEMS_PER_CYCLE = 25;
export const MIN_IDLE_SWEEP_MS = 15 * 60 * 1000;
export const BACKOFF_BASE_MS = 5 * 60 * 1000;

export type PreparationState = "RUNNING" | "PAUSED";

export interface PreparedRepairRecord {
  readonly gap_id: string;
  readonly work_id: string;
  readonly source_event_id: string | null;
  readonly origin: "EVENT" | "IDLE_SWEEP";
  readonly root_cause: RootCauseClass | null;
  readonly repair_type: RepairType | null;
  readonly repair_id: string | null;
  readonly stop_condition: StopCondition | null;
  readonly non_defect_reason: NonDefectReason | null;
  readonly occurrences: number;
  readonly depth: number;
  readonly upstream: readonly string[];
  readonly attempt_count: number;
  readonly next_eligible_at: string;
  readonly frozen_reason: "NO_PROGRESS" | "LOOP_DETECTED" | "MAX_ATTEMPTS_REACHED" | null;
  readonly evidence_refs: readonly string[];
  /** ผลการผูกหลักฐาน — ทำไม analyzeRootCause ถึงตอบแบบนั้น */
  readonly binding_status: BindingStatus | null;
  readonly bound_component: string | null;
  readonly bound_capability: string | null;
  readonly registry_refs: readonly string[];
  readonly missing_evidence: readonly MissingEvidenceKind[];
  readonly observed_at: string | null;
  readonly proven_cause: string | null;
  readonly first_seen: string;
  readonly last_seen: string;
  readonly prepared_at: string;
  /** ชนิดข้อมูลรับประกันว่าการเตรียมไม่เคยกลายเป็นการลงมือ */
  readonly dispatched: false;
}

// ---------------------------------------------------------------- state ----

/** สถานะคงทน อ่านจาก evidence store เดิม ไม่มีไฟล์ของตัวเอง */
export function preparationState(): PreparationState {
  const rows = loadEvidenceForTask(STATE_TASK_ID)
    .filter((e) => e.source === SOURCE_MARKER)
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const latest = rows.at(-1)?.payload as { state?: PreparationState } | undefined;
  return latest?.state === "PAUSED" ? "PAUSED" : "RUNNING";
}

/**
 * ตั้งสถานะของ M3 เท่านั้น
 *
 * PAUSED = ไม่เริ่มรอบสแกน/วิเคราะห์/จัดคิวอัตโนมัติ แต่เหตุการณ์ยังถูกบันทึกได้
 * ตามปกติ และ **ไม่ควบคุม M6** ซึ่งเป็นขอบเขตอำนาจคนละอัน
 */
export function setPreparationState(state: PreparationState, reason: string): PreparationState {
  saveEvidence({
    evidence_id: `auto-repair-preparation-${Date.now()}-${state}`,
    task_id: STATE_TASK_ID, kind: "recovery", source: SOURCE_MARKER,
    recorded_at: new Date().toISOString(),
    payload: { state, reason, scope: "M3_PREPARATION_ONLY", controls_m6: false },
  });
  return state;
}

// ------------------------------------------------------------- identity ----

/**
 * work_id ของช่องว่างที่ไม่มีต้นทาง — จากเนื้อหา ไม่ใช่จากเวลา
 *
 * รูปแบบเป็น uuid เดิมของ namespace `work-<uuid>` เพื่อให้ระบบอื่นที่ตรวจรูป
 * (SSE, claimWork, WorkspaceReservation) อ่านได้เหมือนกัน
 */
export function derivedWorkIdFor(gapId: string): string {
  const h = createHash("sha256").update(`dna-os/gap-work/${gapId}`).digest("hex");
  return `work-${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ------------------------------------------------------------- prepared ----

export function loadPreparedRepairs(): readonly PreparedRepairRecord[] {
  const latest = new Map<string, PreparedRepairRecord>();
  for (const e of loadEvidenceForTask(PREPARED_TASK_ID)) {
    if (e.source !== SOURCE_MARKER) continue;
    const rec = e.payload as PreparedRepairRecord;
    if (rec?.gap_id) latest.set(rec.gap_id, rec);
  }
  return [...latest.values()];
}

function persistPrepared(rec: PreparedRepairRecord): void {
  saveEvidence({
    evidence_id: `prepared-${rec.gap_id}-${rec.occurrences}-${Date.now()}`,
    task_id: PREPARED_TASK_ID, kind: "recovery", source: SOURCE_MARKER,
    recorded_at: rec.prepared_at, payload: rec,
  });
}

/**
 * backoff โตขึ้นตามจำนวนครั้งที่ล้มเหลวซ้ำโดยสถานะไม่เปลี่ยน — มีเพดาน
 *
 * เพดานไม่ใช่ของประดับ: `scanGaps` คืนช่องว่างที่มี `occurrences` สูงได้จริง
 * (พบตอนทดสอบ: 2^n ทำให้ค่ากลายเป็น Infinity แล้ว `new Date(...)` โยน
 * RangeError ทั้งรอบพัง) ค่าที่คำนวณไม่ได้ต้องไม่กลายเป็นเวลาที่ไม่มีอยู่จริง
 */
export const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;
export function backoffMsFor(occurrences: number): number {
  const steps = Math.min(Math.max(0, occurrences - 1), 32);
  return Math.min(BACKOFF_BASE_MS * Math.pow(2, steps), BACKOFF_MAX_MS);
}

function frozenReasonFor(prev: PreparedRepairRecord | undefined, occurrences: number): PreparedRepairRecord["frozen_reason"] {
  if (occurrences >= MAX_ATTEMPTS_PER_GAP) return "MAX_ATTEMPTS_REACHED";
  // ความล้มเหลวเดิมซ้ำโดยผลการวิเคราะห์ไม่เปลี่ยนเลย = ไม่มีความคืบหน้า
  if (prev && occurrences > prev.occurrences && prev.root_cause !== null
      && prev.stop_condition === null && occurrences >= 3) return "NO_PROGRESS";
  return null;
}

// ---------------------------------------------------------------- cycle ----

export interface PreparationCycleResult {
  readonly ran: boolean;
  readonly skipped_reason: "PAUSED" | "COORDINATOR_HELD" | null;
  readonly coordinator: string | null;
  readonly ingested_events: number;
  readonly swept_gaps: number;
  readonly prepared: readonly PreparedRepairRecord[];
  readonly skipped_non_defect: number;
  readonly frozen: number;
  readonly dispatched: 0;
}

export interface PreparationOptions {
  readonly holder_agent_id?: string;
  readonly idleSweep?: boolean;
  readonly now?: () => Date;
  readonly maxItems?: number;
}

/**
 * หนึ่งรอบเตรียมการ — ผู้ประสานงานได้รายเดียวข้ามโปรเซส
 *
 * ลำดับ: ตรวจ PAUSED -> อ้างสิทธิ์ผู้ประสานงาน -> รับเหตุการณ์จริง ->
 * กวาดช่องว่าง (ถ้าเปิด) -> วิเคราะห์ -> จัดลำดับด้วย depth -> บันทึก -> ปล่อยล็อก
 * **ไม่มีขั้นการส่งงาน**
 */
export function runPreparationCycle(options: PreparationOptions = {}): PreparationCycleResult {
  const now = options.now ?? (() => new Date());
  const holder = options.holder_agent_id ?? SOURCE_MARKER;
  const empty = { ingested_events: 0, swept_gaps: 0, prepared: [], skipped_non_defect: 0, frozen: 0, dispatched: 0 as const };

  if (preparationState() === "PAUSED") {
    return { ran: false, skipped_reason: "PAUSED", coordinator: null, ...empty };
  }

  const claim = claimWork({
    work_id: COORDINATOR_WORK_ID, task_id: COORDINATOR_WORK_ID, holder_agent_id: holder,
    resource_scope: [], lease_ms: 120_000,
  });
  if (!claim.ok) {
    return { ran: false, skipped_reason: "COORDINATOR_HELD", coordinator: claim.reason, ...empty };
  }

  try {
    const previous = new Map(loadPreparedRepairs().map((r) => [r.gap_id, r]));
    const candidates: { gap: GapRecord; origin: PreparedRepairRecord["origin"]; nonDefect: NonDefectReason | null; binding: EvidenceBinding | null }[] = [];

    // 1) เหตุการณ์จริงมาก่อนเสมอ
    // อ่าน "ใบเต็ม" ที่ชั้นรับเข้าบันทึกไว้ ไม่ใช่แถวของฟีดหน้าจอ — ฟีดมีไว้แสดงผล
    // จึงไม่พกข้อความผิดพลาดดิบและ evidence ซึ่งเป็นสิ่งที่การวิเคราะห์สาเหตุต้องใช้
    let ingested = 0;
    for (const consoleItem of loadAdmittedConsoleItems()) {
      if (consoleItem.origin_kind !== "SYSTEM_ERROR_COMMAND" || !consoleItem.work_id) continue;
      // ผูกหลักฐานก่อนวิเคราะห์ — ป้อน capability/registry ที่พิสูจน์แล้วให้
      // analyzeRootCause แทนที่จะให้มันเดาจาก gap ที่แทบไม่มีสัญญาณ
      const binding = bindFailureEvidence(consoleItem);
      const base = gapFromConsoleItem(consoleItem);
      const gap: GapRecord = {
        ...base,
        capability_id: binding.bound_capability ?? base.capability_id,
        source_path: binding.bound_component ?? base.source_path,
        registry_refs: binding.registry_refs,
        evidence_refs: [...base.evidence_refs, ...binding.binding_evidence.map((e) => `binding:${e}`)],
      };
      candidates.push({ gap, origin: "EVENT", nonDefect: classifyNonDefect(consoleItem), binding });
      ingested += 1;
    }

    // 2) กวาดช่องว่างเมื่อเปิดใช้ — ช่องว่างที่ไม่มีต้นทางได้ work_id จากเนื้อหา
    let swept = 0;
    if (options.idleSweep === true) {
      const summary = scanGaps();
      for (const g of summary.queue) {
        const withWork: GapRecord = g.work_id ? g : { ...g, work_id: derivedWorkIdFor(g.gap_id) };
        candidates.push({ gap: withWork, origin: "IDLE_SWEEP", nonDefect: null, binding: null });
        swept += 1;
      }
    }

    // 3) จัดลำดับ: ต้นเหตุก่อนอาการปลายทางเสมอ แล้วจึงถี่กว่าก่อน
    // ── รายการที่แช่แข็งแล้วต้องไม่กินโควตาของรอบ ──
    // พบจริง: 20 ใบที่ถูกแช่แข็งไว้กินครบ 25 ใบของรอบ ความล้มเหลวใหม่ที่ผูก
    // หลักฐานได้แบบ EXACT จึงไม่เคยถูกประมวลผลเลย โควตามีไว้จำกัด "งานที่ทำ"
    // ไม่ใช่ "งานที่ข้าม"
    const previouslyFrozen = new Set(
      [...previous.values()].filter((r) => r.frozen_reason !== null).map((r) => r.gap_id),
    );
    const active = candidates.filter((c) => !previouslyFrozen.has(c.gap.gap_id));
    const frozenSkipped = candidates.length - active.length;

    active.sort((a, b) => (a.gap.depth - b.gap.depth) || (b.gap.occurrences - a.gap.occurrences));

    const prepared: PreparedRepairRecord[] = [];
    let skippedNonDefect = 0, frozen = frozenSkipped;
    const at = now().toISOString();

    for (const c of active.slice(0, options.maxItems ?? MAX_ITEMS_PER_CYCLE)) {
      const prev = previous.get(c.gap.gap_id);
      const occurrences = prev ? prev.occurrences + 1 : c.gap.occurrences;

      if (c.nonDefect !== null) { skippedNonDefect += 1; continue; }
      if (c.gap.depth > MAX_REPAIR_DEPTH) { frozen += 1; continue; }

      const frozenReason = frozenReasonFor(prev, occurrences);

      const finding = analyzeRootCause(c.gap);

      // การบล็อกเชิงนโยบายและสิ่งที่ออกแบบให้จบแบบนั้น = ไม่ใช่ของเสีย ข้ามได้
      if (finding.root_cause_class === "EXPECTED_POLICY_BLOCK" || finding.root_cause_class === "EXPECTED_BY_DESIGN") {
        skippedNonDefect += 1;
        continue;
      }

      // ── UNDETERMINED ไม่ใช่ "ไม่ใช่ของเสีย" ──
      // มันคือ "ยังวินิจฉัยไม่ได้" ซึ่งเป็นคนละเรื่องกัน ถ้านับรวมเป็น non-defect
      // แล้วข้ามไป งานค้างจะหายจากคิวเงียบ ๆ ทั้งที่ยังไม่มีใครแก้ รายการแบบนี้
      // จึงถูกบันทึกให้เห็น พร้อมเหตุผลว่าทำไมยังส่งไม่ได้ — เห็นได้ แต่ส่งไม่ได้
      if (!finding.repair_required) {
        const undet: PreparedRepairRecord = {
          gap_id: c.gap.gap_id,
          work_id: c.gap.work_id ?? derivedWorkIdFor(c.gap.gap_id),
          source_event_id: c.gap.source_event_id ?? null,
          origin: c.origin,
          root_cause: finding.root_cause_class,
          repair_type: null, repair_id: null,
          stop_condition: "NO_VERIFIABLE_EVIDENCE",
          non_defect_reason: null,
          occurrences, depth: c.gap.depth, upstream: c.gap.upstream,
          attempt_count: prev?.attempt_count ?? 0,
          next_eligible_at: new Date(now().getTime() + backoffMsFor(occurrences)).toISOString(),
          frozen_reason: frozenReason,
          evidence_refs: c.gap.evidence_refs,
          binding_status: c.binding?.binding_status ?? null,
          bound_component: c.binding?.bound_component ?? c.gap.source_path,
          bound_capability: c.binding?.bound_capability ?? null,
          registry_refs: c.gap.registry_refs,
          missing_evidence: c.binding?.missing_evidence ?? [],
          observed_at: c.binding?.observed_at_boundary ?? null,
          proven_cause: c.binding?.causal.PROVEN_CAUSE ?? null,
          first_seen: prev?.first_seen ?? c.gap.first_seen ?? at,
          last_seen: c.gap.last_seen ?? at,
          prepared_at: at,
          dispatched: false,
        };
        persistPrepared(undet);
        prepared.push(undet);
        continue;
      }

      const repair = buildRepairWorkItem(c.gap, finding, {
        trace_id: c.gap.work_id ?? c.gap.gap_id, attempt: occurrences, existing_tests: [],
      });
      const rec: PreparedRepairRecord = {
        gap_id: c.gap.gap_id,
        work_id: c.gap.work_id ?? derivedWorkIdFor(c.gap.gap_id),
        source_event_id: c.gap.source_event_id ?? null,
        origin: c.origin,
        root_cause: finding.root_cause_class,
        repair_type: finding.repair_type,
        repair_id: repair?.repair_id ?? null,
        stop_condition: repair === null ? "NO_VERIFIABLE_EVIDENCE" : preDispatchStop(repair),
        non_defect_reason: null,
        occurrences, depth: c.gap.depth, upstream: c.gap.upstream,
        attempt_count: prev?.attempt_count ?? 0,
        next_eligible_at: new Date(now().getTime() + backoffMsFor(occurrences)).toISOString(),
        frozen_reason: frozenReason,
        evidence_refs: c.gap.evidence_refs,
        binding_status: c.binding?.binding_status ?? null,
        bound_component: c.binding?.bound_component ?? c.gap.source_path,
        bound_capability: c.binding?.bound_capability ?? null,
        registry_refs: c.gap.registry_refs,
        missing_evidence: c.binding?.missing_evidence ?? [],
        observed_at: c.binding?.observed_at_boundary ?? null,
        proven_cause: c.binding?.causal.PROVEN_CAUSE ?? null,
        first_seen: prev?.first_seen ?? c.gap.first_seen ?? at,
        last_seen: c.gap.last_seen ?? at,
        prepared_at: at,
        dispatched: false,
      };
      if (frozenReason !== null) frozen += 1;
      persistPrepared(rec);
      prepared.push(rec);
    }

    return {
      ran: true, skipped_reason: null, coordinator: claim.claim.holder_agent_id,
      ingested_events: ingested, swept_gaps: swept, prepared,
      skipped_non_defect: skippedNonDefect, frozen, dispatched: 0,
    };
  } finally {
    releaseWorkClaim(claim.ok ? claim.claim : ({} as never));
  }
}
