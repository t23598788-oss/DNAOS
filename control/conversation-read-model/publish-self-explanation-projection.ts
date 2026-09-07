/**
 * หน้าที่: PRODUCER-SIDE, STANDALONE script (Owner UNLOCK 2026-09-06,
 * PUBLISH_EXISTING_SELF_EXPLANATION_PROJECTIONS). Run manually or on a
 * schedule — `npx tsx control/conversation-read-model/publish-self-explanation-projection.ts`
 * — NEVER imported by `control/conversation-runtime/`,
 * `control/owner-command-semantics/`, or `transport/owner-command-http/server.ts`.
 * That is the entire point: this file may freely use everything the real
 * self-explanation systems already require (`node:child_process` via git,
 * `lsof`-based process observation, `control/agent-gateway/` task reads),
 * because it runs OUTSIDE the isolated conversation process, on the
 * developer/deploy machine, and never inside it.
 *
 * CALLS THE EXISTING CORE DIRECTLY. No relationship/lineage/supersession
 * logic is reimplemented here:
 *   `buildMachineModel`/`buildDependencyIndex`  — ../../machine-model/contract.ts
 *   `buildLineage`                              — ../../resource-reconciliation/contract.ts
 *   `detectSupersessions`                       — ../../resource-reconciliation/contract.ts
 * This file's own job is narrow: call those, and reshape their real return
 * values into `SelfExplanationNodeProjection` — never inventing a fact
 * neither system returned.
 *
 * SCOPE (stated, not hidden): `buildLineage()` shells out to git per path
 * and can take real wall-clock time across many nodes, so this run
 * computes full DEPENDENCY/DEPENDENT/IMPACT data for every CAPABILITIES
 * node (cheap — one in-memory graph), but LINEAGE only for
 * `LINEAGE_TARGET_LABELS` below. Extend that list and re-run to cover more;
 * a node outside it gets `lineage: null` — never a guessed one.
 *
 * Input: none (reads the real repo).
 * Output: writes `control/conversation-read-model/data/self-explanation-projection.json`
 * via `publishSelfExplanationProjection`.
 * Dependency ที่อนุญาต: ../machine-model/contract.ts, ../resource-reconciliation/contract.ts,
 * ./contract.ts, ../runtime-revision/contract.ts.
 * สิ่งที่ห้ามแตะ: ห้ามให้ไฟล์นี้ถูก import จาก control/conversation-runtime/
 * หรือ control/owner-command-semantics/ ไม่ว่าทางใด.
 */

import { buildDependencyIndex, buildMachineModel, type MachineModel } from "../machine-model/contract";
import { buildLineage, detectSupersessions, type Supersession } from "../resource-reconciliation/contract";
import { readRuntimeRevision } from "../runtime-revision/contract";
import { publishSelfExplanationProjection } from "./contract";
import type {
  SelfExplanationDuplicateFindingProjection,
  SelfExplanationEdgeProjection,
  SelfExplanationImpactProjection,
  SelfExplanationLineageProjection,
  SelfExplanationNodeProjection,
} from "./types";

/** Real repo-relative paths to compute full lineage for this run — extend and re-run to cover more. Kept short so this script finishes in a bounded time. */
const LINEAGE_TARGET_LABELS: readonly string[] = ["target-resolution"];

function toEdgeProjection(model: MachineModel, edge: { depends_on?: string; dependent?: string; kind: string; source_ref: string }, idField: "depends_on" | "dependent"): SelfExplanationEdgeProjection {
  const nodeId = edge[idField] as string;
  const node = model.nodes.find((n) => n.node_id === nodeId);
  return { node_id: nodeId, label: node?.label ?? null, kind: edge.kind, evidence_ref: edge.source_ref };
}

function toLineageProjection(lineage: ReturnType<typeof buildLineage>): SelfExplanationLineageProjection {
  return {
    created_by_work_id: lineage.created_by_work_id,
    created_by_change_id: lineage.created_by_change_id,
    runtime_owner: lineage.runtime_owner,
    consumers: lineage.consumers,
    dependencies: lineage.dependencies,
    replacement_resource: lineage.replacement_resource,
    superseded_by: lineage.superseded_by,
    current_state: lineage.current_state,
    unresolved: lineage.unresolved,
  };
}

function toDuplicateFindingProjection(s: Supersession): SelfExplanationDuplicateFindingProjection {
  return { old_path: s.old_path, new_path: s.new_path, basis: s.basis, evidence: s.provenance.map((p) => `${p.read_path}: ${p.evidence}`) };
}

function main(): void {
  const model = buildMachineModel({ census: false });
  const index = buildDependencyIndex(model);
  const allSupersessions = detectSupersessions();
  const revision = readRuntimeRevision();

  const capabilityNodes = model.nodes.filter((n) => n.layer_id === "CAPABILITIES");
  const nodes: SelfExplanationNodeProjection[] = capabilityNodes.map((node) => {
    const dependencies = index.dependenciesOf(node.node_id).map((e) => toEdgeProjection(model, e, "depends_on"));
    const dependents = index.dependentsOf(node.node_id).map((e) => toEdgeProjection(model, e, "dependent"));
    const impacted = index.impactOf(node.node_id).map((p): SelfExplanationImpactProjection => ({
      node_id: p.node_id,
      label: model.nodes.find((n) => n.node_id === p.node_id)?.label ?? null,
      depth: p.depth,
    }));

    let lineage: SelfExplanationLineageProjection | null = null;
    if (node.label && LINEAGE_TARGET_LABELS.includes(node.label)) {
      const primaryFile = dependencies.find((d) => d.kind === "MODULE_TO_CAPABILITY" || d.kind === "OWNED_BY_CAPABILITY");
      if (primaryFile?.label) lineage = toLineageProjection(buildLineage(primaryFile.label));
    }

    const duplicateFindings = allSupersessions
      .filter((s) => dependencies.some((d) => d.label === s.old_path || d.label === s.new_path))
      .map(toDuplicateFindingProjection);

    const evidenceRefs = [
      node.source_ref,
      ...dependencies.map((d) => d.evidence_ref),
      ...dependents.map((d) => d.evidence_ref),
      ...(lineage ? ["control/resource-reconciliation/lineage.ts#buildLineage"] : []),
    ];

    return {
      node_id: node.node_id,
      node_type: node.layer_id,
      label: node.label,
      purpose: node.purpose,
      dependencies,
      dependents,
      impacted_by_removal: impacted,
      lineage,
      duplicate_findings: duplicateFindings,
      unresolved: lineage?.unresolved ?? [],
      evidence_refs: evidenceRefs,
    };
  });

  publishSelfExplanationProjection(nodes, revision.revision);
  console.log(`published self-explanation-projection.json: ${nodes.length} capability nodes, ${allSupersessions.length} supersession findings scanned, lineage computed for [${LINEAGE_TARGET_LABELS.join(", ")}]`);
}

main();
