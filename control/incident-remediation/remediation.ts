/**
 * หน้าที่: the INCIDENT -> RESOURCE -> REMEDIATION loop. Orchestration
 * ONLY — every mechanism it uses already existed and was already proven.
 *
 *   OwnerIncidentReport (../alert-correlation/)
 *     -> financial guard (§F)
 *     -> resolveWriteIntent + persistResolution (../work-resolution/)
 *     -> discoverPool + routeWork (../scheduler/)   <- resource selection
 *     -> launchAgentForWork (../work-resolution/sandbox-bridge)  <- OS confinement
 *     -> machine-observation evidence (../machine-observation/)
 *     -> re-query the ORIGINAL fault (../alert-correlation/#assessIncident)
 *     -> exactly one of three terminal states
 *
 * WHAT THIS FILE DOES NOT DO, ON PURPOSE: it does not select providers by
 * judgement (that is `routeWork`'s deterministic score), does not decide
 * whether a fix worked (that is the original-fault re-query), does not
 * authorise spend (that terminates at OWNER_DECISION_REQUIRED), and does
 * not write files (that is the sandboxed Agent, inside a kernel-enforced
 * scope).
 *
 * Input: an `OwnerIncidentReport` + a `RegistryStore`.
 * Output: `openRemediation`, `selectExecutionResource`, `dispatchRemediation`,
 * `observeRemediation`, `verifyOriginalFault`, `advanceRemediation`.
 * Dependency ที่อนุญาต: ./types.ts, ./persistence.ts,
 * ../alert-correlation/contract.ts, ../work-resolution/contract.ts,
 * ../work-resolution/sandbox-bridge.ts, ../scheduler/contract.ts,
 * ../machine-observation/contract.ts, ../../software/live-census/contract.ts.
 * สิ่งที่ห้ามแตะ: never add a fourth terminal state, never let an Agent's
 * own report set `fault_check.cleared`, and never auto-purchase anything.
 */

import { randomUUID } from "node:crypto";
import { resolveWriteIntent, persistResolution, UNKNOWN } from "../work-resolution/contract";
import { launchAgentForWork } from "../work-resolution/sandbox-bridge";
import { discoverPool, routeWork } from "../scheduler/contract";
import { assessIncident, parseAlertEmail, resolveTarget, type OwnerIncidentReport } from "../alert-correlation/contract";
import { loadPreviousSnapshot } from "../../software/live-census/contract";
import { findProcessesUnderPath, listProcesses } from "../machine-observation/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import type { ExecutionAttempt, ObservedWriteEvidence, OriginalFaultCheck, RemediationRecord } from "./types";
import { saveRemediation } from "./persistence";
import { asIncidentSource, normalizeIncidentSource, NOT_APPLICABLE, type IncidentSource } from "./incident-source";
import { resolveInternalTarget } from "./internal-target-resolution";
import { classifyChange, diffScope, recordObservedChanges, snapshotScope, observationsForWork } from "./observed-changes";
import { REPO_ROOT } from "../work-resolution/host-runtime";

/**
 * §F. Alert classes whose remediation would cost money. These NEVER reach
 * an Agent — the loop terminates at OWNER_DECISION_REQUIRED before any
 * resource is even selected, so there is no path where software could buy
 * tokens, upgrade a plan, or add a payment method.
 */
const FINANCIAL_ALERT_TYPES = new Set(["BILLING_FAILURE"]);
/** Failover outcomes that are a MONEY problem, not a capacity problem. */
const FINANCIAL_FAILOVER_OUTCOMES = new Set(["TOKEN_EXHAUSTED"]);

function nowIso(): string {
  return new Date().toISOString();
}

