/**
 * Local-compute-first inspection for AI clients. Returns a minimized working set only.
 */

import { emitLocalResourceEvent, invokeLocalCapability } from "../local-resource-access/contract";
import { evaluateAiClient } from "./bindings";
import { utf8Bytes } from "./host-runtime";
import type { AiClientResultV1 } from "./types";

export async function inspectLocalForClient(input: {
  readonly ai_client_id: string;
  readonly session_id: string;
  readonly work_id: string;
  readonly resource_id: string;
  readonly query: string;
}): Promise<{ ok: false; reason_code: string } | { ok: true; result: AiClientResultV1; matches: readonly Record<string, unknown>[] }> {
  const auth = evaluateAiClient(input.ai_client_id, input.session_id);
  if (auth.decision !== "ALLOW") return { ok: false, reason_code: auth.reason_code };
  emitLocalResourceEvent("AI_CAPABILITY_REQUESTED", input.work_id, "local.files.search", undefined, {
    session_id: input.session_id, resource_id: input.resource_id, action: "SEARCH", locality: "LOCAL",
  });
  emitLocalResourceEvent("AI_LOCAL_WORK_STARTED", input.work_id, "SEARCH", undefined, {
    session_id: input.session_id, resource_id: input.resource_id, locality: "LOCAL",
  });
  const invoked = await invokeLocalCapability({
    ai_client_id: input.ai_client_id,
    session_id: input.session_id,
    work_id: input.work_id,
    capability: "local.files.search",
    resource_id: input.resource_id,
    input: { query: input.query, max_matches: 5 },
  });
  if (!invoked.ok) return { ok: false, reason_code: String(invoked.result.reason_code ?? invoked.authority.reason_code) };
  const rawMatches = Array.isArray(invoked.result.matches) ? invoked.result.matches as Record<string, unknown>[] : [];
  const minimized = rawMatches.slice(0, 5).map((row) => ({
    logical_ref: row.logical_ref,
    line: row.line,
    snippet: String(row.snippet ?? "").slice(0, 160),
  }));
  const source_bytes = Number(invoked.egress.bytes_proposed ?? invoked.envelope.files_read_count);
  const result_bytes = utf8Bytes(minimized);
  const external_bytes = invoked.egress.bytes_actually_sent;
  const envelope: AiClientResultV1 = {
    schema: "AI_CLIENT_RESULT_V1",
    client_id: input.ai_client_id,
    work_id: input.work_id,
    execution_id: invoked.envelope.execution_id,
    canonical_action: "SEARCH",
    result_type: "MINIMIZED_SEARCH_MATCHES",
    canonical_view_type: "FILE_LIST_V1",
    resource_refs: [input.resource_id],
    locality: invoked.envelope.execution_locality,
    source_bytes,
    local_bytes_processed: source_bytes,
    external_bytes_sent: external_bytes,
    result_bytes,
    approval_state: invoked.authority.decision,
    evidence_refs: [invoked.envelope.execution_id],
    status: invoked.envelope.result_status,
  };
  emitLocalResourceEvent("AI_LOCAL_WORK_COMPLETED", input.work_id, "SEARCH", invoked.envelope.execution_id, {
    session_id: input.session_id, resource_id: input.resource_id, locality: "LOCAL", result_status: "COMPLETED", bytes: source_bytes,
  });
  emitLocalResourceEvent("AI_EXTERNAL_DATA_SENT", input.work_id, `bytes=${external_bytes}`, invoked.envelope.execution_id, {
    session_id: input.session_id, bytes: external_bytes, locality: "LOCAL",
  });
  emitLocalResourceEvent("AI_RESULT_RETURNED", input.work_id, "AI_CLIENT_RESULT_V1", invoked.envelope.execution_id, {
    session_id: input.session_id, bytes: result_bytes, locality: "LOCAL", result_status: "COMPLETED",
  });
  return { ok: true, result: envelope, matches: minimized };
}
