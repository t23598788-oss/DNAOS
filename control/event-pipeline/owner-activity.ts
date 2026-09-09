/**
 * Owner activity producers. Canonical durability and realtime fan-out is
 * `emitSystemEvent`. This file maps activity ingest into that path, then
 * projects Display Queue items for the Owner Surface. It does not keep a
 * parallel event log.
 *
 * Input: OwnerActivityIngest (required identity, lineage, action, evidence).
 * Output: ingestOwnerActivity / recordGithubPublicationActivity /
 * recordAgentMessageActivity / projectOwnerActivity / listDisplayQueue.
 * Dependency ที่อนุญาต: ../owner-backbone/contract.ts.
 * สิ่งที่ห้ามแตะ: never call ../work-coordination (execution queue).
 * never mark an external service VERIFIED from DNA OS local state.
 * never put raw JSON/event names on the compact Owner projection.
 * never let an agent write the Owner Surface directly.
 */

import { listDisplayQueue } from "../owner-backbone/display-queue";
import type { DisplayQueueItem } from "../owner-backbone/display-queue";
import { loadAllEvidence } from "../agent-gateway/memory-store";
import type { SystemEvent, SystemEventType, SystemEventDraft } from "../owner-backbone/types";

export const OWNER_ACTIVITY_SOURCE = "control/owner-backbone/events.ts";
export const DIRECT_RAW_EVENT_TO_UI = 0;
export const AGENT_DIRECT_UI_WRITE = 0;
export const EXTERNAL_SELF_VERIFICATION = 0;

export type ActorType = "owner" | "agent" | "model" | "executor" | "external_service" | "dna_os";
export type ActivityStatus = "REQUESTED" | "ACCEPTED" | "RUNNING" | "BLOCKED" | "FAILED" | "DENIED" | "VERIFIED";
export type VerificationAuthority =
  | "DNA_OS"
  | "GITHUB"
  | "RAILWAY"
  | "SUPABASE"
  | "BROWSER_WORKER"
  | "CONNECTOR"
  | "EXECUTOR"
  | "UNVERIFIED";

export type ActivityHierarchyLevel = "command" | "work_order" | "processing_group" | "step" | "event" | "raw_evidence";

export interface ExternalVerificationProof {
  readonly authority: VerificationAuthority;
  readonly source: string;
  readonly remote_sha?: string | null;
  readonly compared_to?: string | null;
  readonly sha_match?: boolean | null;
}

export interface OwnerActivityEvent {
  readonly event_id: string;
  readonly correlation_id: string;
  readonly work_order_id: string;
  readonly actor_identity: string;
  readonly actor_type: ActorType;
  readonly actor_icon_ref: string;
  readonly action: string;
  readonly status: ActivityStatus;
  readonly source: string;
  readonly timestamp: string;
  readonly evidence_ref: string;
  readonly verification_authority: VerificationAuthority;
  readonly parent_event_id: string | null;
  readonly processing_group_id: string;
  readonly step_id: string;
  readonly human_readable: string;
  readonly verification_proof: ExternalVerificationProof | null;
}

export interface OwnerActivityIngest {
  readonly correlation_id: string;
  readonly work_order_id: string;
  readonly actor_identity: string;
  readonly actor_type: ActorType;
  readonly actor_icon_ref: string;
  readonly action: string;
  readonly status: ActivityStatus;
  readonly source: string;
  readonly parent_event_id?: string | null;
  readonly processing_group_id: string;
  readonly step_id: string;
  readonly human_readable: string;
  readonly evidence_ref?: string | null;
  readonly verification_authority: VerificationAuthority;
  readonly verification_proof?: ExternalVerificationProof | null;
  readonly bound_payload?: unknown;
}

export type OwnerActivityIngestResult =
  | { readonly ok: true; readonly event: OwnerActivityEvent; readonly display_queue_id: string; readonly duplicate: boolean }
  | { readonly ok: false; readonly reason_code: string; readonly detail: string };

export type { DisplayQueueItem };

export interface OwnerProcessingGroup {
  readonly processing_group_id: string;
  readonly title: string;
  readonly actor_icon_ref: string;
  readonly working: boolean;
  readonly status: ActivityStatus;
  readonly human_readable: string;
  readonly details_available: true;
  readonly details_reference: string;
  readonly steps: readonly {
    readonly step_id: string;
    readonly human_readable: string;
    readonly status: ActivityStatus;
    readonly actor_icon_ref: string;
    readonly event_ids: readonly string[];
  }[];
}

