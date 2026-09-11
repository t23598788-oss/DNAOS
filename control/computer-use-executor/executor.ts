/**
 * หน้าที่: DNA OS Computer-Use Executor — execution owner จริงของการควบคุมคอมพิวเตอร์
 *
 * เส้นทางบังคับ:
 *   requester (โมเดล/เสียง) → ComputerUseRequest
 *   → validateAuthority (permission lease ของ DNA OS)
 *   → os-ui adapter (runUiWorkOrder)
 *   → OS/Browser
 *   → evidence (execution_owner = DNA OS executor + pid ของ process นี้)
 *
 * ── หัวใจ ──
 * `execution_owner` ในหลักฐานคือ DNA OS executor เสมอ ไม่ใช่ Claude โมเดลเป็นได้แค่
 * `requester` ใน request หลักฐานบันทึก pid ของ process ที่รัน executor นี้ เพื่อพิสูจน์
 * runtime ว่าใครเป็นเจ้าของการ execute จริง
 *
 * ── ขอบเขตที่ไม่ข้าม ──
 * ถ้า os-ui admission ปฏิเสธ (เช่น credential surface) executor ก็ปฏิเสธ — fail closed
 * executor ไม่มีทางลัดใด ๆ นอกจากเรียก os-ui adapter ที่ผ่าน admission แล้ว
 *
 * Input: ComputerUseRequest (+ authority_id).
 * Output: executeComputerUse -> ExecutionEvidence.
 * Dependency ที่อนุญาต: ../computer-use-authority/contract.ts,
 *   ../../connections/os-ui/adapter-contract.ts,
 *   ../../software/registry-database/ (READ-ONLY identity lookup only — this
 *   file never writes to the registry and never changes a capability's proof
 *   state), node:fs/path.
 * สิ่งที่ห้ามแตะ: ห้ามให้ requester เป็น execution_owner ห้ามเรียก OS ตรงโดยข้าม os-ui.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateAuthority } from "../computer-use-authority/contract";
import type { ComputerUseOperation } from "../computer-use-authority/types";
import { runUiWorkOrder } from "../../connections/os-ui/adapter-contract";
import { macLocalAgentExecutionDecision } from "../../contracts/architecture/runtime-node-and-optional-provider";
import { NOT_OBSERVED, observeWindowTitleState, type Observation, type ObservationTarget } from "./observation";
import { NO_EXPECTATION_ATTEMPTED, buildExpectation, type ExpectationRecord, type IntentDeclaration } from "./expectation";
import { evaluateEffect, type EffectVerdict } from "./effect-verdict";
import { NOT_CAPTURED, captureRoutingContext, type RoutingContext } from "./routing-context";
import { NO_CGEVENT_INSTRUMENTATION, parseCgEventInstrumentation, type CgEventInstrumentation } from "./cgevent-instrumentation";
import { findCapability } from "../../software/registry-database/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import type { UiActionKind, UiWorkOrder, UiWorkOrderOutcome } from "../../connections/os-ui/work-order";

export const EXECUTOR_IDENTITY = "control/computer-use-executor";
/**
 * WHICH CAPABILITY THIS EXECUTOR ACTUALLY INVOKES.
 *
 * The route is structural, not a guess: this file reaches the OS through
 * `connections/os-ui/adapter-contract.ts` and nothing else — its own header
 * forbids any other path. `os-ui` is a registered canonical capability whose
 * `source_location` is `connections/os-ui/`, so the identity of what runs here
 * is knowable before anything executes, by looking it up rather than by reading
 * the operation name or the target text.
 *
 * Resolved once at module load, from the canonical registry, by canonical name.
 * If the registry does not hold it, `EXECUTION_ROUTE_CAPABILITY_ID` is null and
 * every execution records a null identity — the alternative would be writing an
 * id nobody registered.
 *
 * This is NOT the authority lease's `capability` field. That field carries
 * values like "browser" and "desktop": an authorisation scope, deliberately
 * coarser than an identity, and it stays separate.
 */