/** §C. Persisted census snapshot first — never an expensive blind recompute. */
function censusEvidence(): string {
  try {
    // Returns the capability rows straight from the persisted snapshot file.
    const capabilities = loadPreviousSnapshot();
    if (capabilities.length === 0) return "no persisted census snapshot available (or it is empty)";
    const verified = capabilities.filter((c) => String((c as unknown as { status?: string }).status ?? "") === "VERIFIED").length;
    return `persisted census snapshot: ${capabilities.length} capabilities, ${verified} VERIFIED (loaded from disk, not recomputed)`;
  } catch (error) {
    return `census snapshot unreadable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Opens a remediation from a real incident. Resolves the architecture and
 * persists it BEFORE any Agent exists.
 */
/**
 * รับเหตุได้จากทุกแหล่ง แล้วเดินท่อเดียวกันหลังจุด normalize
 * (Owner, EXTEND_EXISTING_INCIDENT_INPUT_CONTRACT)
 *
 * ผู้เรียกเดิมที่ส่ง `OwnerIncidentReport` มาตรง ๆ ยังทำงานเหมือนเดิมทุกประการ
 * เพราะ `asIncidentSource` ห่อให้เป็น EXTERNAL_PROVIDER_EMAIL อัตโนมัติ และ
 * ความเข้มงวดของฝั่งอีเมลไม่ถูกลดลงเลย — ชนิดของมันไม่ได้ถูกแตะ
 *
 * ตั้งแต่บรรทัดหลัง normalize เป็นต้นไป ไม่มีโค้ดใดรู้ว่าเหตุมาจากอีเมลหรือจาก
 * การรันของระบบเอง ท่อ persistence/escalation/diagnosis/repair/verify/resume
 * จึงมีชุดเดียวตามที่ล็อกไว้
 */
export function openRemediation(input: OwnerIncidentReport | IncidentSource, store: RegistryStore): RemediationRecord {
  const incidentId = `incident-${randomUUID()}`;
  const workId = `work-${incidentId}`;
  const incident = normalizeIncidentSource(asIncidentSource(input));

  const base = {
    incident_id: incidentId,
    work_id: workId,
    provider: incident.provider,
    service_id: incident.service_id,
    census_evidence: censusEvidence(),
    current_runtime_state: incident.current_real_state,
    attempts: [] as ExecutionAttempt[],
    observation: null,
    fault_check: null,
    ai_financial_authority: false as const,
    ai_provider_selection_authority: false as const,
    updated_at: nowIso(),
  };

  // ===== §F FINANCIAL GUARD — before anything else =====
  if (incident.is_financial) {
    return saveRemediation({
      ...base,
      resolution_id: UNKNOWN,
      resource_id: UNKNOWN,
      capability_id: UNKNOWN,
      runtime_owner: UNKNOWN,
      source_root: UNKNOWN,
      exact_source_paths: [],
      dependencies: [],
      consumers: [],
      credential_boundary: UNKNOWN,
      allowed_write_scope: [],
      forbidden_write_scope: [],
      required_remediation: incident.recommended_next_software_action,
      terminal_state: "OWNER_DECISION_REQUIRED",
      block_reason: "FINANCIAL_DECISION",
      next_action: `OWNER DECISION REQUIRED — ${incident.provider} reported "${incident.incident_label}". Software must not pay, retry a charge, change a plan, or authorise spend. No execution resource was selected and no Agent was dispatched.`,
    });
  }

  // ===== §J CASE E — unknown service/provider stays VISIBLE =====
  if (incident.unresolved) {
    return saveRemediation({
      ...base,
      resolution_id: UNKNOWN,
      resource_id: UNKNOWN,
      capability_id: UNKNOWN,
      runtime_owner: UNKNOWN,
      source_root: UNKNOWN,
      exact_source_paths: [],
      dependencies: [],
      consumers: [],
      credential_boundary: UNKNOWN,
      allowed_write_scope: [],
      forbidden_write_scope: [],
      required_remediation: incident.recommended_next_software_action,
      terminal_state: "OWNER_DECISION_REQUIRED",
      block_reason: "UNKNOWN_SERVICE_OR_PROVIDER",
      next_action: `${incident.unresolved_reason}. Escalated to the Owner rather than dropped — register the service, or decide it is out of scope.`,
    });
  }

  /**
   * เหตุภายในระบุเป้าหมายจาก "ตัวตนของการรัน" ก่อนเสมอ (Owner, PART 2)
   *
   * `resolveWriteIntent` ข้างล่างถูกออกแบบมาสำหรับเหตุจากอีเมลที่มีชื่อ service ชัด
   * พอเจอเหตุภายในที่ให้มาเป็นโฟลเดอร์ มันไปกวาดชื่อไฟล์แล้วจบที่
   * UNRESOLVED_ARCHITECTURE — ทั้งที่ระบบรู้อยู่แล้วว่าเกิดที่ resource/capability ไหน
   * จึงลองตัวตนก่อน และใช้ทางเดิมเป็นทางเลือกสำรอง ไม่ใช่ทางแรก
   */
  if (incident.execution_identity !== null) {
    const target = resolveInternalTarget(incident.execution_identity);
    if (target.resolved) {
      return saveRemediation({
        ...base,
        resolution_id: UNKNOWN,
        resource_id: target.resource_id ?? UNKNOWN,
        capability_id: target.capability_id ?? UNKNOWN,
        runtime_owner: target.source_location ?? UNKNOWN,
        source_root: target.source_location ?? UNKNOWN,
        exact_source_paths: target.source_location !== null ? [target.source_location] : [],
        dependencies: [],
        consumers: [],
        credential_boundary: NOT_APPLICABLE,
        allowed_write_scope: [],
        forbidden_write_scope: [],
        required_remediation: incident.recommended_next_software_action,
        terminal_state: "OWNER_DECISION_REQUIRED",
        block_reason: "NO_AUTHORIZED_EXECUTION_RESOURCE",
        next_action: `เป้าหมายระบุได้จากตัวตนของการรัน (${target.identity_fields_used.join(" -> ")}) ที่ ${target.source_location ?? UNKNOWN} — ${target.reason}. การซ่อมต้องใช้ความสามารถที่ยังไม่มีผู้ให้บริการ จึงส่งให้เจ้าของตัดสิน`,
      });
    }
    return saveRemediation({
      ...base,
      resolution_id: UNKNOWN,
      resource_id: target.resource_id ?? UNKNOWN,
      capability_id: target.capability_id ?? UNKNOWN,
      runtime_owner: UNKNOWN, source_root: UNKNOWN, exact_source_paths: [],
      dependencies: [], consumers: [], credential_boundary: NOT_APPLICABLE,
      allowed_write_scope: [], forbidden_write_scope: [],
      required_remediation: incident.recommended_next_software_action,
      terminal_state: "OWNER_DECISION_REQUIRED",
      block_reason: "UNRESOLVED_ARCHITECTURE",
      next_action: `ระบุเป้าหมายจากตัวตนของการรันไม่ได้ — ${target.missing_relationship ?? target.reason}. ไม่กวาดชื่อไฟล์แทน และไม่เดา`,
    });
  }

  // ===== §D RESOLVE THE ARCHITECTURE, then persist BEFORE dispatch =====
  const context = resolveWriteIntent(
    {
      requested_function: incident.service_id,
      requested_change: incident.recommended_next_software_action,
      target_domain: incident.affected_resource !== UNKNOWN ? incident.affected_resource : "",
      owner_intent: `remediate ${incident.incident_label} on ${incident.service_id}`,
      current_work_id: workId,
    },
    store,
  );

  if (!context.dispatchable) {
    return saveRemediation({
      ...base,
      resolution_id: UNKNOWN,
      resource_id: context.existing_resource_id,
      capability_id: context.existing_capability_id,
      runtime_owner: context.runtime_owner,
      source_root: context.source_root,
      exact_source_paths: context.exact_source_paths,
      dependencies: context.dependencies,
      consumers: context.consumers,
      credential_boundary: context.credential_boundary,
      allowed_write_scope: context.allowed_write_scope,
      forbidden_write_scope: context.forbidden_write_scope,
      required_remediation: incident.recommended_next_software_action,
      terminal_state: "OWNER_DECISION_REQUIRED",
      block_reason: "UNRESOLVED_ARCHITECTURE",
      next_action: `${context.blocking_reason} — NOT sending an Agent to search. Deterministic reconciliation or an Owner decision is required first.`,
    });
  }

  const persisted = persistResolution(context);
  return saveRemediation({
    ...base,
    resolution_id: persisted.resolution_id,
    resource_id: context.existing_resource_id,
    capability_id: context.existing_capability_id,
    runtime_owner: context.runtime_owner,
    source_root: context.source_root,
    exact_source_paths: context.exact_source_paths,
    dependencies: context.dependencies,
    consumers: context.consumers,
    credential_boundary: context.credential_boundary,
    allowed_write_scope: context.allowed_write_scope,
    forbidden_write_scope: context.forbidden_write_scope,
    required_remediation: incident.recommended_next_software_action,
    terminal_state: "AUTO_RECOVERY_IN_PROGRESS",
    block_reason: "NONE",
    next_action: context.next_action,
  });
}

export interface ResourceSelection {
  readonly ok: boolean;
  readonly provider: string;
  readonly unit_id: string;
  readonly execution_id: string;
  readonly reason: string;
}

/**
 * §E. Selects an execution resource with the EXISTING deterministic
 * router. `excludeProviders` carries the ones that already failed for this
 * SAME work_id, so failover never re-picks an exhausted provider — and
 * never creates new work.
 */
export function selectExecutionResource(record: RemediationRecord, excludeProviders: readonly string[] = []): ResourceSelection {
  const pool = discoverPool(1).filter((u) => !excludeProviders.includes(u.provider));
  const decision = routeWork(
    { work_id: record.work_id, kind: "REPAIR", write_scope: record.allowed_write_scope, blocked_by: [], test_files: [] } as never,
    pool,
    new Map(),
    [],
  ) as { ok: boolean; unit?: { unit_id: string; provider: string }; reason?: string };

  if (!decision.ok || !decision.unit) {
    return { ok: false, provider: UNKNOWN, unit_id: UNKNOWN, execution_id: UNKNOWN, reason: decision.reason ?? "NO_AVAILABLE_PROVIDER" };
  }
  return {
    ok: true,
    provider: decision.unit.provider,
    unit_id: decision.unit.unit_id,
    // NEW execution identity per attempt; the work_id deliberately does not change.
    execution_id: `execution-${randomUUID()}`,
    reason: `routeWork selected ${decision.unit.unit_id} deterministically (no model involved)`,
  };
}

/**
 * §A. Dispatches through the sandbox. There is no unrestricted branch —
 * if the persisted resolution refuses, nothing runs.
 */
export async function dispatchRemediation(
  record: RemediationRecord,
  selection: ResourceSelection,
  executable: string,
  argv: readonly string[],
): Promise<{ record: RemediationRecord; launched: boolean; detail: string }> {
  const outcome = await launchAgentForWork(record.work_id, executable, argv, { timeoutMs: 60_000 });
  const attempt: ExecutionAttempt = {
    execution_id: selection.execution_id,
    provider: selection.provider,
    unit_id: selection.unit_id,
    started_at: nowIso(),
    outcome: outcome.launched ? "DISPATCHED" : "REFUSED_BY_SANDBOX",
    detail: outcome.detail,
  };
  const next = saveRemediation({ ...record, attempts: [...record.attempts, attempt], updated_at: nowIso() });
  return { record: next, launched: outcome.launched, detail: outcome.detail };
}

/**
 * §E. Records a provider failure and fails over, PRESERVING work_id,
 * incident_id and the persisted resolution. A TOKEN_EXHAUSTED with no
 * alternative is a MONEY decision, not a retry.
 */
export function failoverExecutionResource(record: RemediationRecord, failedProvider: string, outcome: ExecutionAttempt["outcome"], detail: string): RemediationRecord {
  const failed: ExecutionAttempt = {
    execution_id: `execution-${randomUUID()}`,
    provider: failedProvider,
    unit_id: `${failedProvider}#failed`,
    started_at: nowIso(),
    outcome,
    detail,
  };
  const attempts = [...record.attempts, failed];
  const exhausted = [...new Set(attempts.filter((a) => a.outcome === "TOKEN_EXHAUSTED" || a.outcome === "UNAVAILABLE").map((a) => a.provider))];
  const next = selectExecutionResource(record, exhausted);

  if (next.ok) {
    return saveRemediation({ ...record, attempts, terminal_state: "AUTO_RECOVERY_IN_PROGRESS", block_reason: "NONE", next_action: `Failover: ${failedProvider} -> ${next.unit_id}. SAME work_id ${record.work_id}, SAME resolution ${record.resolution_id}, new execution ${next.execution_id}.`, updated_at: nowIso() });
  }

  const financial = FINANCIAL_FAILOVER_OUTCOMES.has(outcome);
  return saveRemediation({
    ...record,
    attempts,
    terminal_state: "OWNER_DECISION_REQUIRED",
    block_reason: financial ? "PAYMENT_REQUIRED" : "NO_AUTHORIZED_EXECUTION_RESOURCE",
    next_action: financial
      ? `PAYMENT_REQUIRED — every authorized execution resource is exhausted (${exhausted.join(", ")}). Restoring capacity means buying tokens or upgrading a plan. AUTOMATIC_PURCHASE=NO; software stops here and the Owner decides. work_id ${record.work_id} is preserved for resumption.`
      : `No authorized, active, available execution resource remains (${next.reason}). Owner decision required; work_id ${record.work_id} preserved.`,
    updated_at: nowIso(),
  });
}

