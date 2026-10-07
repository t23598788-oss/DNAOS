/**
 * หน้าที่: จุดต่อ **ของจริง** ระหว่างงานที่ติด กับ event ที่จะปลดมัน
 *
 * ทั้งสองครึ่งมีอยู่แล้ว และไฟล์นี้ไม่ได้สร้างครึ่งที่สาม:
 *   `control/work-continuation/adapter.ts#deriveEvents`  ← ข้อเท็จจริงจาก census/registry/verification
 *   `./events.ts#deriveWiringEvents`                     ← ข้อเท็จจริงเรื่องการต่อสาย (5 namespace ที่ไม่มีใครผลิต)
 *   `control/work-continuation/resume.ts#decideResumes`  ← ตัวตัดสิน (ของเขา ไม่ใช่ของเรา)
 *
 * สิ่งที่ไฟล์นี้เพิ่มคือ **ผู้เรียกจริงใน production** สองด้าน:
 *   `recordBlockedWork()` — จุดที่งานติดจริง เรียก `appendWaiting` ตัวเดิม
 *   `runContinuationJoin()` — จุดที่สถานะจริงเปลี่ยน รวม event สองครึ่ง แล้วถาม
 *                             evaluator ตัวเดิม ว่ามีงานไหนปลดได้
 *
 * **ไม่มี dispatch ที่นี่** decision ที่ได้ถูกบันทึกเป็น checkpoint ผ่าน
 * `control/work-session-state/` แล้ว `control/scheduler/` ตัวเดิมเป็นผู้หยิบไปทำ
 * การแยก "ตัดสิน" ออกจาก "ลงมือ" คือสิ่งที่ทำให้เส้นทางทั้งเส้นพิสูจน์ได้โดย
 * ไม่ต้องปล่อย worker จริง
 *
 * Input: task/work ที่เพิ่งเปลี่ยนสถานะจริง
 * Output: `recordBlockedWork`, `runContinuationJoin`, `blockerKeysFor`
 * Dependency ที่อนุญาต: ./events.ts, ./store.ts, ./types.ts และ contract
 * สาธารณะของ work-continuation / work-session-state / live-census
 * สิ่งที่ห้ามแตะ:
 * - ห้ามสร้าง waiting store, evaluator, index, scheduler หรือ event bus ตัวใหม่
 * - ห้ามเดา dependency key จากข้อความอิสระ — key ต้อง derive จากข้อเท็จจริงที่
 *   deterministic เท่านั้น ถ้า derive ไม่ได้ ให้ **ไม่บันทึกอะไรเลย** ดีกว่าบันทึก
 *   key ที่ไม่มีวันตรงกับ event ใด ซึ่งจะกลายเป็นการรอชั่วนิรันดร์แบบเงียบ ๆ
 * - ห้ามโยน error ใส่ผู้เรียกจริง — งานจริงต้องไม่พังเพราะ journal เขียนไม่ได้
 */
import { dependencyKey, appendWaiting, currentWaiting, decideResumes, deriveEvents, type DependencyEvent, type ResumeDecision } from "../work-continuation/contract";
import { deriveWiringEvents, type WiringProbe } from "./events";

/**
 * แปลง "งานติดเพราะอะไร" เป็น dependency key แบบ deterministic
 *
 * รับเฉพาะรูปแบบ blocker ที่ระบบนี้ผลิตเองและมีความหมายตายตัว ข้อความอื่น
 * **คืนอาร์เรย์ว่าง** โดยตั้งใจ: การเดา key จากประโยคอิสระจะได้ key ที่ไม่มี
 * producer ใดปล่อยออกมา งานจะรอตลอดกาลโดยไม่มี error — ซึ่งแย่กว่าการไม่บันทึก
 */
export function blockerKeysFor(nextAction: string | null | undefined, affectedPaths: readonly string[]): string[] {
  if (typeof nextAction !== "string" || nextAction.trim() === "") return [];
  const keys: string[] = [];

  // `UI_RENDER_NOT_VERIFIED:<impact>:<verdict>` — produced by
  // control/ui-render-verification's completion gate. What it waits for is a
  // real VERIFIED verdict for the capability that owns the changed files, which
  // control/work-continuation/adapter.ts already emits as `verification:<path>`.
  if (nextAction.startsWith("UI_RENDER_NOT_VERIFIED:")) {
    for (const path of affectedPaths) {
      const root = path.split("/").slice(0, 2).join("/");
      if (root.length > 0) keys.push(dependencyKey("verification", root));
    }
  }

  // `COMPLETION_PROVENANCE_UNRESOLVED` — produced by
  // control/work-coordination. It waits for the work item to declare a real
  // change set, which is a wiring fact this repository's own gate reports.
  if (nextAction === "COMPLETION_PROVENANCE_UNRESOLVED") {
    keys.push(dependencyKey("contract_field", "target_files"));
  }

  return Array.from(new Set(keys));
}