export interface OwnerActivityProjection {
  readonly schema: "OWNER_ACTIVITY_PROJECTION_V1";
  readonly command_id: string;
  readonly work_order_id: string | null;
  readonly processing_groups: readonly OwnerProcessingGroup[];
  readonly lineage: {
    readonly command_id: string;
    readonly work_order_id: string | null;
    readonly evidence_refs: readonly string[];
    readonly event_ids: readonly string[];
  };
}

const EXTERNAL_AUTHORITIES = new Set<VerificationAuthority>([
  "GITHUB",
  "RAILWAY",
  "SUPABASE",
  "BROWSER_WORKER",
  "CONNECTOR",
  "EXECUTOR",
]);

function required(value: string | null | undefined, name: string): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return `${name} required`;
  return null;
}

export function denyDirectOwnerSurfaceWrite(detail: string): OwnerActivityIngestResult {
  return { ok: false, reason_code: "AGENT_DIRECT_UI_WRITE", detail };
}

export { listDisplayQueue };

const SYSTEM_EVENT_SOURCE = "control/owner-backbone/events.ts";

function correlationEvents(correlationId: string): SystemEvent[] {
  return loadAllEvidence()
    .filter((row) => row.source === SYSTEM_EVENT_SOURCE)
    .map((row) => row.payload as SystemEvent)
    .filter((event) =>
      event.correlation_id === correlationId
      || event.command_id === correlationId
      || event.work_id === correlationId
      || event.work_order_id === correlationId,
    );
}

function rejectExternalSelfVerification(input: OwnerActivityIngest): string | null {
  const action = input.action.toLowerCase();
  const claimsExternal = action.includes("github") || action.includes("railway") || action.includes("supabase")
    || action.includes("browser") || input.actor_type === "external_service";
  if (input.status !== "VERIFIED") return null;
  if (!claimsExternal) return null;
  if (input.verification_authority === "DNA_OS" || input.verification_authority === "UNVERIFIED") {
    return "EXTERNAL_SELF_VERIFICATION: DNA OS must not declare an external operation VERIFIED from local state";
  }
  if (!EXTERNAL_AUTHORITIES.has(input.verification_authority)) {
    return "EXTERNAL_SELF_VERIFICATION: verification_authority is not an external authority";
  }
  const proof = input.verification_proof;
  if (!proof || proof.authority !== input.verification_authority) {
    return "EXTERNAL_SELF_VERIFICATION: VERIFIED requires proof from the external authority itself";
  }
  if (input.verification_authority === "GITHUB") {
    if (!proof.remote_sha || proof.sha_match !== true || !proof.compared_to || proof.remote_sha !== proof.compared_to) {
      return "GITHUB_REMOTE_VERIFICATION: VERIFIED requires GitHub remote SHA read-back equal to the DNA OS commit";
    }
    if (!proof.source.includes("github")) {
      return "GITHUB_REMOTE_VERIFICATION: proof source must be the GitHub authority";
    }
  }
  return null;
}

function eventTypeFor(input: OwnerActivityIngest): SystemEventType {
  if (input.action === "github_publish_requested") return "SOURCE_PUBLISH_REQUESTED";
  if (input.action === "github_remote_head_read") return "GITHUB_REMOTE_OBSERVED";
  if (input.action === "github_commit_accepted") return "GITHUB_COMMIT_ACCEPTED";
  if (input.action === "github_publish_blocked") return "WORK_BLOCKED";
  if (input.action === "agent_message") return "AGENT_MESSAGE";
  return "WORK_STARTED";
}

