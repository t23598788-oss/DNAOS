/**
 * Bridge to existing #20/#21 engineering mechanisms.
 * Does NOT duplicate get_current_work_context / resolve_current_source /
 * lookup_code_references — calls them and attaches SemanticId when present.
 *
 * ONE BRIDGE RESULT = ONE WORK CORRELATION.
 * When work_id is supplied, all three authorities resolve under that same work.
 */

import {
  lookupCodeReferences,
  resolveCurrentSource,
} from "../mcp-code-knowledge/contract";
import { getCurrentWorkContext } from "../work-session-state/contract";
import { canonicalizeSemanticId } from "./id";
import type { SemanticGraph, SemanticId } from "./types";
import { resolveSemanticId } from "./resolve";

export interface SemanticWorkBridgeResult {
  readonly work_id: string | null;
  readonly source_revision: string | null;
  readonly capability_semantic_ids: readonly SemanticId[];
  readonly resolved: readonly ReturnType<typeof resolveSemanticId>[];
  readonly current_source: ReturnType<typeof resolveCurrentSource>;
  readonly code_refs: ReturnType<typeof lookupCodeReferences> | null;
  readonly authorities_reused: readonly string[];
}

/**
 * Pipeline:
 * getCurrentWorkContext → semantic capability IDs → graph resolve
 * → resolveCurrentSource → lookupCodeReferences
 */
export function bridgeWorkContextToSemantic(
  graph: SemanticGraph,
  options: { work_id?: string; lookup_query?: string } = {},
): SemanticWorkBridgeResult {
  const work = getCurrentWorkContext(options.work_id);
  // Correlate every downstream call to the same resolved work_id (not a second active session).
  const correlatedWorkId = work.work_id ?? options.work_id ?? undefined;

  const capability_semantic_ids: SemanticId[] = [];
  for (const c of work.relevant_capabilities ?? []) {
    const id = canonicalizeSemanticId(c.capability_id);
    if (id) capability_semantic_ids.push(id);
  }
  const resolved = capability_semantic_ids.map((id) => resolveSemanticId(graph, id));
  const current_source = resolveCurrentSource(correlatedWorkId);
  const code_refs = options.lookup_query
    ? lookupCodeReferences({
        query: options.lookup_query,
        include_historical: false,
        work_id: correlatedWorkId,
      })
    : capability_semantic_ids[0]
      ? lookupCodeReferences({
          capability_id: capability_semantic_ids[0],
          include_historical: false,
          work_id: correlatedWorkId,
        })
      : null;

  return {
    work_id: work.work_id,
    source_revision: work.git.source_revision,
    capability_semantic_ids,
    resolved,
    current_source,
    code_refs,
    authorities_reused: [
      "control/work-session-state/engineering-context.ts#getCurrentWorkContext",
      "control/mcp-code-knowledge/source-resolution.ts#resolveCurrentSource",
      "control/mcp-code-knowledge/source-resolution.ts#lookupCodeReferences",
    ],
  };
}
