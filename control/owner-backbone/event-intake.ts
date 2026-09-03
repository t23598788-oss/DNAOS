/**
 * หน้าที่: ONE canonical path for every operational event, whatever produced
 * it — an email, a health probe, a build, a provider API, a bank.
 *
 *   EVENT -> IDENTIFY -> RESOLVE DEPENDENCIES -> IMPACT -> DECIDE -> ACT
 *         -> VERIFY -> EMIT NEXT EVENT -> CONTINUE
 *
 * IT ADDS NO MECHANISM. Identification is a closed classifier; dependency
 * facts come from `./dependency-map.ts`; the decision is a policy lookup;
 * acting hands off to whichever EXISTING executor owns that class of work
 * (`./autonomous-recovery.ts` for services, `./resource-availability.ts` for
 * execution resources, `../incident-remediation/` for code, `./events.ts`
 * for output). This file decides WHICH existing path an event belongs on —
 * it is a router, not a second pipeline.
 *
 * EMAIL IS AN INPUT, NOT A REPORT. A provider's email is a CLAIM. Where live
 * evidence exists it outranks the claim — a "projects paused" email against
 * a project that is currently answering is history, not an incident, and the
 * Owner is not woken for it.
 *
 * UNKNOWN STAYS VISIBLE. An event that cannot be classified is persisted,
 * emitted and counted. It is never dropped, and it never becomes a guess.
 *
 * Input: a `RawOperationalEvent` from any class.
 * Output: `intakeEvent`, `classifyEvent`, `assessImpact`, `decideAction`,
 * `intakeProviderEmails`.
 * Dependency ที่อนุญาต: ./dependency-map.ts, ./events.ts, ./types.ts,
 * ./autonomous-recovery.ts, ./resource-availability.ts, ./action-ledger.ts,
 * ../alert-correlation/contract.ts, ../work-continuation/contract.ts,
 * ../../connections/email-alert-source/authenticated-invoke.ts.
 * สิ่งที่ห้ามแตะ: never spend money and never authorize spending — a new
 * financial commitment terminates at OWNER_DECISION_REQUIRED, always. Never
 * let an email's claim close or open an incident on its own when a live
 * probe is available. Never classify by guessing: an unmatched event is
 * UNKNOWN, and UNKNOWN is a real, reported outcome.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname as dirnameOf, join } from "node:path";
import { resolveDependency, UNRESOLVED } from "./dependency-map";
import type { DependencyFacts } from "./dependency-map";
import { emitSystemEvent } from "./events";
import { runRecoveryCycle } from "./autonomous-recovery";
import { allResourceAvailability } from "./resource-availability";
import { currentWaiting } from "../work-continuation/contract";
import { saveEvidence, loadEvidenceForTask } from "../agent-gateway/contract";
import type { SystemEventType } from "./types";

const SOURCE_MARKER = "control/owner-backbone/event-intake.ts";

/** §1 — the input classes this system accepts. Closed, so a new class is a deliberate change. */
export type OperationalEventClass =
  | "EMAIL" | "RUNTIME" | "MACHINE" | "DEPLOYMENT" | "BUILD" | "API" | "DATABASE"
  | "SECURITY" | "CREDENTIAL" | "TOKEN" | "QUOTA" | "SUBSCRIPTION" | "BILLING"
  | "PAYMENT" | "FINANCE" | "NETWORK" | "DNS" | "HOSTING" | "PROVIDER";

/** §3 — what the event IS. `UNKNOWN` is a first-class outcome, not a failure. */
export type IncidentClass =
  | "SERVICE_DOWN" | "BUILD_FAILURE" | "DEPLOYMENT_FAILURE" | "SECURITY_ALERT"
  | "DATABASE_RISK" | "API_FAILURE" | "CREDENTIAL_FAILURE" | "TOKEN_EXHAUSTED"
  | "QUOTA_EXHAUSTED" | "SUBSCRIPTION_EXPIRING" | "SUBSCRIPTION_EXPIRED"
  | "PAYMENT_FAILED" | "PAYMENT_DUE" | "PRICE_CHANGED" | "COST_ANOMALY"
  | "RESOURCE_LIMIT" | "NETWORK_FAILURE" | "DEPENDENCY_FAILURE" | "UNKNOWN";

export type IntakeDecision =
  | "AUTOMATIC_RECOVERY"
  | "ALREADY_RESOLVED"
  | "WAITING_FOR_RESOURCE"
  | "OWNER_DECISION_REQUIRED"
  | "NO_REMEDIATION_AVAILABLE";

/** §9 — what the Owner is told, when telling them is useful at all. */
export type OwnerOutputState =
  | "AUTO_RECOVERED" | "RECOVERY_IN_PROGRESS" | "REPEATED_FAILURE"
  | "FINANCIAL_DECISION_REQUIRED" | "SECURITY_DECISION_REQUIRED"
  | "NO_REMEDIATION_AVAILABLE" | "NONE";