const ROUTE_CAPABILITY_CANONICAL_NAME = "os-ui";
export const EXECUTION_ROUTE_CAPABILITY_ID: string | null = (() => {
  try {
    const found = findCapability({ canonical_name: ROUTE_CAPABILITY_CANONICAL_NAME } as never, createPersistentFileStore()) as { capability_id?: string } | null;
    return found?.capability_id ?? null;
  } catch { return null; }
})();

const EVIDENCE_DIR = "control/computer-use-executor/data";
const EVIDENCE_FILE = "execution-evidence.jsonl";

/** operation ของ authority-lease -> ui_action ของ os-ui (แผนที่ตรงไปตรงมา) */
const OPERATION_TO_UI_ACTION: Partial<Record<ComputerUseOperation, UiActionKind>> = {
  screenshot: "screenshot", read_screen: "read_screen", click: "click", type: "type",
  key: "key", focus: "focus", browser_navigate: "open_url", browser_eval: "browser_eval",
  pointer_move: "pointer_move", double_click: "double_click", scroll: "scroll", drag: "drag",
};

export interface ComputerUseRequest {
  work_order_id: string;
  authority_id: string;
  requester: string;
  operation: ComputerUseOperation;
  target: string;
  /** Optional canonical capability the caller believes it is invoking. When present it must be the id this executor's route actually resolves to; a different id is refused rather than corrected. When absent, the route's own resolved identity is recorded — that is the truth of what ran, not a substitution. */
  capability_id?: string;
  /** Which process this execution's before/after state should be read from. Absent means no observation is attempted — recorded as such, never as an empty state. */
  observation_target?: ObservationTarget;
  /**
   * Whether to capture routing context (pointer position + frontmost pid) in
   * the instant before dispatch. Opt-in, so every existing caller is unchanged
   * and absence is recorded as "not captured" rather than as a failed capture.
   */
  capture_routing_context?: boolean;
  /**
   * How long to wait after the adapter returns before taking the AFTER
   * observation, in milliseconds (capped at 5000). Absent or 0 observes
   * immediately, which is what every caller did before 2026-09-02. It is a
   * declared measurement window, never adjusted in response to what is read.
   */
  settle_ms?: number;
  /**
   * What the caller declares about its own intent, before execution — the only
   * thing an expectation may take from the caller beyond the operation and the
   * ui fields. A closed enum, so intent can never arrive as free text, and read
   * only before the action.
   */
  intent_declaration?: IntentDeclaration;
  scope_needed?: readonly string[];
  /** รายละเอียด os-ui work order (ยกเว้น ui_action ที่ derive จาก operation) */
  ui: Omit<Partial<UiWorkOrder>, "ui_action">;
}

/**
 * Everything `UiWorkOrderOutcome` reported, kept under the meaning its producer
 * proved — no more.
 *
 * MEASURED 2026-09-02: the adapter returns nine result fields, the executor
 * receives all nine, and exactly one of them (`status`) was persisted. Every
 * other fact the OS actually reported — which window presentation state
 * applied, whether focus was re-verified after being restored, which screenshot
 * file was written — existed in memory and was thrown away at the moment the
 * evidence row was written. That is why a `scroll` that posted a CGEvent and a
 * `scroll` that moved the viewport are indistinguishable in the evidence store.
 *
 * THE CATEGORIES ARE THE POINT. `dispatch_evidence` holds the adapter's own
 * account of sending the action — strings like "mouse_helper=OK" and
 * "OK scroll 0,600" say the event was posted, NOT that anything moved, and they
 * stay dispatch evidence forever. `presentation_state` and
 * `focus_restoration_verified` are the only observed facts here, and only
 * because the adapter itself observed them (it reads the real frontmost app and
 * re-checks after a restore). Nothing in this shape may be read as proof that
 * an arbitrary operation achieved its effect.
 */
export interface PersistedOutcome {
  /** The adapter's account of SENDING the action. Never evidence that the action worked. */
  dispatch_evidence: { ok: boolean; summary: string; evidence: readonly string[]; idempotent_replay: boolean };
  /** Files the run produced (screenshots, screen reads). A reference, not a verdict. */
  artifact_references: readonly { kind: string; ref: string }[];
  /** Producer-defined window presentation state — observed by the adapter for open/focus actions only, null everywhere else. Never generalise it to other operations. */
  presentation_state: string | null;
  /** Producer-defined verification: true only when the adapter independently re-checked that the prior frontmost app was restored. */
  focus_restoration_verified: boolean | null;
  next_action: string | null;
}

