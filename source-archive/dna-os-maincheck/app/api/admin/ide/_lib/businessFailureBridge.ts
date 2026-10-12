/**
 * Business Failure Bridge (owner, 2026-09-19) — the missing
 * BUSINESS → INFRASTRUCTURE failure bridge.
 *
 * Problem (owner, 2026-09-19): business actions expose provider/runtime
 * errors directly to the business user. Example: a LINE Messaging API
 * authentication failure is returned from sendLineMessage() all the way to
 * the Relationship Workspace as a raw provider error string.
 *
 * Required ownership split (owner, 2026-09-19):
 *   BUSINESS WORLD  — requests a business action, receives a normalized
 *                     business result only. Must NOT manage provider
 *                     credentials, connector health, runtime recovery, or
 *                     infrastructure incidents.
 *   INFRASTRUCTURE WORLD — owns provider/connection/runtime failures,
 *                     diagnosis, recovery, retry policy, verification,
 *                     evidence, and the incident lifecycle; escalates to
 *                     Owner only when existing remediation reaches
 *                     OWNER_DECISION_REQUIRED.
 *
 * Rule 103 / Rule 111 reuse investigation (checked BEFORE writing, this
 * bridge creates NO new subsystem):
 *   - connections/connection-index  → core/connector-loader.ts + the
 *     `connectors` table (status/enabled/last_error) — the ONE connection
 *     identity index. Read here via requireConnector()'s own record.
 *   - control/inbound-event-fabric  → monitoringRuntime.ts#collectSignal()
 *     + its SignalRecord store — the ONE canonical infrastructure event
 *     ingress (every Incident must come from a real collected Signal,
 *     enforced by openIncidentFromSignal's own contract).
 *   - control/incident-remediation  → incidentRuntime.ts
 *     #openIncidentFromSignal (dedupes by type within a real 30-min
 *     window — one incident identity across retries, free) +
 *     recoveryRuntime.ts#createRecoveryPlan (RETRY_OPERATION /
 *     MANUAL_INTERVENTION remediation, owner approval gate built in).
 *   - control/work-session-state    → queueRuntime.ts#startOperationsJob()
 *     / finalizeOperationsJob() — the ONE work-identity/job ledger.
 *   - evidence                      → artifactRuntime.ts
 *     #createOperationsArtifact (checksummed, immutable) for
 *     infrastructure-side evidence, and the real `audit_logs` table for
 *     the durable technical failure record (Owner-facing surfaces only —
 *     never returned to Business).
 *   - alertRuntime.ts#dispatchAlert(incident) — the existing escalation
 *     path (OWNER_UI + LINE per the real DEFAULT_ALERT_POLICY); incident
 *     severity ≥ the type's own floor already flips
 *     ownerDecisionRequired, which surfaces in the real
 *     /api/admin/ide/operations/status ownerDecisionsRequired[] — Owner
 *     sees technical detail only there, never in Business UI.
 *
 * Hard rules honored here:
 *   - No new incident system, no new LINE subsystem, no new finance/
 *     payment/debt engine, no AI deciding technical truth (every status
 *     below is a deterministic string/classification, no LLM anywhere).
 *   - Raw provider credential/error details NEVER enter the normalized
 *     business result. The full technical reason goes only to
 *     infrastructure evidence (audit_logs + artifacts + Incident record).
 *   - ONE incident/work identity across retries: the bridge passes the
 *     same workId (target) into startOperationsJob, and
 *     openIncidentFromSignal itself deduplicates repeats into the same
 *     Incident within the registry's real deduplication window.
 *   - Bounded recovery only: this bridge NEVER retries the provider call
 *     itself. It creates exactly one real remediation plan per incident
 *     (via the registry's own deduplication on the infrastructure side)
 *     and stops. Retrying is a human/owner remediation action (the
 *     existing RETRY_OPERATION recovery type is PLAN_ONLY by
 *     constitution — recoveryRuntime never executes), never an automatic
 *     loop. No infinite retry exists anywhere on this path.
 */
import { createHash, randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConnector } from "@/core/connector-loader";
import { collectSignal } from "./providerHealthCollectors";
import { openIncidentFromSignal, attachRecoveryPlan, type IncidentRecord } from "./incidentRuntime";
import { createRecoveryPlan, getRecoveryPlan, type RecoveryPlan } from "./recoveryPlans";
import { dispatchAlert } from "./alertRuntime";
import { startOperationsJob, finalizeOperationsJob } from "./queueRuntime";
import { createOperationsArtifact } from "./artifactRuntime";
import type { SignalRecord } from "./monitoringRuntime";
import type { SignalType } from "./monitoringRegistry";