/**
 * DECISION 2 — ตัวตนที่เดินติดมากับ event
 *
 * ทุกฟิลด์เป็น optional โดยเจตนา: producer ที่พิสูจน์ค่าไหนไม่ได้ ต้อง **ไม่ส่ง**
 * ค่านั้นมา ไม่ใช่ส่งค่าแทน — ไม่มี "UNTRACKED" ในสัญญานี้ และจะไม่มี
 * `undefined`/`null` = UNKNOWN และ UNKNOWN เป็นคำตอบที่ถูกต้อง
 *
 * marker แบบข้อความเดิม (`dna-os:work=<id>;execution=<id>`) ยังอยู่ได้เพื่อความ
 * เข้ากันได้ย้อนหลัง แต่ไม่ใช่แหล่งตัวตนที่เชื่อถือได้อีกต่อไป — ค่าที่พิสูจน์แล้ว
 * ต้องถูกยกขึ้นมาเป็นฟิลด์ที่มีชนิดตรงนี้
 */
export interface OperationalEventIdentity {
  /** ตัวตนของ event ใบนี้ ผู้ผลิตเป็นผู้ออก — ละไว้ได้ ingress จะออกให้และบันทึกว่าออกเอง */
  readonly event_id?: string;
  readonly resource_id?: string | null;
  readonly capability_id?: string | null;
  readonly task_id?: string | null;
  readonly work_order_id?: string | null;
  readonly workspace_id?: string | null;
  readonly agent_run_id?: string | null;
  readonly provider_id?: string | null;
  readonly service_id?: string | null;
  readonly deployment_id?: string | null;
  readonly correlation_id?: string | null;
  readonly authorization_reference?: string | null;
  readonly evidence_refs?: readonly string[];
}

export interface RawOperationalEvent extends OperationalEventIdentity {
  readonly event_class: OperationalEventClass;
  readonly source: string;
  readonly provider: string;
  readonly subject: string;
  readonly body: string;
  readonly occurred_at: string;
  /** A re-checkable pointer back to the origin — a message id, an operation id, a run id. */
  readonly source_ref: string;
  /** Facts a producer already proved. Never a classification. */
  readonly facts?: Readonly<Record<string, string>>;
}

export interface Classification {
  readonly incident_class: IncidentClass;
  readonly provider: string;
  readonly service: string;
  readonly project_identity: string;
  readonly matched_on: string;
  readonly evidence: readonly string[];
}

/**
 * Ordered, closed rules. First match wins, and the rule that matched is
 * reported — so a classification can always be argued with.
 *
 * Deliberately matched against the SUBJECT and named facts rather than the
 * whole body: a body mentioning "payment" inside a footer is not a payment
 * failure, and this repo has been bitten by substring scans of prose before.
 */
const RULES: readonly { class: IncidentClass; test: RegExp; where: "subject" | "subject_or_body" }[] = [
  { class: "PAYMENT_FAILED", test: /non-?payment|payment (has )?failed|failed payment|past due|overdue|dunning|downgraded and all projects paused/i, where: "subject_or_body" },
  { class: "SUBSCRIPTION_EXPIRED", test: /subscription (has )?expired|plan (has )?expired|projects paused|has been downgraded/i, where: "subject" },
  { class: "SUBSCRIPTION_EXPIRING", test: /expir(es|ing) (soon|in \d+)|renew(s|al) (soon|on)/i, where: "subject" },
  { class: "PAYMENT_DUE", test: /invoice (is )?due|payment due|upcoming (invoice|charge)/i, where: "subject" },
  { class: "PRICE_CHANGED", test: /price (change|increase)|new pricing|pricing update/i, where: "subject" },
  { class: "TOKEN_EXHAUSTED", test: /token(s)? (exhausted|depleted)|out of (tokens|credits)|credit balance (is )?(zero|exhausted)/i, where: "subject_or_body" },
  { class: "QUOTA_EXHAUSTED", test: /quota (exceeded|exhausted)|rate limit exceeded|usage limit reached/i, where: "subject_or_body" },
  { class: "SECURITY_ALERT", test: /security (vulnerabilit|advisor|alert)|rls_disabled|publicly accessible|unauthorized access/i, where: "subject_or_body" },
  // ORDER MATTERS, and this order was decided by a live miss (2026-08-26):
  // "the CLAUDE worker reported authentication unavailable" was classified
  // SERVICE_DOWN, because SERVICE_DOWN's pattern matched the bare word
  // "unavailable" first. A credential failure is not an outage, and the two
  // have completely different authorized actions. Credential/token/quota
  // are therefore tested BEFORE the service patterns, and SERVICE_DOWN no
  // longer matches "unavailable" on its own.
  { class: "CREDENTIAL_FAILURE", test: /not logged in|authentication (failed|unavailable|required)|invalid (api )?key|credential(s)? (invalid|expired|missing)|\b401\b|unauthorized\b/i, where: "subject_or_body" },
  { class: "BUILD_FAILURE", test: /build failed|build failure/i, where: "subject" },
  { class: "DEPLOYMENT_FAILURE", test: /deploy(ment)? (failed|failure|crashed)/i, where: "subject" },
  { class: "SERVICE_DOWN", test: /service (is )?(down|unavailable)|is unavailable|econnrefused|health check failed|not serving|\b50[23]\b/i, where: "subject_or_body" },
  { class: "DATABASE_RISK", test: /database (at risk|corruption)|data loss|backup failed/i, where: "subject_or_body" },
  { class: "NETWORK_FAILURE", test: /network (failure|unreachable)|dns (failure|error)|certificate expired/i, where: "subject_or_body" },
  { class: "API_FAILURE", test: /api (error|failure)|5\d\d (error|response)/i, where: "subject_or_body" },
  { class: "COST_ANOMALY", test: /unusual (spend|usage)|cost (spike|anomaly)/i, where: "subject" },
  { class: "RESOURCE_LIMIT", test: /(disk|memory|storage) (full|limit)|out of space/i, where: "subject_or_body" },
];