/**
 * §B. Machine Observation is EVIDENCE, never a verdict. It reports what
 * actually changed; a deviation from the approved scope blocks, but
 * "no deviation" never means "the fix worked".
 */
export function observeRemediation(
  record: RemediationRecord,
  before: ReadonlyMap<string, string>,
  callerClaimedFiles: readonly string[] = [],
): RemediationRecord {
  let pids: number[] = [];
  try {
    const candidatePids = (listProcesses() as unknown as { pid: number }[]).map((r) => r.pid);
    pids = (findProcessesUnderPath(record.source_root, candidatePids) as unknown as { pid: number }[]).map((p) => p.pid);
  } catch {
    pids = [];
  }

  // CANONICAL files_changed come from a real digest diff of the approved
  // scope. The caller's claim is metadata only — §3's whole point is that
  // a caller reporting [] while its child wrote a file must still be caught.
  const after = snapshotScope(record.allowed_write_scope);
  const observedAbsolute = diffScope(before, after);
  const executionId = record.attempts[record.attempts.length - 1]?.execution_id ?? "no-execution";
  recordObservedChanges(record.work_id, executionId, record.resource_id, observedAbsolute, REPO_ROOT);

  // Read the evidence BACK from the store, so what is judged is what was
  // actually persisted — not an in-memory value this function computed.
  const observedPaths = observationsForWork(record.work_id).map((r) => r.path);
  const classified = observedPaths.map((p) => classifyChange(p, record.allowed_write_scope.map((s) => s.replace(`${REPO_ROOT}/`, "")), record.forbidden_write_scope, []));
  const outOfScope = classified.filter((c) => c.classification === "OUT_OF_SCOPE_CHANGE").map((c) => c.path);
  const unknown = classified.filter((c) => c.classification === "UNKNOWN_CHANGE").map((c) => c.path);
  const undeclared = observedPaths.filter((p) => !callerClaimedFiles.some((c) => c.endsWith(p) || p.endsWith(c)));

  const observation: ObservedWriteEvidence = {
    observed_at: nowIso(),
    pids,
    files_changed: observedPaths,
    out_of_scope_writes: outOfScope,
    detail: `${observedPaths.length} change(s) observed by digest diff and persisted to the observation store; caller claimed ${callerClaimedFiles.length}; ${undeclared.length} observed change(s) the caller did not declare`,
  };

  if (outOfScope.length > 0) {
    return saveRemediation({
      ...record,
      observation,
      terminal_state: "OWNER_DECISION_REQUIRED",
      block_reason: "REMEDIATION_POLICY_VIOLATION",
      next_action: `REMEDIATION_POLICY_VIOLATION — OBSERVED writes outside allowed_write_scope: ${outOfScope.join(", ")}. Incident stays OPEN; evidence persisted in the observation store.`,
      updated_at: nowIso(),
    });
  }
  if (unknown.length > 0) {
    // §2: UNKNOWN_CHANGE fails closed. It is never silently accepted.
    return saveRemediation({
      ...record,
      observation,
      terminal_state: "OWNER_DECISION_REQUIRED",
      block_reason: "REMEDIATION_POLICY_VIOLATION",
      next_action: `UNKNOWN_CHANGE — ${unknown.length} observed change(s) inside scope could not be matched to an expected artifact: ${unknown.slice(0, 5).join(", ")}. Failing closed rather than accepting silently.`,
      updated_at: nowIso(),
    });
  }
  return saveRemediation({ ...record, observation, updated_at: nowIso() });
}

