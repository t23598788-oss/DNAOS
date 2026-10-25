/**
 * Package-to-Core integration regression. The package receives no registry,
 * graph, map, connector, database, or secret. Its sole host adapter delegates
 * to the existing Context Planner, proving there is no parallel authority.
 */
import { randomUUID } from "crypto";
import { buildContextPlan } from "../app/api/admin/ide/_lib/contextPlannerRuntime";
import { resolveCapabilities } from "../app/api/admin/ide/_lib/capabilityResolverRuntime";
import { prepareSemanticPreflight } from "../external-packages/semantic-preflight/src/index";
import type { StructuredIntent } from "../app/api/admin/ide/_lib/intentRuntime";

const ownerId = "semantic-preflight-package-integration-owner";
const actor = "semantic-preflight-package-integration@dnaos.local";
const workspaceSessionId = randomUUID();
const changedFiles = ["engines/jobs/auto-create.ts"];
const intent: StructuredIntent = {
  problem: "auto create a job when material and quantity info is missing",
  desiredOutcome: "prepare only the real context needed for the existing job capability",
  requestedChange: "inspect capability impact without executing it",
  affectedArea: [], constraints: [], nonGoals: [], expectedEvidence: [], acceptanceCriteria: [],
  ownerAuthority: "OWNER_CONFIRMED", riskTolerance: "LOW",
};

async function main() {
  const resolution = resolveCapabilities(intent);
  const corePlan = buildContextPlan(workspaceSessionId, ownerId, actor, resolution, changedFiles);
  let calls = 0;
  const result = await prepareSemanticPreflight({
    prepareContextPlan: (request) => {
      calls += 1;
      if (request.workspaceSessionId !== workspaceSessionId || request.ownerId !== ownerId || request.actor !== actor) throw new Error("package changed host identity input");
      if (JSON.stringify(request.changedFiles) !== JSON.stringify(changedFiles)) throw new Error("package broadened or changed requested scope");
      return { semanticPreflight: corePlan.semanticPreflight };
    },
  }, { workspaceSessionId, ownerId, actor, changedFiles });

  if (calls !== 1) throw new Error(`expected exactly one Core Context Planner delegation, received ${calls}`);
  if (result.semanticPreflight !== corePlan.semanticPreflight) throw new Error("package reconstructed a second Semantic Preflight instead of preserving Core output");
  if (result.authority !== "HOST_CONTEXT_PLANNER") throw new Error("package did not preserve Core authority boundary");
  if (result.semanticPreflight.capabilityAuthority.registry !== "registry/capability-registry.json") throw new Error("package replaced frozen capability registry authority");
  if (!result.semanticPreflight.authorityBoundaries.some((boundary) => boundary.includes("requireConnector()"))) throw new Error("package lost existing Connector Run gate boundary");
  if (result.semanticPreflight.unknowns.length === 0 && result.semanticPreflight.runtimeEvidence.length === 0) throw new Error("package omitted both explicit UNKNOWN and runtime evidence");

  console.log("PASS Semantic Preflight package delegates once to actual buildContextPlan(), returns its exact evidence object, and preserves Core authority/scope boundaries.");
}

main().catch((error) => { console.error("FAIL", error); process.exit(1); });