/** Provider slugs this system holds real evidence about. An unmatched sender is UNRESOLVED, never a guess. */
const PROVIDER_PATTERNS: readonly { provider: string; test: RegExp }[] = [
  { provider: "railway", test: /railway/i },
  { provider: "supabase", test: /supabase/i },
  { provider: "github", test: /github/i },
  { provider: "vercel", test: /vercel/i },
  { provider: "cloudflare", test: /cloudflare/i },
  { provider: "anthropic", test: /anthropic|claude/i },
  { provider: "openai", test: /openai|codex/i },
  { provider: "google", test: /google|gemini/i },
  { provider: "kasikornbank", test: /kasikornbank|k ?biz|k ?plus/i },
];

export function classifyEvent(raw: RawOperationalEvent): Classification {
  const subject = raw.subject ?? "";
  const body = raw.body ?? "";
  const haystack = `${subject}\n${body}`;
  const evidence: string[] = [];

  const providerHit = PROVIDER_PATTERNS.find((p) => p.test.test(raw.provider) || p.test.test(raw.source) || p.test.test(subject));
  const provider = providerHit?.provider ?? (raw.provider !== "" ? raw.provider : UNRESOLVED);
  evidence.push(providerHit ? `provider matched /${providerHit.test.source}/` : `provider not matched against any known slug — kept as "${provider}"`);

  // Supabase names its project ref in the URL it links to; that is a real
  // identifier, extracted rather than inferred.
  const projectRef = haystack.match(/dashboard\/project\/([a-z0-9]{16,})/i)?.[1]
    ?? raw.facts?.project_identity
    ?? UNRESOLVED;

  for (const rule of RULES) {
    const target = rule.where === "subject" ? subject : haystack;
    if (rule.test.test(target)) {
      evidence.push(`matched ${rule.class} on ${rule.where} via /${rule.test.source}/`);
      return {
        incident_class: rule.class,
        provider,
        service: raw.facts?.service ?? UNRESOLVED,
        project_identity: projectRef,
        matched_on: rule.where,
        evidence,
      };
    }
  }

  evidence.push("no classification rule matched — this stays UNKNOWN and visible");
  return { incident_class: "UNKNOWN", provider, service: raw.facts?.service ?? UNRESOLVED, project_identity: projectRef, matched_on: "none", evidence };
}

export interface Impact {
  readonly what_stopped: string;
  readonly dependent_services: readonly string[];
  readonly affected_work_ids: readonly string[];
  readonly data_at_risk: boolean;
  readonly user_operation_affected: boolean;
  readonly money_involved: boolean;
  readonly detail: string;
}

const FINANCIAL_CLASSES = new Set<IncidentClass>(["PAYMENT_FAILED", "PAYMENT_DUE", "SUBSCRIPTION_EXPIRED", "SUBSCRIPTION_EXPIRING", "PRICE_CHANGED", "COST_ANOMALY", "TOKEN_EXHAUSTED", "QUOTA_EXHAUSTED"]);
const DATA_RISK_CLASSES = new Set<IncidentClass>(["SECURITY_ALERT", "DATABASE_RISK"]);

export function assessImpact(classification: Classification, dependency: DependencyFacts): Impact {
  const affected = dependency.dependents_work_ids;
  const money = FINANCIAL_CLASSES.has(classification.incident_class);
  const dataRisk = DATA_RISK_CLASSES.has(classification.incident_class);

  return {
    what_stopped: dependency.service_id !== UNRESOLVED
      ? `${dependency.service_id} (${dependency.used_for})`
      : classification.provider !== UNRESOLVED
        ? `something provided by ${classification.provider}`
        : UNRESOLVED,
    dependent_services: dependency.depends_on.filter((d) => d !== UNRESOLVED),
    affected_work_ids: affected,
    data_at_risk: dataRisk,
    // Only claimed when a real user-facing service is the subject. DNA OS's
    // own internal runtimes are not user operation.
    user_operation_affected: dependency.service_id !== UNRESOLVED && dependency.service_id !== "machine-observer" && dependency.service_id !== "recovery-supervisor",
    money_involved: money,
    detail: `${affected.length} work item(s) currently depend on this; ${dependency.unresolved_fields.length} dependency field(s) are UNRESOLVED`,
  };
}

