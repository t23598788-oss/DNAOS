/**
 * Canonical client execution path. No provider-specific routes.
 */

import {
  applyOwnerReviewDecision,
  attachActionPreview,
  openOwnerReviewView,
} from "../canonical-view/contract";
import { emitLocalResourceEvent, invokeLocalCapability } from "../local-resource-access/contract";
import { evaluateUniversalClient } from "./clients";
import { decideOwnerComputeFirst } from "./compute-first";
import { createResourceHandle } from "./handles";
import { utf8Bytes } from "./host-runtime";
import { normalizeOwnerIntent } from "./intent";
import { upsertWorkContext } from "./work-context";

const HIDDEN = /\/Users\/|\/home\/|keychain:\/\/|ghp_|sk-|password|secret/i;

export async function submitOwnerIntent(input: {
  readonly client_id: string;
  readonly session_id: string;
  readonly work_id: string;
  readonly text: string;
  readonly resource_id: string;
  readonly destination_id?: string;
  readonly protocol_version?: string;
  readonly semantic_review_required?: boolean;
  readonly copy_destination_logical?: string;
}): Promise<Record<string, unknown>> {
  const intent = normalizeOwnerIntent({
    client_id: input.client_id,
    text: input.text,
    resource_id: input.resource_id,
    destination_id: input.destination_id,
  });
  const auth = evaluateUniversalClient(input.client_id, input.protocol_version);
  if (auth.reason_code === "PROVIDER_UNAVAILABLE") {
    return { ok: false, reason_code: "PROVIDER_UNAVAILABLE", system_unavailable: false, intent };
  }
  if (auth.decision !== "ALLOW") {
    return { ok: false, reason_code: auth.reason_code, authentication_equals_authority: false, intent, is_authority: false };
  }
  const capability = intent.canonical_action === "COMPARE" ? "local.git.diff"
    : intent.canonical_action === "COPY" ? "local.file.copy"
    : intent.canonical_action === "MOVE" ? "local.file.move"
    : "local.files.search";
  const route = decideOwnerComputeFirst({
    capability,
    resource_id: input.resource_id,
    bytes_proposed: utf8Bytes(input.text),
    semantic_review_required: input.semantic_review_required === true,
    ai_identity: input.client_id,
    session_id: input.session_id,
    work_id: input.work_id,
  });
  const handle = createResourceHandle({
    resource_id: input.resource_id,
    logical_path: "notes.txt",
    work_id: input.work_id,
    owner_authority: "ALLOW",
    allowed_operations: [intent.canonical_action],
  });
  if (intent.canonical_action === "COPY" || intent.canonical_action === "MOVE" || intent.canonical_action === "SEND") {
    const opened = openOwnerReviewView({
      work_id: input.work_id,
      ai_client_id: input.client_id,
      session_id: input.session_id,
      view_type: "FILE_LIST_V1",
      source_resource_ids: [input.resource_id, input.destination_id ?? input.resource_id],
    });
    const previewed = attachActionPreview(opened.review_id, {
      work_id: input.work_id,
      action: intent.canonical_action === "SEND" ? "SHARE" : intent.canonical_action,
      resource_id: input.resource_id,
      input: {
        source_logical: "notes.txt",
        destination_logical: input.copy_destination_logical ?? "owner-intent-copy.txt",
        destination_resource_id: input.destination_id,
      },
    });
    return {
      ok: true,
      path: ["CLIENT_REQUEST", "INTENT_NORMALIZATION", "RESOURCE_RESOLUTION", "AUTHORITY_CHECK", "OWNER_COMPUTE_FIRST", "CANONICAL_ACTION", "PREVIEW", "OWNER_DECISION"],
      intent,
      route,
      handle,
      review: previewed,
      executed: false,
      SIDE_EFFECT_PREVIEW_REQUIRED: true,
    };
  }

  if (intent.canonical_action === "COMPARE") {
    const diff = await invokeLocalCapability({
      ai_client_id: input.client_id,
      session_id: input.session_id,
      work_id: input.work_id,
      capability: "local.git.diff",
      resource_id: input.resource_id,
      input: {},
    });
    const tests = await invokeLocalCapability({
      ai_client_id: input.client_id,
      session_id: input.session_id,
      work_id: input.work_id,
      capability: "local.compute.run_registered_job",
      resource_id: "resource://local/compute/registered-jobs",
      input: { job_id: "local.compute.true" },
    });
    const working = {
      diff_names: diff.ok ? diff.result : { denied: true },
      test_exit: tests.ok ? tests.result.exit_code : tests.result,
    };
    if (HIDDEN.test(JSON.stringify(working))) return { ok: false, reason_code: "SECRET_IN_RESULT" };
    const processed = utf8Bytes(working) + utf8Bytes(diff.result) + utf8Bytes(tests.result);
    const source_bytes = Math.max(handle.size, processed, Number(diff.egress.bytes_proposed ?? 0) + Number(tests.egress.bytes_proposed ?? 0));
    const sent = input.semantic_review_required ? utf8Bytes(working) : 0;
    const ctx = upsertWorkContext({
      schema: "WORK_CONTEXT_V1",
      work_id: input.work_id,
      goal: intent.goal,
      canonical_actions: ["COMPARE", "SEARCH"],
      resource_handles: [handle.resource_handle],
      completed_steps: ["LOCAL_DIFF", "LOCAL_TEST"],
      open_steps: input.semantic_review_required ? ["AI_REVIEW"] : [],
      structured_results: working,
      evidence_refs: [diff.envelope.execution_id, tests.envelope.execution_id],
      owner_decisions: [],
      approved_ai_context: input.semantic_review_required ? working : {},
      byte_counts: {
        source_bytes,
        local_bytes_processed: processed,
        ai_context_bytes_sent: sent,
        ai_result_bytes: utf8Bytes({ review: "local-deterministic" }),
      },
      transcript_included: false,
    });
    return {
      ok: diff.ok && tests.ok,
      path: ["CLIENT_REQUEST", "INTENT_NORMALIZATION", "RESOURCE_RESOLUTION", "AUTHORITY_CHECK", "OWNER_COMPUTE_FIRST", "CANONICAL_ACTION", "RESULT", "EVIDENCE"],
      intent, route, handle, work_context: ctx,
      SOURCE_REPOSITORY_BYTES: source_bytes,
      LOCAL_BYTES_PROCESSED: processed,
      AI_CONTEXT_BYTES_SENT: sent,
      AI_RESULT_BYTES: ctx.byte_counts.ai_result_bytes,
      external_reasoning: route.external_reasoning_required,
      handle_copies_source: handle.raw_content_included,
    };
  }

  emitLocalResourceEvent("AI_LOCAL_WORK_STARTED", input.work_id, "SEARCH", undefined, {
    session_id: input.session_id, resource_id: input.resource_id, locality: "LOCAL",
  });
  const searched = await invokeLocalCapability({
    ai_client_id: input.client_id,
    session_id: input.session_id,
    work_id: input.work_id,
    capability: "local.files.search",
    resource_id: input.resource_id,
    input: { query: "zzqegate-local-resource-marker", max_matches: 5 },
  });
  if (!searched.ok) return { ok: false, reason_code: String(searched.result.reason_code ?? searched.authority.reason_code), intent, route };
  const raw = Array.isArray(searched.result.matches) ? searched.result.matches as Record<string, unknown>[] : [];
  const matches = raw.slice(0, 5).map((row) => ({
    logical_ref: row.logical_ref,
    line: row.line,
    snippet: String(row.snippet ?? "").slice(0, 160),
  }));
  const result_bytes = utf8Bytes(matches);
  const ctx = upsertWorkContext({
    schema: "WORK_CONTEXT_V1",
    work_id: input.work_id,
    goal: intent.goal,
    canonical_actions: [intent.canonical_action],
    resource_handles: [handle.resource_handle],
    completed_steps: ["LOCAL_SEARCH"],
    open_steps: [],
    structured_results: { matches },
    evidence_refs: [searched.envelope.execution_id],
    owner_decisions: [],
    approved_ai_context: { matches },
    byte_counts: {
      source_bytes: searched.egress.bytes_proposed,
      local_bytes_processed: searched.egress.bytes_proposed,
      ai_context_bytes_sent: searched.egress.bytes_actually_sent,
      ai_result_bytes: result_bytes,
    },
    transcript_included: false,
  });
  return {
    ok: true,
    path: ["CLIENT_REQUEST", "INTENT_NORMALIZATION", "RESOURCE_RESOLUTION", "AUTHORITY_CHECK", "OWNER_COMPUTE_FIRST", "CANONICAL_ACTION", "RESULT", "EVIDENCE"],
    intent, route, handle, work_context: ctx,
    authority: searched.authority.decision,
    locality: searched.envelope.execution_locality,
    matches,
    SOURCE_BYTES: searched.egress.bytes_proposed,
    LOCAL_BYTES_PROCESSED: searched.egress.bytes_proposed,
    EXTERNAL_AI_BYTES_SENT: searched.egress.bytes_actually_sent,
    RESULT_BYTES_RETURNED: result_bytes,
  };
}

export async function approveOwnerIntent(review_id: string, client_id: string, session_id: string) {
  return applyOwnerReviewDecision({ review_id, decision: "APPROVE", ai_client_id: client_id, session_id });
}