export interface ExecutionEvidence {
  evidence_id: string;
  work_order_id: string;
  execution_owner: string;   // DNA OS executor — ไม่ใช่ Claude
  executor_pid: number;
  executor_process_title: string;
  requester: string;
  authority_id: string;
  operation: ComputerUseOperation;
  target: string;
  /** The canonical capability this execution went through, resolved from the registry before anything ran. Absent on rows written before 2026-09-02; null when the registry could not resolve the route. Records what was invoked — never that it was proven. */
  capability_id?: string | null;
  authorized: boolean;
  authorization_reason: string;
  executed: boolean;
  /** DISPATCH status, unchanged in meaning: the adapter accepted and completed the send. COMPLETED has never meant the effect happened and still does not. */
  result_status: string | null;
  started_at: string;
  completed_at: string;
  /**
   * The target's own state as read immediately BEFORE the action, and again
   * immediately AFTER. Absent on rows written before 2026-09-02.
   *
   * These are observations, not judgements. `before.scrollY=0` with
   * `after.scrollY=600` records only what was read at two moments; whether that
   * satisfies anything is a question this record does not answer and this step
   * does not ask. An observation that could not be acquired says so and carries
   * no state — a zeroed state would read as real evidence that nothing moved.
   */
  /**
   * What observable effect this action was supposed to produce, fixed BEFORE
   * the action and before the BEFORE observation. Absent on rows written before
   * 2026-09-02.
   *
   * This is not a claim that the effect happened, and it is not compared with
   * anything here. It exists so that a later reader does not have to infer what
   * was supposed to happen from what did — an inference that would make the
   * record's meaning depend on whoever read it.
   */
  expectation?: ExpectationRecord;
  observation_before?: Observation;
  /**
   * Where the pointer was and which process was frontmost immediately before
   * dispatch — the two facts the window server uses to route a coordinate-less
   * scroll wheel event. Absent on rows written before 2026-09-02.
   *
   * Facts only. It does not say the pointer was over the target, that the
   * window could have received the event, or that routing succeeded or failed;
   * those are conclusions for a later procedure. A value that could not be read
   * is null with a reason — never a zeroed coordinate or a remembered pid.
   */
  routing_context?: RoutingContext;
  /**
   * What the native helper reported about the CGEvent itself: whether it was
   * constructed, and whether post() was invoked. Absent on rows written before
   * 2026-09-02, which report UNAVAILABLE and are never backfilled.
   *
   * Two facts, and only two — CGEventPost returns void, so nothing here says the
   * window server accepted, routed or delivered anything. The legacy `OK scroll`
   * line is not consulted: it prints unconditionally and proves only that the
   * helper reached that statement.
   */
  cgevent_instrumentation?: CgEventInstrumentation;
  observation_after?: Observation;
  /** The declared delay between the action and the AFTER reading. 0 means immediate. */
  settle_ms?: number;
  /**
   * Whether the effect declared BEFORE the action is what the two readings
   * actually show. Absent on rows written before 2026-09-02.
   *
   * Three states, and the third is not a softer second: VERIFIED and FAILED
   * both mean every reading the expectation needed was really acquired, while
   * UNPROVEN means the system could not look. `result_status: COMPLETED` never
   * contributes — the evaluator cannot see it. This is an execution-level
   * statement about one action, and is NOT a capability-level proof.
   */
  effect_verdict?: EffectVerdict;
  /** Absent on rows written before 2026-09-02 and on paths where no adapter outcome exists (authority denied, operation not wired) — readers must treat absence as "no outcome was produced", never as failure. */
  outcome?: PersistedOutcome | null;
}

/** Copies the outcome across without interpreting it. A field the producer left null stays null. */
function preserveOutcome(outcome: UiWorkOrderOutcome): PersistedOutcome {
  return {
    dispatch_evidence: { ok: outcome.ok, summary: outcome.summary, evidence: [...outcome.evidence], idempotent_replay: outcome.idempotent_replay },
    artifact_references: outcome.artifacts.map((artifact) => ({ kind: artifact.kind, ref: artifact.ref })),
    presentation_state: outcome.presentation ?? null,
    focus_restoration_verified: outcome.focus_restored ?? null,
    next_action: outcome.next_action ?? null,
  };
}