export interface FinancialDecision {
  readonly what_needs_payment: string;
  readonly why: string;
  readonly amount: string;
  readonly currency: string;
  readonly provider: string;
  readonly system_depends_on: readonly string[];
  readonly if_not_approved: string;
  readonly alternatives: readonly string[];
  readonly evidence: readonly string[];
}

export interface Decision {
  readonly decision: IntakeDecision;
  readonly action: string | null;
  readonly executor: string | null;
  readonly owner_output: OwnerOutputState;
  readonly financial: FinancialDecision | null;
  readonly missing_capability: string | null;
  readonly reason: string;
}

/**
 * §5/§6 — a policy lookup, not a judgement. Every branch names the EXISTING
 * capability that would carry it out, or names what is missing.
 *
 * `liveEvidence` is the current, independently observed state of the thing
 * the event is about. When it is present it OUTRANKS the event: this is what
 * stops a two-week-old provider email from waking the Owner about a service
 * that is answering right now.
 */
export function decideAction(input: {
  readonly classification: Classification;
  readonly dependency: DependencyFacts;
  readonly impact: Impact;
  readonly liveEvidence: { readonly checked: boolean; readonly healthy: boolean; readonly detail: string };
}): Decision {
  const { classification, dependency, impact, liveEvidence } = input;
  const cls = classification.incident_class;

  // A live probe that contradicts the claim ends it here, for every class.
  if (liveEvidence.checked && liveEvidence.healthy) {
    return {
      decision: "ALREADY_RESOLVED", action: null, executor: null, owner_output: "NONE", financial: null, missing_capability: null,
      reason: `the claim is not true now: ${liveEvidence.detail}. Live evidence outranks the report, so no action and no Owner message.`,
    };
  }

  if (cls === "SERVICE_DOWN" && dependency.remediation_actions.includes("RESTART_EXISTING_SERVICE")) {
    return {
      decision: "AUTOMATIC_RECOVERY", action: "RESTART_EXISTING_SERVICE",
      executor: "control/owner-backbone/autonomous-recovery.ts#runRecoveryCycle",
      owner_output: "RECOVERY_IN_PROGRESS", financial: null, missing_capability: null,
      reason: `${dependency.service_id} is declared under the launchd authority and an authorized restart exists`,
    };
  }

  if (cls === "TOKEN_EXHAUSTED" || cls === "QUOTA_EXHAUSTED" || cls === "CREDENTIAL_FAILURE") {
    // §6 — an ALREADY-PAID, already-authorized alternative is a failover, not
    // a purchase. Only when none remains does money enter the conversation.
    const alternatives = allResourceAvailability().filter((r) => r.available);
    if (alternatives.length > 0) {
      return {
        decision: "AUTOMATIC_RECOVERY", action: "FAILOVER_TO_AUTHORIZED_RESOURCE",
        executor: "control/owner-backbone/gateway.ts#dispatchCommand (failover) + resource-availability.ts",
        owner_output: "RECOVERY_IN_PROGRESS", financial: null, missing_capability: null,
        reason: `${alternatives.map((a) => a.worker_kind).join(", ")} remain authorized and available — failing over costs nothing new`,
      };
    }
    if (cls === "CREDENTIAL_FAILURE") {
      return {
        decision: "WAITING_FOR_RESOURCE", action: null,
        executor: "control/owner-backbone/resource-availability.ts",
        owner_output: "NONE", financial: null, missing_capability: null,
        reason: "no authorized resource is available; the work is parked and resumes by itself when the credential evidence changes — no Owner message is needed to wait",
      };
    }
    return {
      decision: "OWNER_DECISION_REQUIRED", action: null, executor: null, owner_output: "FINANCIAL_DECISION_REQUIRED",
      missing_capability: null,
      financial: {
        what_needs_payment: `${classification.provider} capacity (${cls})`,
        why: "every authorized execution resource is exhausted and no already-paid alternative remains",
        amount: UNRESOLVED, currency: UNRESOLVED, provider: classification.provider,
        system_depends_on: impact.affected_work_ids,
        if_not_approved: `${impact.affected_work_ids.length} work item(s) stay parked; nothing else is affected`,
        alternatives: allResourceAvailability().map((r) => `${r.worker_kind}: ${r.reason}`),
        evidence: ["control/owner-backbone/resource-availability.ts (deterministic, nothing was launched)"],
      },
      reason: "restoring capacity needs new money; software stops here",
    };
  }

  if (FINANCIAL_CLASSES.has(cls)) {
    return {
      decision: "OWNER_DECISION_REQUIRED", action: null, executor: null, owner_output: "FINANCIAL_DECISION_REQUIRED",
      missing_capability: null,
      financial: {
        what_needs_payment: `${classification.provider}${classification.project_identity !== UNRESOLVED ? ` project ${classification.project_identity}` : ""}`,
        why: `${cls} — reported by ${classification.provider} and NOT contradicted by live evidence (${liveEvidence.checked ? liveEvidence.detail : "no live probe was possible"})`,
        // Not parsed out of prose. An amount this system did not measure is
        // UNRESOLVED; presenting a number scraped from an email as fact is
        // exactly the error this repo refuses.
        amount: UNRESOLVED, currency: UNRESOLVED, provider: classification.provider,
        system_depends_on: impact.affected_work_ids.length > 0 ? impact.affected_work_ids : [dependency.capability_id],
        if_not_approved: dependency.service_id !== UNRESOLVED
          ? `${dependency.service_id} stops`
          : `whatever depends on ${classification.provider} stops; DNA OS cannot enumerate that today (dependency fields UNRESOLVED: ${dependency.unresolved_fields.join(", ")})`,
        alternatives: [UNRESOLVED],
        evidence: [`source:${classification.provider}`, ...classification.evidence],
      },
      reason: "a new financial commitment is an Owner decision; DNA OS never purchases",
    };
  }

  if (cls === "SECURITY_ALERT" || cls === "DATABASE_RISK") {
    return {
      decision: "OWNER_DECISION_REQUIRED", action: null, executor: null, owner_output: "SECURITY_DECISION_REQUIRED",
      financial: null,
      missing_capability: `a registered capability that can READ ${classification.provider} security advisors and APPLY a fix (none exists; DNA OS holds only a ${dependency.credential_status === UNRESOLVED ? "no" : dependency.credential_status.toLowerCase()} credential reference for ${classification.provider})`,
      reason: "a security posture change is not an ordinary operational recovery, and no authorized remediation capability exists for it",
    };
  }

  if (cls === "BUILD_FAILURE" || cls === "DEPLOYMENT_FAILURE") {
    const alternatives = allResourceAvailability().filter((r) => r.available);
    if (alternatives.length === 0) {
      return {
        decision: "WAITING_FOR_RESOURCE", action: "REPAIR_THROUGH_RESOLVED_WORK_PACKET",
        executor: "control/incident-remediation/#openRemediation",
        owner_output: "NONE", financial: null, missing_capability: null,
        reason: "repairing code needs a reasoning resource and none is currently available; the incident is recorded and waits rather than asking the Owner to do anything",
      };
    }
    return {
      decision: "AUTOMATIC_RECOVERY", action: "REPAIR_THROUGH_RESOLVED_WORK_PACKET",
      executor: "control/incident-remediation/#openRemediation -> dispatchRemediation",
      owner_output: "RECOVERY_IN_PROGRESS", financial: null, missing_capability: null,
      reason: `${alternatives.map((a) => a.worker_kind).join(", ")} is available to carry a resolved work packet`,
    };
  }

  return {
    decision: "NO_REMEDIATION_AVAILABLE", action: null, executor: null,
    owner_output: cls === "UNKNOWN" ? "NO_REMEDIATION_AVAILABLE" : "NO_REMEDIATION_AVAILABLE",
    financial: null,
    missing_capability: cls === "UNKNOWN"
      ? "no classification rule matched this event; a rule for it does not exist yet"
      : `no authorized remediation is registered for ${cls}`,
    reason: cls === "UNKNOWN"
      ? "UNKNOWN is reported, persisted and counted — never discarded and never guessed at"
      : `${cls} has no registered authorized action`,
  };
}