/**
 * §G. Re-queries the ORIGINAL fault source. The Agent's own report is
 * never consulted — this calls the same `assessIncident` live probe the
 * incident was raised from.
 */
export async function verifyOriginalFault(record: RemediationRecord, originalReport: OwnerIncidentReport): Promise<RemediationRecord> {
  const alert = parseAlertEmail({
    message_id: originalReport.assessment.alert.message_id,
    thread_id: originalReport.assessment.alert.thread_id,
    sender: originalReport.assessment.alert.sender,
    received_at: originalReport.assessment.alert.received_at,
    subject: originalReport.assessment.alert.reported_status,
    body: "",
  });
  const target = resolveTarget(originalReport.assessment.alert);
  const reassessed = await assessIncident(alert, target);

  const cleared = reassessed.incident_state === "ALERT_HISTORICAL_RECOVERED";
  const check: OriginalFaultCheck = {
    checked_at: nowIso(),
    source: `re-queried ${target.health_url} via alert-correlation#assessIncident (NOT the Agent's report)`,
    cleared,
    detail: `original fault re-check -> ${reassessed.incident_state}: ${reassessed.evidence[reassessed.evidence.length - 1] ?? ""}`,
  };

  if (cleared) {
    return saveRemediation({ ...record, fault_check: check, terminal_state: "RESOLVED", block_reason: "NONE", next_action: "Original fault condition cleared at its own source. Incident RESOLVED.", updated_at: nowIso() });
  }
  return saveRemediation({
    ...record,
    fault_check: check,
    terminal_state: "OWNER_DECISION_REQUIRED",
    block_reason: "ORIGINAL_FAULT_PERSISTS",
    next_action: `REMEDIATION_FAILED — the original fault is still present when re-queried at its own source, regardless of what the Agent reported. Incident stays OPEN; select the next authorized remediation path or escalate.`,
    updated_at: nowIso(),
  });
}