function activityFromSystemEvent(event: SystemEvent, queued: DisplayQueueItem | undefined, input?: OwnerActivityIngest): OwnerActivityEvent {
  const status = (queued?.status ?? "ACCEPTED") as ActivityStatus;
  return {
    event_id: event.event_id,
    correlation_id: event.correlation_id,
    work_order_id: event.work_order_id ?? event.work_id ?? event.correlation_id,
    actor_identity: input?.actor_identity ?? event.source,
    actor_type: input?.actor_type ?? (event.event_type === "AGENT_MESSAGE" ? "agent" : event.verification_authority === "GITHUB" ? "external_service" : "dna_os"),
    actor_icon_ref: queued?.actor_icon_ref ?? event.actor_icon_ref ?? "icon:dna-os",
    action: input?.action ?? event.event_type.toLowerCase(),
    status,
    source: event.source,
    timestamp: event.observed_at,
    evidence_ref: event.evidence_refs[0] ?? event.event_id,
    verification_authority: (event.verification_authority as VerificationAuthority | null) ?? "UNVERIFIED",
    parent_event_id: event.parent_event_id,
    processing_group_id: queued?.processing_group_id ?? event.processing_group_id ?? `pg-${event.correlation_id}`,
    step_id: queued?.step_id ?? event.step_id ?? event.event_type.toLowerCase(),
    human_readable: queued?.human_readable ?? input?.human_readable ?? event.next_action,
    verification_proof: event.remote_sha || event.sha_match !== null
      ? {
        authority: (event.verification_authority as VerificationAuthority | null) ?? "UNVERIFIED",
        source: event.source,
        remote_sha: event.remote_sha,
        compared_to: input?.verification_proof?.compared_to ?? null,
        sha_match: event.sha_match,
      }
      : input?.verification_proof ?? null,
  };
}

function sameIngest(event: SystemEvent, input: OwnerActivityIngest): boolean {
  return event.correlation_id === input.correlation_id
    && event.event_type === eventTypeFor(input)
    && event.next_action === input.action
    && (event.remote_sha ?? null) === (input.verification_proof?.remote_sha ?? null)
    && (event.parent_event_id ?? null) === (input.parent_event_id ?? null);
}

export async function ingestOwnerActivity(input: OwnerActivityIngest): Promise<OwnerActivityIngestResult> {
  const missing = required(input.correlation_id, "correlation_id")
    ?? required(input.work_order_id, "work_order_id")
    ?? required(input.actor_identity, "actor_identity")
    ?? required(input.actor_icon_ref, "actor_icon_ref")
    ?? required(input.action, "action")
    ?? required(input.source, "source")
    ?? required(input.processing_group_id, "processing_group_id")
    ?? required(input.step_id, "step_id")
    ?? required(input.human_readable, "human_readable");
  if (missing) return { ok: false, reason_code: "ACTIVITY_EVENT_INVALID", detail: missing };
  if (!input.actor_type) return { ok: false, reason_code: "ACTIVITY_EVENT_INVALID", detail: "actor_type required" };
  if (!input.status) return { ok: false, reason_code: "ACTIVITY_EVENT_INVALID", detail: "status required" };
  if (!input.verification_authority) return { ok: false, reason_code: "ACTIVITY_EVENT_INVALID", detail: "verification_authority required" };
  if (input.human_readable.trim().startsWith("{") || input.human_readable.includes("\n  \"")) {
    return { ok: false, reason_code: "DIRECT_RAW_EVENT_TO_UI", detail: "human_readable must not be raw JSON" };
  }

  const selfVerify = rejectExternalSelfVerification(input);
  if (selfVerify) return { ok: false, reason_code: selfVerify.split(":")[0]!, detail: selfVerify };

  const existing = correlationEvents(input.correlation_id).find((row) => sameIngest(row, input));
  if (existing) {
    const queued = listDisplayQueue(input.correlation_id).find((item) => item.event_id === existing.event_id);
    return { ok: true, event: activityFromSystemEvent(existing, queued, input), display_queue_id: queued?.display_queue_id ?? `dq-${existing.event_id}`, duplicate: true };
  }

  const evidence_ref = input.evidence_ref && input.evidence_ref.trim().length > 0 ? input.evidence_ref.trim() : null;
  const draft: SystemEventDraft = {
    command_id: input.correlation_id,
    work_id: input.work_order_id,
    incident_id: null,
    event_type: eventTypeFor(input),
    state: input.status,
    source: input.source,
    resource_ids: [],
    capability_ids: [],
    evidence_refs: evidence_ref ? [evidence_ref] : [],
    next_action: input.action,
    correlation_id: input.correlation_id,
    work_order_id: input.work_order_id,
    actor_icon_ref: input.actor_icon_ref,
    verification_authority: input.verification_authority,
    parent_event_id: input.parent_event_id ?? null,
    remote_sha: input.verification_proof?.remote_sha ?? null,
    sha_match: input.verification_proof?.sha_match ?? null,
    processing_group_id: input.processing_group_id,
    step_id: input.step_id,
  };
  const { emitSystemEvent } = await import("../owner-backbone/events");
  const emitted = await emitSystemEvent(draft);
  const queued = listDisplayQueue(input.correlation_id).find((item) => item.event_id === emitted.event.event_id);
  return {
    ok: true,
    event: activityFromSystemEvent(emitted.event, queued, input),
    display_queue_id: queued?.display_queue_id ?? `dq-${emitted.event.event_id}`,
    duplicate: false,
  };
}