/**
 * DECISION 4 — ผลการจัดเส้นทางที่อ่านด้วยเครื่องได้
 *
 * `Decision.executor` เดิมเป็นสตริงบรรยาย ซึ่งไม่พอจะเป็นอำนาจสั่งงาน ที่นี่จึง
 * แยกออกเป็น `target_owner` (โฟลเดอร์ capability ที่รับผิดชอบจริง) กับ
 * `target_capability_or_executor` (สัญลักษณ์ที่ต้องถูกเรียก) โดยแปลจาก
 * ตารางปิดด้านล่าง ไม่ได้ parse ข้อความอิสระ
 *
 * เจ้าของยังเป็น routing owner เดิม ไม่ได้ตั้ง capability ใหม่
 */
export interface RouteResult {
  readonly route_id: string;
  readonly input_event_id: string;
  /** โฟลเดอร์ capability ที่เป็นเจ้าของการลงมือ — null เมื่อไม่มี action */
  readonly target_owner: string | null;
  /** สัญลักษณ์ที่ต้องถูกเรียกจริง — null เมื่อไม่มี action */
  readonly target_capability_or_executor: string | null;
  readonly action: string | null;
  readonly policy_result: IntakeDecision;
  readonly reason_code: string;
  readonly evidence_refs: readonly string[];
  /** ตัวตนที่เดินติดมาจาก event — ค่าที่ไม่รู้จะไม่ปรากฏ ไม่ใช่ถูกเติม */
  readonly identity: OperationalEventIdentity;
  readonly decided_at: string;
}