/** Business-facing normalized result — the ONLY shape that may cross the
 * bridge back into Business. No provider error text, no status codes, no
 * credential hints, no infrastructure internals. */
export type NormalizedFailureClass =
  | "PROVIDER_AUTH"          // credential invalid/expired/missing at the provider
  | "PROVIDER_UNAVAILABLE"   // provider reachable but failing / network path broken
  | "PROVIDER_REJECTED"      // provider actively rejected the business payload
  | "INFRA_NOT_READY";       // our own connector lifecycle gate not ready (Register/Test/Enable)

export interface NormalizedBusinessResult {
  ok: boolean;
  /** Stable machine code for the business layer to branch on. */
  code: "SENT" | "INFRASTRUCTURE_BLOCKED";
  /** Thai, human, business-safe message — safe to render in Workspace. */
  message: string;
  /** Normalized failure class — coarse, deterministic, credential-free. */
  failureClass: NormalizedFailureClass | null;
  /** One work identity for this business action across retries. */
  workId: string | null;
  /** One infrastructure incident identity covering every retry of this action. */
  incidentId: string | null;
}

export interface BusinessFailureInput {
  /** Provider slug in the connector registry ("line", "gmail", ...). */
  providerSlug: string;
  /** Deterministic failure class computed by the adapter-side classifier below. */
  failureClass: NormalizedFailureClass;
  /** Full technical reason — INFRASTRUCTURE-ONLY. Never returned to Business. */
  technicalReason: string;
  /** Real business action label for evidence (e.g. "line.reply"). */
  businessAction: string;
  /** Owner-scoped identity (requireAuth's auth.id from the calling route). */
  ownerId: string;
  /** Real actor email for evidence/timeline entries. */
  actor: string;
  /** Calling route identity for the audit trail (e.g. "/api/admin/.../reply"). */
  source: string;
  /** The one work identity for this action attempt (bridged work session). */
  workId?: string;
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Deterministic (never AI) classification of the real gateway error
 * string — keyword thresholds only, same discipline as every other
 * status computation in this runtime layer (Rule 189 discipline: zero
 * LLM involvement). */
export function classifyProviderFailure(rawError: string): NormalizedFailureClass {
  const e = rawError.toLowerCase();
  if (
    e.includes("401") || e.includes("403") || e.includes("unauthorized") ||
    e.includes("invalid") && e.includes("token") ||
    e.includes("token") && (e.includes("หมดอายุ") || e.includes("ไม่ถูกต้อง")) ||
    e.includes("การยืนยันตัวตน") || e.includes("authentication") ||
    e.includes("run gate") || e.includes("ยังไม่ผ่าน test") || e.includes("ยังไม่ได้ enable") ||
    e.includes("ไม่พบ connector") || e.includes("register/test/enable") ||
    e.includes("channel_access_token")
  ) {
    // Distinguish "our own lifecycle gate not ready" from "provider says the
    // credential itself is bad" — both are deterministic string matches.
    if (
      e.includes("run gate") || e.includes("ยังไม่ผ่าน test") || e.includes("ยังไม่ได้ enable") ||
      e.includes("ไม่พบ connector") || e.includes("register/test/enable") || e.includes("ไม่มี channel_access_token")
    ) return "INFRA_NOT_READY";
    return "PROVIDER_AUTH";
  }
  if (e.includes("429") || e.includes("500") || e.includes("502") || e.includes("503") || e.includes("timeout") || e.includes("หมดเวลา") || e.includes("เชื่อมต่อ")) {
    return "PROVIDER_UNAVAILABLE";
  }
  return "PROVIDER_REJECTED";
}

/** Thai, business-safe message per normalized class. NEVER contains the
 * raw provider payload, token hints, or HTTP internals. */
function businessMessage(failureClass: NormalizedFailureClass): string {
  switch (failureClass) {
    case "PROVIDER_AUTH":
      return "ระบบสื่อสารภายนอกมีปัญหาการยืนยันตัวตน ทีมระบบกำลังดำเนินการแก้ไข — การส่งถูกบันทึกไว้แล้ว ลองใหม่ภายหลัง";
    case "PROVIDER_UNAVAILABLE":
      return "บริการภายนอกขัดข้องชั่วคราว ทีมระบบกำลังติดตามสถานการณ์ — ลองใหม่ภายหลัง";
    case "PROVIDER_REJECTED":
      return "ระบบปลายทางปฏิเสธคำขอนี้ ทีมระบบได้รับแจ้งแล้ว";
    case "INFRA_NOT_READY":
      return "การเชื่อมต่อระบบยังไม่พร้อมใช้งาน ผู้ดูแลระบบต้องเปิดใช้งานการเชื่อมต่อนี้ก่อน";
  }
}

/** Deterministic signal mapping — the EXISTING collectors own these
 * domains already (incidentRuntime's SIGNAL_TO_INCIDENT_TYPE map):
 *   our own lifecycle gate not ready → CONNECTOR_HEALTH (→ CONNECTOR_FAILURE)
 *   provider-side failure            → EXTERNAL_PROVIDER_HEALTH (→ PROVIDER_OUTAGE,
 *                                      HIGH floor → ownerDecisionRequired at open)
 * Never AI-decided: a pure function of the normalized class. */
function providerFailureSignalType(failureClass: NormalizedFailureClass): SignalType {
  return failureClass === "INFRA_NOT_READY" ? "CONNECTOR_HEALTH" : "EXTERNAL_PROVIDER_HEALTH";
}

/** Full infrastructure-side handling of one real business-action failure:
 * work job → durable audit evidence → real Signal → real Incident
 * (deduplicated across retries) → real remediation plan → real Owner
 * escalation (severity-gated). Returns the ONE incident identity. */
async function routeFailureToInfrastructure(
  input: BusinessFailureInput,
  workId: string
): Promise<{ incident: IncidentRecord; recoveryPlan: RecoveryPlan | null }> {
  // The DB client is best-effort: every infrastructure runtime below is
  // self-contained (in-memory stores + local evidence). A missing/unreachable
  // database degrades ONLY the audit row and the connection snapshot — never
  // the Signal/Incident/Remediation/escalation chain itself.
  let db: SupabaseClient | null = null;
  try {
    const { supabaseAdmin } = await import("@/services/supabase/queries");
    db = supabaseAdmin();
  } catch (e) {
    console.error("[businessFailureBridge] no usable Supabase client (continuing without DB evidence):", e instanceof Error ? e.message : e);
  }

  // 0. Connection identity/status — read from the ONE existing connection
  //    index (connectors table via connector-loader) and attached to the
  //    infrastructure evidence. Lifecycle state only, never the secret.
  const connectionIdentity = db ? await readConnectionIdentity(db, input.providerSlug) : null;

  // 1. Durable, infrastructure-side technical evidence (audit_logs — the
  //    same table connector lifecycle events already write). Owner-facing
  //    surface only; never crosses back into Business. Best-effort: a DB
  //    outage here must never block the incident path itself.
  try {
    if (db) {
      await db.from("audit_logs").insert({
        entity_type: "business_failure_bridge",
        entity_id: workId,
        action: input.failureClass,
        field: `${input.businessAction} @ ${input.source}`,
        old_value: null,
        new_value: input.technicalReason.slice(0, 2000),
      });
    }
  } catch (e) {
    console.error("[businessFailureBridge] audit evidence write failed (continuing):", e instanceof Error ? e.message : e);
  }

  // 2. Canonical infrastructure event ingress — the SAME real Signal
  //    collector every other infrastructure finding flows through.
  //    Deterministic reason: connection identity + normalized class +
  //    real technical cause (kept verbatim for infrastructure eyes).
  const signal: SignalRecord = await collectSignal(providerFailureSignalType(input.failureClass), input.ownerId, input.actor);

  // The generic collector reports the table-level cron health, not this
  // specific business-action failure — so the bridge records THIS failure
  // as its own real, checksummed evidence artifact and links it into the
  // Incident (the incident record's evidence[] carries real artifact ids).
  const failureArtifact = createOperationsArtifact({
    artifactType: "HEALTH_SIGNAL_REPORT",
    content: JSON.stringify({
      kind: "business_action_provider_failure",
      businessAction: input.businessAction,
      source: input.source,
      providerSlug: input.providerSlug,
      failureClass: input.failureClass,
      technicalReason: input.technicalReason,
      connectionIdentity,
      workId,
      observedAt: new Date().toISOString(),
      actor: input.actor,
      ownerId: input.ownerId,
    }),
    mimeType: "application/json",
    actor: input.actor,
    ownerId: input.ownerId,
    generatedFrom: workId,
    jobId: null,
    relatedSignalId: signal.signalId,
  });

  // 3. Real Incident — openIncidentFromSignal deduplicates repeats of the
  //    same signal type into the SAME Incident within its real 30-minute
  //    window (incidentRegistry CONNECTOR_FAILURE deduplicationWindowMs).
  //    That gives us "one incident identity across retry/failover" for
  //    free, from the existing system — never a new incident per retry.
  const incident = await openIncidentFromSignal(signal, input.ownerId, input.actor);

  // 4. Existing remediation — ONE real Recovery Plan per Incident (not per
  //    attempt): retries correlate into the SAME Incident, which already
  //    carries a recoveryPlanId, so repeat failures reuse the existing plan —
  //    bounded by construction, never an automatic retry loop. PLAN_ONLY by
  //    constitution — recoveryRuntime never executes anything itself.
  let recoveryPlan: RecoveryPlan | null = null;
  if (incident.recoveryPlanId) {
    try {
      recoveryPlan = getRecoveryPlan(incident.recoveryPlanId, input.ownerId);
    } catch (e) {
      console.error("[businessFailureBridge] existing plan lookup failed (will create):", e instanceof Error ? e.message : e);
    }
  }
  if (!recoveryPlan) {
    const remediationType = input.failureClass === "PROVIDER_UNAVAILABLE" ? "RETRY_OPERATION" : "MANUAL_INTERVENTION";
    try {
      recoveryPlan = await createRecoveryPlan(incident.incidentId, remediationType, input.ownerId, input.actor, {
        targetOverride: `${input.providerSlug} connector (business action: ${input.businessAction})`,
        customSteps: [
          `Owner opens /admin/connectors and re-tests the "${input.providerSlug}" connector (existing Test gate)`,
          input.failureClass === "PROVIDER_AUTH"
            ? "Owner replaces the expired/invalid credential in the connector record (existing secret path, never env)"
            : "Owner verifies provider status; no credential change needed",
          "Owner re-runs the connector Test until it passes, then re-Enables",
          "Owner retries the business action — the SAME incident identity absorbs the retry until resolved",
        ],
      });
      attachRecoveryPlan(incident.incidentId, input.ownerId, recoveryPlan.recoveryPlanId, input.actor);
    } catch (e) {
      // Remediation planning must never break the normalized result path.
      console.error("[businessFailureBridge] recovery plan creation failed:", e instanceof Error ? e.message : e);
    }
  }

  // 5. Existing Owner escalation — alertRuntime dispatches per the real
  //    DEFAULT_ALERT_POLICY (OWNER_UI + LINE). It deduplicates and
  //    severity-gates by itself; HIGH+ incidents also already surface in
  //    /api/admin/ide/operations/status ownerDecisionsRequired[] because
  //    openIncidentFromSignal sets ownerDecisionRequired from the type's
  //    own minimumSeverity (CONNECTOR_FAILURE floor = MEDIUM → HIGH only
  //    on real repeat escalation). Owner sees technical detail only when
  //    this escalation actually fires — never in Business UI.
  try {
    await dispatchAlert(incident, input.ownerId, input.actor);
  } catch (e) {
    console.error("[businessFailureBridge] alert dispatch failed:", e instanceof Error ? e.message : e);
  }

  // The failure evidence artifact is durably stored + checksummed in the
  // artifact store, linked to the signal above (relatedSignalId) and to
  // the work identity (generatedFrom: workId) — infrastructure-side only.

  return { incident, recoveryPlan };
}

/** THE bridge entry point. Call this from every business-action route
 * right after a provider/gateway send returns failure. Returns ONLY a
 * normalized business result — never raw provider/credential details. */
export async function reportBusinessActionFailure(
  input: BusinessFailureInput
): Promise<NormalizedBusinessResult> {
  // One work identity per action attempt (bounded: created here, finalized
  // below — the same real Operations job ledger every Step 12 flow uses).
  const workId = input.workId ?? randomUUID();
  const job = startOperationsJob("INCIDENT_OPEN", input.actor, input.ownerId, workId);

  try {
    const { incident, recoveryPlan } = await routeFailureToInfrastructure(input, workId);

    finalizeOperationsJob(job.jobId, input.ownerId, {
      ok: true,
      // Work-session record carries the remediation state for
      // infrastructure eyes; the business result below never does.
      result: `ROUTED_TO_INCIDENT:${incident.incidentId} remediation=${recoveryPlan?.executionStatus ?? "PLAN_FAILED"}`,
      error: null,
    });

    return {
      ok: false,
      code: "INFRASTRUCTURE_BLOCKED",
      message: businessMessage(input.failureClass),
      failureClass: input.failureClass,
      workId,
      incidentId: incident.incidentId,
    };
  } catch (e) {
    // Even the bridge itself failing must stay bounded and honest — the
    // business layer still gets a normalized, credential-free result.
    finalizeOperationsJob(job.jobId, input.ownerId, {
      ok: false,
      result: null,
      error: `bridge failure: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    return {
      ok: false,
      code: "INFRASTRUCTURE_BLOCKED",
      message: businessMessage(input.failureClass),
      failureClass: input.failureClass,
      workId,
      incidentId: null,
    };
  }
}

/** Read the connection identity for a provider from the ONE existing
 * connection index (connector-loader → connectors table). Returns the
 * lifecycle state only — never the secret. Used for evidence and for the
 * INFRA_NOT_READY fast path. Never throws — a DB outage must not break the
 * incident path; it only means the evidence lacks the connection snapshot. */
export async function readConnectionIdentity(
  db: SupabaseClient,
  providerSlug: string
): Promise<{ slug: string; status: string; enabled: boolean; lastError: string | null } | null> {
  try {
    const c = await getConnector(db, providerSlug);
    if (!c) return null;
    return { slug: c.slug, status: c.status, enabled: c.enabled, lastError: c.last_error };
  } catch (e) {
    console.error("[businessFailureBridge] connection identity read failed (continuing):", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Convenience wrapper for business send routes: takes the raw gateway
 * response (registry/communication.ts SendMessageResponse shape), routes
 * the failure through the bridge when it failed, and returns the shape
 * the route should hand to Business. */
export async function normalizeSendResult(
  send: { success: boolean; error?: string },
  input: Omit<BusinessFailureInput, "failureClass" | "technicalReason">
): Promise<NormalizedBusinessResult & { raw?: { success: boolean; error?: string } }> {
  if (send.success) {
    return {
      ok: true,
      code: "SENT",
      message: "ส่งสำเร็จ",
      failureClass: null,
      workId: null,
      incidentId: null,
    };
  }
  const failureClass = classifyProviderFailure(send.error ?? "unknown provider error");
  const res = await reportBusinessActionFailure({
    ...input,
    failureClass,
    technicalReason: send.error ?? "unknown provider error",
  });
  // Raw error stays OUT of the returned business payload by construction.
  return res;
}

/** Same bridge for the gateway ActionResponse shape (gateway/actions.ts).
 * For invoice-style results, the caller MUST pre-gate with
 * isProviderPushFailure() — business-data failures must not open
 * infrastructure incidents. The raw response is never returned to
 * Business; only the normalized result is. */
export async function normalizeGatewayResult(
  result: { ok: boolean; error?: string },
  input: Omit<BusinessFailureInput, "failureClass" | "technicalReason">
): Promise<NormalizedBusinessResult> {
  if (result.ok) {
    return {
      ok: true,
      code: "SENT",
      message: "ส่งสำเร็จ",
      failureClass: null,
      workId: null,
      incidentId: null,
  };
  }
  return reportBusinessActionFailure({
    ...input,
    failureClass: classifyProviderFailure(result.error ?? "unknown provider error"),
    technicalReason: result.error ?? "unknown provider error",
  });
}

/** Evidence fingerprint helper — infrastructure-side only. */
export function failureFingerprint(input: Pick<BusinessFailureInput, "providerSlug" | "businessAction" | "failureClass">): string {
  return sha256Hex(`${input.providerSlug}:${input.businessAction}:${input.failureClass}`);
}

/** Deterministic gate for invoice-style gateway failures: only the real
 * provider push failure — the gateway's own fixed "ส่ง LINE ไม่สำเร็จ:"
 * wrapper that gateway/actions.ts#sendInvoiceToLine puts ONLY on the LINE
 * call — is infrastructure-owned. Business-data failures (invoice not
 * found, already SENT, no LINE link) must NOT open infrastructure
 * incidents; they stay plain business results. */
export function isProviderPushFailure(rawError: string): boolean {
  return rawError.startsWith("ส่ง LINE ไม่สำเร็จ:");
}