export function loadOwnerActivityEvents(correlationId: string): readonly OwnerActivityEvent[] {
  const queued = listDisplayQueue(correlationId);
  return correlationEvents(correlationId).map((event) => {
    const item = queued.find((row) => row.event_id === event.event_id);
    return activityFromSystemEvent(event, item);
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function projectOwnerActivity(correlationId: string): OwnerActivityProjection {
  const items = listDisplayQueue(correlationId);
  const work_order_id = items[0]?.work_order_id ?? correlationEvents(correlationId)[0]?.work_order_id ?? null;
  const groups = new Map<string, DisplayQueueItem[]>();
  for (const item of items) {
    const bucket = groups.get(item.processing_group_id) ?? [];
    bucket.push(item);
    groups.set(item.processing_group_id, bucket);
  }
  const processing_groups: OwnerProcessingGroup[] = [];
  for (const [processing_group_id, groupItems] of groups) {
    const chronological = [...groupItems].sort((a, b) => a.enqueued_at.localeCompare(b.enqueued_at));
    let verifiedItem: DisplayQueueItem | undefined;
    let blockedItem: DisplayQueueItem | undefined;
    for (const item of chronological) {
      if (item.status === "VERIFIED") verifiedItem = item;
      if (item.status === "BLOCKED" || item.status === "FAILED" || item.status === "DENIED") blockedItem = item;
    }
    const latest = chronological[chronological.length - 1]!;
    const face = verifiedItem ?? blockedItem ?? latest;
    const stepMap = new Map<string, DisplayQueueItem[]>();
    for (const item of chronological) {
      const bucket = stepMap.get(item.step_id) ?? [];
      bucket.push(item);
      stepMap.set(item.step_id, bucket);
    }
    const working = chronological.some((item) => item.status === "RUNNING" || item.status === "REQUESTED" || item.status === "ACCEPTED");
    const verified = Boolean(verifiedItem);
    const blocked = Boolean(blockedItem);
    processing_groups.push({
      processing_group_id,
      title: face.human_readable,
      actor_icon_ref: face.actor_icon_ref,
      working: working && !verified && !blocked,
      status: verified ? "VERIFIED" : blocked ? (blockedItem?.status ?? "BLOCKED") : latest.status,
      human_readable: face.human_readable,
      details_available: true,
      details_reference: face.details_reference,
      steps: [...stepMap.entries()].map(([step_id, stepItems]) => {
        const stepLatest = stepItems[stepItems.length - 1]!;
        return {
          step_id,
          human_readable: stepLatest.human_readable,
          status: stepLatest.status,
          actor_icon_ref: stepLatest.actor_icon_ref,
          event_ids: stepItems.map((item) => item.event_id),
        };
      }),
    });
  }
  return {
    schema: "OWNER_ACTIVITY_PROJECTION_V1",
    command_id: correlationId,
    work_order_id,
    processing_groups,
    lineage: {
      command_id: correlationId,
      work_order_id,
      evidence_refs: items.map((item) => item.details_reference),
      event_ids: items.map((item) => item.event_id),
    },
  };
}

export async function recordAgentMessageActivity(input: {
  readonly correlation_id: string;
  readonly work_order_id: string;
  readonly actor_identity: string;
  readonly actor_icon_ref: string;
  readonly evidence_ref: string;
  readonly sequence: number;
}): Promise<OwnerActivityIngestResult> {
  return ingestOwnerActivity({
    correlation_id: input.correlation_id,
    work_order_id: input.work_order_id,
    actor_identity: input.actor_identity,
    actor_type: "agent",
    actor_icon_ref: input.actor_icon_ref,
    action: "agent_message",
    status: "ACCEPTED",
    source: "control/agent-gateway/agent-host-dispatch.ts#agent-message",
    processing_group_id: `pg-agent-${input.correlation_id}`,
    step_id: `step-agent-message-${input.sequence}`,
    human_readable: `Agent replied (${input.sequence})`,
    evidence_ref: input.evidence_ref,
    verification_authority: "DNA_OS",
  });
}

export async function recordGithubPublicationActivity(input: {
  readonly command_id: string;
  readonly work_order_id: string;
  readonly dna_os_commit_sha: string | null;
  readonly github_owner: string | null;
  readonly github_repository: string | null;
  readonly publish_branch: string | null;
  readonly pre_publish_remote_sha: string | null;
  readonly post_publish_remote_sha: string | null;
  readonly published: boolean;
  readonly publish_source: string;
}): Promise<{ readonly requested: OwnerActivityIngestResult; readonly accepted: OwnerActivityIngestResult | null; readonly verified: OwnerActivityIngestResult | null }> {
  const group = `pg-github-publish-${input.command_id}`;
  const requested = await ingestOwnerActivity({
    correlation_id: input.command_id,
    work_order_id: input.work_order_id,
    actor_identity: "dna-os-github-publish-authority",
    actor_type: "dna_os",
    actor_icon_ref: "icon:dna-os",
    action: "github_publish_requested",
    status: "REQUESTED",
    source: "control/engineering-runtime/publish.ts",
    processing_group_id: group,
    step_id: "step-dna-os-request",
    human_readable: "DNA OS requested GitHub publish",
    verification_authority: "DNA_OS",
    bound_payload: { dna_os_commit_sha: input.dna_os_commit_sha },
  });
  const parent = requested.ok ? requested.event.event_id : null;

  let accepted: OwnerActivityIngestResult | null = null;
  if (input.pre_publish_remote_sha && input.github_owner && input.github_repository) {
    accepted = await ingestOwnerActivity({
      correlation_id: input.command_id,
      work_order_id: input.work_order_id,
      actor_identity: `${input.github_owner}/${input.github_repository}`,
      actor_type: "external_service",
      actor_icon_ref: "icon:github",
      action: "github_remote_head_read",
      status: "ACCEPTED",
      source: input.publish_source,
      parent_event_id: parent,
      processing_group_id: group,
      step_id: "step-github-read-remote",
      human_readable: "GitHub remote branch read back",
      verification_authority: "GITHUB",
      verification_proof: {
        authority: "GITHUB",
        source: input.publish_source,
        remote_sha: input.pre_publish_remote_sha,
        compared_to: null,
        sha_match: null,
      },
    });
  }

  let verified: OwnerActivityIngestResult | null = null;
  const shaMatch = Boolean(
    input.published
    && input.dna_os_commit_sha
    && input.post_publish_remote_sha
    && input.dna_os_commit_sha === input.post_publish_remote_sha,
  );
  if (shaMatch) {
    verified = await ingestOwnerActivity({
      correlation_id: input.command_id,
      work_order_id: input.work_order_id,
      actor_identity: `${input.github_owner}/${input.github_repository}`,
      actor_type: "external_service",
      actor_icon_ref: "icon:github",
      action: "github_commit_accepted",
      status: "VERIFIED",
      source: input.publish_source,
      parent_event_id: accepted?.ok ? accepted.event.event_id : parent,
      processing_group_id: group,
      step_id: "step-github-sha-match",
      human_readable: "Commit accepted",
      verification_authority: "GITHUB",
      verification_proof: {
        authority: "GITHUB",
        source: input.publish_source,
        remote_sha: input.post_publish_remote_sha,
        compared_to: input.dna_os_commit_sha,
        sha_match: true,
      },
    });
  } else if (input.dna_os_commit_sha) {
    verified = await ingestOwnerActivity({
      correlation_id: input.command_id,
      work_order_id: input.work_order_id,
      actor_identity: "dna-os-github-publish-authority",
      actor_type: "dna_os",
      actor_icon_ref: "icon:dna-os",
      action: "github_publish_blocked",
      status: "BLOCKED",
      source: "control/engineering-runtime/publish.ts",
      parent_event_id: parent,
      processing_group_id: group,
      step_id: "step-github-sha-match",
      human_readable: "GitHub publish not verified from remote SHA",
      verification_authority: "DNA_OS",
    });
  }

  return { requested, accepted, verified };
}