/**
 * ตารางปิดจาก action -> เจ้าของจริง
 *
 * ทุกแถวชี้ไปยัง symbol ที่มีอยู่จริงและตรวจได้ ไม่ใช่ชื่อที่เดา การเพิ่ม action
 * ใหม่โดยไม่เพิ่มแถวที่นี่จะได้ target เป็น null ซึ่งแปลว่า "ยังไม่มีผู้รับ"
 * ไม่ใช่ "ส่งไปที่ไหนก็ได้"
 */
export const ACTION_TARGETS: Readonly<Record<string, { owner: string; symbol: string }>> = {
  RESTART_EXISTING_SERVICE: { owner: "control/owner-backbone", symbol: "autonomous-recovery.ts#runRecoveryCycle" },
  FAILOVER_TO_AUTHORIZED_RESOURCE: { owner: "control/owner-backbone", symbol: "resource-availability.ts#allResourceAvailability + gateway.ts#dispatchCommand" },
  REPAIR_THROUGH_RESOLVED_WORK_PACKET: { owner: "control/agent-gateway", symbol: "gateway.ts#submitTask" },
};

/**
 * แปลง Decision ที่ decideAction ตัดสินแล้ว ให้เป็นผลที่ dispatcher อ่านได้
 * ฟังก์ชันบริสุทธิ์ ไม่ตัดสินใจอะไรใหม่ — มันแค่ทำให้ผลเดิมมีตัวตนและชี้เจ้าของได้
 */
export function buildRouteResult(input: {
  readonly route_id: string;
  readonly input_event_id: string;
  readonly decision: Decision;
  readonly identity: OperationalEventIdentity;
  readonly evidence_refs: readonly string[];
}): RouteResult {
  const target = input.decision.action ? ACTION_TARGETS[input.decision.action] ?? null : null;
  return {
    route_id: input.route_id,
    input_event_id: input.input_event_id,
    target_owner: target?.owner ?? null,
    target_capability_or_executor: target?.symbol ?? null,
    action: input.decision.action,
    policy_result: input.decision.decision,
    reason_code: input.decision.action && !target
      ? "NO_REGISTERED_TARGET_FOR_ACTION"
      : input.decision.action
        ? "ROUTED"
        : `NO_ACTION:${input.decision.decision}`,
    evidence_refs: input.evidence_refs,
    identity: input.identity,
    decided_at: new Date().toISOString(),
  };
}

/**
 * บันทึกผลการจัดเส้นทางแบบ append-only ที่โฟลเดอร์ของ routing owner เอง
 * (แบบแผนเดียวกับ control/scheduler/data/ และ control/agent-gateway/data/)
 *
 * เก็บลงดิสก์เพราะผู้บริโภคปลายทาง — dispatcher, การตรวจย้อน, และการพิสูจน์
 * ว่า event ใบไหนถูกส่งไปที่ใคร — ต้องอ่านได้หลัง restart
 */
function routeResultFile(): string {
  return process.env.OWNER_BACKBONE_ROUTE_LOG
    ?? join(__dirname, "..", "..", "control/owner-backbone/data/route-results.jsonl");
}