function writeEvidence(dir: string, ev: ExecutionEvidence): void {
  const base = join(process.cwd(), dir);
  mkdirSync(base, { recursive: true });
  const file = join(base, EVIDENCE_FILE);
  if (!existsSync(file)) writeFileSync(file, "", "utf-8");
  appendFileSync(file, `${JSON.stringify(ev)}\n`, { encoding: "utf8", mode: 0o600 });
}

export interface ExecutorDeps {
  validateAuthority: typeof validateAuthority;
  runUiWorkOrder: typeof runUiWorkOrder;
  /** Reads the real target state. Injected so tests observe deterministically; production uses the accessibility reader. */
  observe?: (target: ObservationTarget) => Observation;
  now: () => Date;
  newEvidenceId: () => string;
  evidenceDir: string;
  /** Reads routing context immediately before dispatch. Injected so tests never touch the OS. */
  captureRoutingContext?: (target: { pid?: number }) => RoutingContext;
  /** Host platform for MAC_LOCAL_AGENT execution. Tests inject; production uses the real host. */
  platform?: string;
}

const defaultDeps: ExecutorDeps = {
  validateAuthority,
  runUiWorkOrder,
  observe: observeWindowTitleState,
  captureRoutingContext,
  now: () => new Date(),
  newEvidenceId: () => `cue-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
  evidenceDir: EVIDENCE_DIR,
};

/**
 * execute หนึ่ง computer-use request ผ่าน DNA OS ทั้งเส้น — fail closed
 * ทุก path บันทึก evidence เสมอ (ทั้งอนุมัติและปฏิเสธ) โดย execution_owner = DNA OS
 */
export async function executeComputerUse(req: ComputerUseRequest, deps: ExecutorDeps = defaultDeps): Promise<{ outcome: UiWorkOrderOutcome | null; evidence: ExecutionEvidence }> {
  const startedAt = deps.now().toISOString();
  const baseEvidence = {
    evidence_id: deps.newEvidenceId(),
    work_order_id: req.work_order_id,
    execution_owner: EXECUTOR_IDENTITY,
    executor_pid: typeof process !== "undefined" ? process.pid : -1,
    executor_process_title: typeof process !== "undefined" ? (process.title ?? "node") : "unknown",
    requester: req.requester,
    authority_id: req.authority_id,
    operation: req.operation,
    target: req.target,
    capability_id: EXECUTION_ROUTE_CAPABILITY_ID,
  };

  // 1) DNA OS permission lease — fail closed
  // 0) IDENTITY — settled before authority and before anything runs. A caller
  // that names a capability must name the one this route resolves to; a
  // different or unregistered id is refused here rather than quietly replaced
  // with os-ui, because an execution recorded under the wrong capability is
  // worse than one that did not run.
  if (typeof req.capability_id === "string") {
    if (req.capability_id.length === 0 || !/^capability-[0-9a-f-]{36}$/.test(req.capability_id)) {
      const evidence: ExecutionEvidence = { ...baseEvidence, capability_id: null, authorized: false, authorization_reason: "CAPABILITY_ID_MALFORMED", executed: false, result_status: null, started_at: startedAt, completed_at: deps.now().toISOString(), outcome: null, expectation: NO_EXPECTATION_ATTEMPTED, observation_before: NOT_OBSERVED, routing_context: NOT_CAPTURED, cgevent_instrumentation: NO_CGEVENT_INSTRUMENTATION, observation_after: NOT_OBSERVED, effect_verdict: evaluateEffect(NO_EXPECTATION_ATTEMPTED, NOT_OBSERVED, NOT_OBSERVED, deps.now) };
      writeEvidence(deps.evidenceDir, evidence);
      return { outcome: null, evidence };
    }
    if (req.capability_id !== EXECUTION_ROUTE_CAPABILITY_ID) {
      // Covers both "not registered at all" and "registered but not what this
      // route invokes" — from the executor's side they are the same refusal:
      // the declared identity is not the identity that would have run.
      const evidence: ExecutionEvidence = { ...baseEvidence, capability_id: null, authorized: false, authorization_reason: `CAPABILITY_ROUTE_MISMATCH: declared ${req.capability_id}, this route invokes ${EXECUTION_ROUTE_CAPABILITY_ID ?? "UNRESOLVED"}`, executed: false, result_status: null, started_at: startedAt, completed_at: deps.now().toISOString(), outcome: null, expectation: NO_EXPECTATION_ATTEMPTED, observation_before: NOT_OBSERVED, routing_context: NOT_CAPTURED, cgevent_instrumentation: NO_CGEVENT_INSTRUMENTATION, observation_after: NOT_OBSERVED, effect_verdict: evaluateEffect(NO_EXPECTATION_ATTEMPTED, NOT_OBSERVED, NOT_OBSERVED, deps.now) };
      writeEvidence(deps.evidenceDir, evidence);
      return { outcome: null, evidence };
    }
  }

  const auth = deps.validateAuthority({
    authority_id: req.authority_id, requester: req.requester, executor: EXECUTOR_IDENTITY,
    operation: req.operation, target: req.target, scope_needed: req.scope_needed,
  });
  if (!auth.ok) {
    // No adapter ran, so there is no outcome to preserve — null, never an empty shell that could read as "observed nothing".
    const evidence: ExecutionEvidence = { ...baseEvidence, authorized: false, authorization_reason: `${auth.reason_code}: ${auth.detail}`, executed: false, result_status: null, started_at: startedAt, completed_at: deps.now().toISOString(), outcome: null, expectation: NO_EXPECTATION_ATTEMPTED, observation_before: NOT_OBSERVED, routing_context: NOT_CAPTURED, cgevent_instrumentation: NO_CGEVENT_INSTRUMENTATION, observation_after: NOT_OBSERVED, effect_verdict: evaluateEffect(NO_EXPECTATION_ATTEMPTED, NOT_OBSERVED, NOT_OBSERVED, deps.now) };
    writeEvidence(deps.evidenceDir, evidence);
    return { outcome: null, evidence };
  }

  // 1.5) EXPECTATION — fixed here, which is before the BEFORE observation and
  // before the adapter call below. `buildExpectation` has no parameter that can
  // carry an observation, so an expectation derived from AFTER is not a mistake
  // this code can make; the ordering is a property of the types, not only of
  // these lines. An operation with no deterministic rule yields an explicitly
  // unavailable record and is NOT blocked here — authority semantics are
  // unchanged by this step.
  const expectation: ExpectationRecord = buildExpectation(
    { operation: req.operation, ui: { text: req.ui.text }, intent_declaration: req.intent_declaration },
    deps.now,
  );

  // 2) map operation -> os-ui action; ปฏิเสธ operation ที่ยังไม่ผูก adapter
  const uiAction = OPERATION_TO_UI_ACTION[req.operation];
  if (!uiAction) {
    const evidence: ExecutionEvidence = { ...baseEvidence, authorized: true, authorization_reason: "AUTHORIZED", executed: false, result_status: "OPERATION_NOT_WIRED", started_at: startedAt, completed_at: deps.now().toISOString(), outcome: null, expectation, observation_before: NOT_OBSERVED, routing_context: NOT_CAPTURED, cgevent_instrumentation: NO_CGEVENT_INSTRUMENTATION, observation_after: NOT_OBSERVED, effect_verdict: evaluateEffect(expectation, NOT_OBSERVED, NOT_OBSERVED, deps.now) };
    writeEvidence(deps.evidenceDir, evidence);
    return { outcome: null, evidence };
  }

  const node = macLocalAgentExecutionDecision({ current_node: "CORE_NODE", platform: deps.platform });
  if (!node.execute) {
    const evidence: ExecutionEvidence = {
      ...baseEvidence,
      authorized: true,
      authorization_reason: "AUTHORIZED",
      executed: false,
      result_status: node.reason_code,
      started_at: startedAt,
      completed_at: deps.now().toISOString(),
      outcome: null,
      expectation,
      observation_before: NOT_OBSERVED,
      routing_context: NOT_CAPTURED,
      cgevent_instrumentation: NO_CGEVENT_INSTRUMENTATION,
      observation_after: NOT_OBSERVED,
      effect_verdict: evaluateEffect(expectation, NOT_OBSERVED, NOT_OBSERVED, deps.now),
    };
    writeEvidence(deps.evidenceDir, evidence);
    return { outcome: null, evidence };
  }

  // 3) execute ผ่าน os-ui adapter (admission ของ os-ui ยังทำงานอีกชั้น — fail closed ซ้อน)
  const order = { ui_action: uiAction, target: req.ui.target ?? req.target, scope: req.ui.scope ?? "chrome-tab", timeout_ms: req.ui.timeout_ms ?? 15000, dry_run: false, risk_confirmed: true, ...req.ui } as UiWorkOrder;

  // BEFORE -> ACTION -> AFTER. The two reads bracket the adapter call as
  // tightly as possible so the pair describes this action and not the drift
  // around it. Neither read can change the action: the adapter call below is
  // byte-for-byte the one that was here before, and an observation failure only
  // makes the corresponding record `acquired:false`.
  const observer = deps.observe;
  const observationBefore: Observation = observer && req.observation_target ? observer(req.observation_target) : NOT_OBSERVED;

  // ROUTING CONTEXT — the last thing read before the adapter call, and read
  // AFTER the BEFORE observation so that the observation's own osascript round
  // trip does not sit between these readings and the dispatch. A scroll wheel
  // event carries no coordinate, so the window server routes it by pointer
  // position and frontmost window; those two facts are unrecoverable once the
  // instant has passed. There is deliberately nothing between this line and
  // `runUiWorkOrder` below — no observation, no await, no other work — which is
  // the whole meaning of the capture point's name.
  const routingContext: RoutingContext = req.capture_routing_context === true && deps.captureRoutingContext
    ? deps.captureRoutingContext({ pid: req.observation_target?.pid })
    : NOT_CAPTURED;
  const outcome = await deps.runUiWorkOrder(order);

  // SETTLE WINDOW — a declared measurement delay, not an adaptive one.
  //
  // The AFTER reading used to be taken the instant the adapter returned. For a
  // browser target that is too early: the event still has to reach the DOM, the
  // page has to update the state it publishes, and Accessibility has to expose
  // the new window title. On 2026-09-02 a real click on the Owner application
  // reported `clicks 0 -> 0` and FAILED, while the tab title read `clicks=2`
  // moments later — the effect had happened; the measurement had not waited.
  //
  // WHY FIXED AND NOT POLL-UNTIL-SATISFIED. Polling until the expectation holds
  // stops early on success and runs full length on failure, making the
  // measurement a function of the answer — the "retry until you like the
  // result" this codebase forbids. This waits the same declared time whatever
  // happens, and the duration is recorded so a reader can see how long the
  // system looked before deciding. Default 0 leaves every existing caller
  // byte-for-byte unchanged.
  const settleMs = typeof req.settle_ms === "number" && req.settle_ms > 0 ? Math.min(req.settle_ms, 5000) : 0;
  if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
  const observationAfter: Observation = observer && req.observation_target ? observer(req.observation_target) : NOT_OBSERVED;
  // 7) EFFECT VERDICT — only now, with both readings in hand. It is computed
  // after the adapter has already returned, so it cannot influence the action;
  // and `evaluateEffect` receives only the expectation and the two
  // observations, so neither `outcome` nor `result_status` can reach it. A
  // dispatch that says COMPLETED therefore cannot produce VERIFIED.
  const effectVerdict: EffectVerdict = evaluateEffect(expectation, observationBefore, observationAfter, deps.now);

  const evidence: ExecutionEvidence = { ...baseEvidence, authorized: true, authorization_reason: "AUTHORIZED", executed: true, result_status: outcome.status, started_at: startedAt, completed_at: deps.now().toISOString(), outcome: preserveOutcome(outcome), expectation, observation_before: observationBefore, routing_context: routingContext, cgevent_instrumentation: parseCgEventInstrumentation(outcome.evidence), observation_after: observationAfter, settle_ms: settleMs, effect_verdict: effectVerdict };
  writeEvidence(deps.evidenceDir, evidence);
  return { outcome, evidence };
}
