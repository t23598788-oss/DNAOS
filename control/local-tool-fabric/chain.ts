/**
 * LOCAL_TOOL_CHAIN_V1 — registered steps and resource handles only.
 */

import { createResourceHandle } from "../owner-client-runtime/contract";
import { emitLocalResourceEvent } from "../local-resource-access/contract";
import { executeLocalToolAction } from "./execute";
import { getLocalTool } from "./adapters";

export async function runLocalToolChain(input: {
  readonly ai_client_id: string;
  readonly session_id: string;
  readonly work_id: string;
  readonly steps: readonly {
    readonly adapter_id: string;
    readonly action: string;
    readonly payload?: Record<string, unknown>;
  }[];
}): Promise<Record<string, unknown>> {
  emitLocalResourceEvent("LOCAL_TOOL_CHAIN_STARTED", input.work_id, `steps=${input.steps.length}`, undefined, {
    session_id: input.session_id, locality: "LOCAL",
  });
  const results: Record<string, unknown>[] = [];
  const handles: string[] = [];
  let skipped: Record<string, unknown> | null = null;
  for (const step of input.steps) {
    const adapter = getLocalTool(step.adapter_id);
    if (!adapter || adapter.availability === "UNAVAILABLE") {
      skipped = { adapter_id: step.adapter_id, action: step.action, NOT_AVAILABLE: true };
      results.push(skipped);
      continue;
    }
    const executed = await executeLocalToolAction({
      adapter_id: step.adapter_id,
      action: step.action,
      ai_client_id: input.ai_client_id,
      session_id: input.session_id,
      work_id: input.work_id,
      payload: step.payload,
    });
    if (adapter.resource_id) {
      const handle = createResourceHandle({
        resource_id: adapter.resource_id,
        logical_path: typeof step.payload?.logical_path === "string" ? step.payload.logical_path : undefined,
        owner_authority: executed.ok === true ? "ALLOW" : "DENY",
        allowed_operations: [step.action],
        work_id: input.work_id,
      });
      handles.push(handle.resource_handle);
      results.push({ ...executed, handle, raw_content_included: handle.raw_content_included });
    } else {
      results.push(executed);
    }
    if (executed.ok === false && executed.reason_code !== "PREVIEW_REQUIRED" && !skipped) {
      break;
    }
  }
  emitLocalResourceEvent("LOCAL_TOOL_CHAIN_COMPLETED", input.work_id, "COMPLETED", undefined, {
    session_id: input.session_id, locality: "LOCAL",
  });
  return {
    schema: "LOCAL_TOOL_CHAIN_V1",
    ok: results.some((row) => row.ok === true),
    results,
    handles,
    RAW_SOURCE_DUPLICATION_REQUIRED: false,
    convert_skipped: skipped,
  };
}