export function saveRouteResult(route: RouteResult): RouteResult {
  const p = routeResultFile();
  mkdirSync(dirnameOf(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(route)}\n`, "utf-8");
  return route;
}

export function listRouteResults(): readonly RouteResult[] {
  const p = routeResultFile();
  if (!existsSync(p)) return [];
  const rows: RouteResult[] = [];
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as RouteResult); } catch { /* แถวเสียข้ามไป ไม่ลบ */ }
  }
  return rows;
}

export function routeResultsForEvent(eventId: string): readonly RouteResult[] {
  return listRouteResults().filter((r) => r.input_event_id === eventId);
}

export interface IntakeRecord {
  readonly intake_id: string;
  readonly received_at: string;
  readonly raw: RawOperationalEvent;
  readonly classification: Classification;
  readonly dependency: DependencyFacts;
  readonly impact: Impact;
  readonly live_evidence: { readonly checked: boolean; readonly healthy: boolean; readonly detail: string };
  readonly decision: Decision;
  readonly acted: boolean;
  readonly action_result: string | null;
  readonly verified: boolean | null;
  readonly next_event: string | null;
  readonly final_state: string;
  readonly event_ids: readonly string[];
  /** DECISION 4 — ผลการจัดเส้นทางที่ dispatcher อ่านได้ (additive) */
  readonly route: RouteResult;
}

const EVENT_TYPE_FOR: Partial<Record<IncidentClass, SystemEventType>> = {
  SERVICE_DOWN: "SERVICE_UNHEALTHY",
  BUILD_FAILURE: "VERIFICATION_FAILED",
  DEPLOYMENT_FAILURE: "DEPLOY_FAILED",
  SECURITY_ALERT: "INCIDENT_CREATED",
  DATABASE_RISK: "INCIDENT_CREATED",
  TOKEN_EXHAUSTED: "RESOURCE_UNAVAILABLE",
  QUOTA_EXHAUSTED: "RESOURCE_UNAVAILABLE",
  CREDENTIAL_FAILURE: "RESOURCE_UNAVAILABLE",
};

/**
 * The whole path, for one event. Everything it does is either a read, an
 * emit, or a hand-off to an existing executor.
 */
export async function intakeEvent(
  raw: RawOperationalEvent,
  options: { readonly liveProbe?: () => Promise<{ checked: boolean; healthy: boolean; detail: string }> } = {},
): Promise<IntakeRecord> {
  const intakeId = `intake-${randomUUID()}`;
  // ผู้ผลิตออก event_id เองได้ ถ้าไม่ออก ingress ออกให้ — ไม่ใช่การเดา แต่เป็นการ
  // ประกาศว่า "ใบนี้ถูกรับเข้าเมื่อไหร่ในนามของอะไร" และบันทึกไว้ใน route result
  const eventId = raw.event_id ?? `evt-${randomUUID()}`;
  const receivedAt = new Date().toISOString();
  const eventIds: string[] = [];

  // [1] IDENTIFY
  const classification = classifyEvent(raw);

  // [2] RESOLVE DEPENDENCIES
  const dependency = resolveDependency({
    provider: classification.provider,
    service_id: classification.service !== UNRESOLVED ? classification.service : raw.facts?.service_id,
    project_identity: classification.project_identity,
  });

  // [3] IMPACT
  const impact = assessImpact(classification, dependency);

  // [4] LIVE EVIDENCE — the claim is checked against the machine wherever a
  //     probe exists. No probe is an honest "unverifiable", never a pass.
  const liveEvidence = options.liveProbe
    ? await options.liveProbe()
    : { checked: false, healthy: false, detail: "no live probe was available for this event" };

  // [5] DECIDE
  const decision = decideAction({ classification, dependency, impact, liveEvidence });

  const first = await emitSystemEvent({
    command_id: null, work_id: null, incident_id: intakeId,
    event_type: EVENT_TYPE_FOR[classification.incident_class] ?? "INCIDENT_CREATED",
    state: classification.incident_class,
    source: SOURCE_MARKER,
    resource_ids: [classification.provider, dependency.service_id].filter((r) => r !== UNRESOLVED),
    capability_ids: [dependency.capability_id].filter((c) => c !== UNRESOLVED),
    evidence_refs: [raw.source_ref, ...classification.evidence.slice(0, 2)],
    next_action: `${decision.decision}: ${decision.reason.slice(0, 140)}`,
  });
  eventIds.push(first.event.event_id);

  // [6] ACT — only ever by handing off to an executor that already exists.
  let acted = false;
  let actionResult: string | null = null;
  let verified: boolean | null = null;
  let nextEvent: string | null = null;

  if (decision.decision === "AUTOMATIC_RECOVERY" && decision.action === "RESTART_EXISTING_SERVICE" && dependency.service_id !== UNRESOLVED) {
    const cycle = await runRecoveryCycle(dependency.service_id);
    // A cycle that found no fault performed no recovery. Reporting that as
    // AUTO_RECOVERED would claim credit for a machine that was already fine
    // — the same overstatement this repo refuses everywhere else.
    acted = cycle.fault_detected;
    actionResult = cycle.fault_detected
      ? `${cycle.execution_result}; ${cycle.initial_condition} -> ${cycle.final_condition}`
      : `NO_FAULT_FOUND: the service was already ${cycle.final_condition} when the executor looked`;
    verified = cycle.fault_detected ? cycle.fault_cleared : null;
    nextEvent = cycle.fault_detected ? (cycle.fault_cleared ? "SERVICE_HEALTHY" : "REMEDIATION_FAILED") : "ALREADY_HEALTHY";
    eventIds.push(...cycle.events.map((e) => e.event_id));
  }

  if (decision.decision === "OWNER_DECISION_REQUIRED") {
    const owner = await emitSystemEvent({
      command_id: null, work_id: null, incident_id: intakeId,
      event_type: "OWNER_DECISION_REQUIRED", state: decision.owner_output,
      source: SOURCE_MARKER, resource_ids: [classification.provider], capability_ids: [],
      evidence_refs: [raw.source_ref],
      next_action: decision.financial
        ? `${decision.financial.what_needs_payment}: ${decision.financial.why.slice(0, 120)}`
        : decision.missing_capability ?? decision.reason,
    });
    eventIds.push(owner.event.event_id);
    nextEvent = "OWNER_DECISION_REQUIRED";
  }

  const finalState = acted
    ? (verified === true ? "AUTO_RECOVERED" : "REMEDIATION_FAILED")
    : nextEvent === "ALREADY_HEALTHY" ? "ALREADY_HEALTHY" : decision.decision;

  markIntaken(raw.source_ref, intakeId, classification.incident_class, decision.decision);

  /**
   * DECISION 2 — ตัวตนที่พิสูจน์ได้เท่านั้นที่เดินต่อ
   *
   * ค่าที่ producer ส่งมาถูกเก็บไว้ตามเดิม ส่วน provider/service ที่ classifier
   * "พิสูจน์" ได้จริงจะถูกยกขึ้นมาเป็นฟิลด์ที่มีชนิด แต่เฉพาะเมื่อมันไม่ใช่ UNRESOLVED
   * — ค่า UNRESOLVED ไม่ถูกเขียนลงไปเป็นตัวตน เพราะนั่นคือการอ้างว่ารู้ทั้งที่ไม่รู้
   */
  const identity: OperationalEventIdentity = {
    event_id: eventId,
    resource_id: raw.resource_id ?? null,
    capability_id: raw.capability_id ?? (dependency.capability_id !== UNRESOLVED ? dependency.capability_id : null),
    task_id: raw.task_id ?? null,
    work_order_id: raw.work_order_id ?? null,
    workspace_id: raw.workspace_id ?? null,
    agent_run_id: raw.agent_run_id ?? null,
    provider_id: raw.provider_id ?? (classification.provider !== UNRESOLVED ? classification.provider : null),
    service_id: raw.service_id ?? (dependency.service_id !== UNRESOLVED ? dependency.service_id : null),
    deployment_id: raw.deployment_id ?? null,
    correlation_id: raw.correlation_id ?? null,
    authorization_reference: raw.authorization_reference ?? null,
    evidence_refs: raw.evidence_refs ?? [],
  };

  const route = buildRouteResult({
    route_id: `route-${randomUUID()}`,
    input_event_id: eventId,
    decision,
    identity,
    evidence_refs: [raw.source_ref, ...classification.evidence.slice(0, 2), ...eventIds.slice(0, 2)],
  });
  saveRouteResult(route);

  return {
    intake_id: intakeId, received_at: receivedAt, raw, classification, dependency, impact,
    live_evidence: liveEvidence, decision, acted, action_result: actionResult, verified,
    next_event: nextEvent, final_state: finalState, event_ids: eventIds, route,
  };
}

/**
 * An event that has already been through intake must not be processed again
 * — a provider re-sending the same alert, or a supervisor tick re-reading
 * the same inbox, is a replay. Keyed by the ORIGIN's own id (a message id,
 * an operation id), so it is stable across process restarts.
 */
export function alreadyIntaken(sourceRef: string): boolean {
  return loadEvidenceForTask(`intake-source:${sourceRef}`).some((r) => r.source === SOURCE_MARKER);
}

function markIntaken(sourceRef: string, intakeId: string, incidentClass: IncidentClass, decision: IntakeDecision): void {
  saveEvidence({
    evidence_id: `intake-seen-${intakeId}`,
    task_id: `intake-source:${sourceRef}`,
    kind: "execution_output",
    source: SOURCE_MARKER,
    recorded_at: new Date().toISOString(),
    payload: { source_ref: sourceRef, intake_id: intakeId, incident_class: incidentClass, decision },
  });
}

/**
 * §7 — provider email as an INPUT. Reuses the authenticated reader that is
 * already registered and already proven; this adds no mail client, no OAuth
 * and no second inbox path.
 */
export async function intakeProviderEmails(query: string, limit = 5): Promise<readonly IntakeRecord[]> {
  const { invokeProviderAlertEmailRead } = await import("../../connections/email-alert-source/authenticated-invoke");
  const read = await invokeProviderAlertEmailRead(query);
  if (!read.caller_authenticated || read.result?.ok !== true) return [];

  const records: IntakeRecord[] = [];
  for (const email of (read.result.emails ?? []).slice(0, limit)) {
    const sourceRef = `gmail:${String(email.message_id ?? UNRESOLVED)}`;
    // A re-read inbox must not re-open incidents that were already decided.
    if (alreadyIntaken(sourceRef)) continue;
    records.push(await intakeEvent({
      event_class: "EMAIL",
      source: String(email.sender ?? UNRESOLVED),
      provider: String(email.sender ?? UNRESOLVED),
      subject: String(email.subject ?? ""),
      body: String(email.body ?? ""),
      occurred_at: String(email.received_at ?? new Date().toISOString()),
      source_ref: sourceRef,
    }));
  }
  return records;
}

/** Work parked right now, by what it is parked on. Used by the report, not by any decision. */
export function parkedWorkSummary(): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const row of currentWaiting()) {
    if (row.status !== "WAITING" && row.status !== "WAITING_FOR_RESOURCE") continue;
    for (const key of row.blocked_on) out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