export interface BlockedWorkInput {
  work_id: string;
  current_phase: string;
  next_action: string | null | undefined;
  affected_paths: readonly string[];
  resolved_work_context_ref?: string | null;
  resolution_digest?: string | null;
  evidence_refs?: readonly string[];
}

export interface RecordBlockedResult {
  recorded: boolean;
  keys: readonly string[];
  detail: string;
}

/**
 * PRODUCTION WAITING CALLER. Called from the real point where work becomes
 * blocked, not from a proof.
 *
 * Records nothing when no deterministic key can be derived — see
 * `blockerKeysFor`. "Nothing to wait for that anything will ever announce" is a
 * real answer and is reported as one.
 */
export function recordBlockedWork(input: BlockedWorkInput): RecordBlockedResult {
  const keys = blockerKeysFor(input.next_action, input.affected_paths);
  if (keys.length === 0) {
    return { recorded: false, keys: [], detail: `no deterministic dependency key derives from "${String(input.next_action)}" — recording a key nothing can emit would be a silent forever-wait` };
  }
  try {
    appendWaiting({
      work_id: input.work_id,
      current_phase: input.current_phase,
      status: "WAITING",
      blocked_on: keys,
      required_evidence: keys.filter((k) => k.startsWith("verification:")),
      required_resources: [],
      required_capabilities: keys.filter((k) => k.startsWith("contract_field:")),
      required_runtime_state: [],
      required_external_state: [],
      resume_condition: "ALL_AVAILABLE",
      exact_state: null,
      next_action: String(input.next_action),
      resolved_work_context_ref: input.resolved_work_context_ref ?? null,
      last_verified_revision: input.resolution_digest ?? null,
      // The keys are recorded as evidence too, so a row that never wakes can be
      // diffed against the events that really arrived — a near-miss then looks
      // like a near-miss instead of like patience.
      evidence_refs: [...(input.evidence_refs ?? []), ...keys],
      resume_attempt_count: 0,
      last_resume_reason: null,
      last_input_digest: null,
      last_result_digest: null,
      required_worker_class: null,
      recorded_at: new Date().toISOString(),
    });
    return { recorded: true, keys, detail: `${keys.length} dependency key(s) recorded for evidence-triggered resume` };
  } catch (error) {
    return { recorded: false, keys, detail: `could not record: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export interface JoinResult {
  events: readonly DependencyEvent[];
  /** Non-empty when a producer threw. Never folded into an empty event list. */
  producer_failures?: readonly string[];
  decisions: readonly ResumeDecision[];
  waiting_rows: number;
  detail: string;
}

/**
 * PRODUCTION EVENT PRODUCER + JOIN. Called where deterministic state really
 * becomes authoritative.
 *
 * Combines the two halves of the translator and asks the ONE evaluator which
 * waiting work is now eligible. It dispatches nothing: a `RESUME_ELIGIBLE`
 * decision is returned and recorded, and `control/scheduler/` remains the only
 * thing that turns a decision into an execution.
 */
export function runContinuationJoin(
  options: {
    census?: unknown;
    wiring_probes?: readonly WiringProbe[];
    resolutionDigestOf?: (workId: string) => string | null;
    resultDigestOf?: (workId: string) => string | null;
    waiting_path?: string;
    creation_path?: string;
    source_revision?: string;
    now?: string;
  } = {},
): JoinResult {
  const now = options.now ?? new Date().toISOString();
  let events: DependencyEvent[] = [];
  // A producer that throws must be REPORTED, never swallowed into an empty
  // batch. "0 events" and "the producer crashed" look identical from the
  // outside and produce the same outcome — nothing wakes — which is the exact
  // silent-stall shape this whole design exists to prevent. Measured: one
  // census record missing `evidence_references` throws inside the adapter and
  // takes the entire batch with it.
  const producerFailures: string[] = [];
  try {
    if (options.census) events = events.concat(deriveEvents(options.census as never));
  } catch (error) {
    producerFailures.push(`census adapter threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    if (options.wiring_probes && options.wiring_probes.length > 0) {
      events = events.concat(deriveWiringEvents(options.wiring_probes, now, { path: options.creation_path, source_revision: options.source_revision }));
    }
  } catch (error) {
    producerFailures.push(`wiring producer threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  const failureNote = producerFailures.length > 0 ? ` · PRODUCER_FAILED: ${producerFailures.join(" ; ")}` : "";

  const rows = currentWaiting(options.waiting_path).filter((r) => r.status === "WAITING" || r.status === "WAITING_FOR_RESOURCE");
  if (events.length === 0 || rows.length === 0) {
    return { events, producer_failures: producerFailures, decisions: [], waiting_rows: rows.length, detail: `${events.length} event(s), ${rows.length} waiting row(s) — nothing to join${failureNote}` };
  }
  const decisions = decideResumes(
    rows, events,
    options.resolutionDigestOf ?? (() => null),
    options.resultDigestOf ?? (() => null),
    now,
  );
  return { events, producer_failures: producerFailures, decisions, waiting_rows: rows.length, detail: `${events.length} event(s) against ${rows.length} waiting row(s) -> ${decisions.length} decision(s)${failureNote}` };
}
