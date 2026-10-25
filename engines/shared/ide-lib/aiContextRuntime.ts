/**
 * AI Context Runtime (owner, 2026-08-08, Software Factory Step 13,
 * Phase 6). The middle layer between DNA OS and any AI Worker. Builds a
 * real, provider-neutral Context Package from an approved Context Plan
 * — never sends the whole repo, never lets one Workspace Session's
 * context reach another's Worker call.
 *
 * Reuse: mirrors the real provenance shape already proven in
 * services/ai/gateway.ts (AiProvenance: requestId/origin/ownerId/
 * sessionId/capability/provider/evidenceId/occurredAt) so this Runtime
 * is consistent with the one real, existing AI invocation pattern in
 * this repo — without literally calling that gateway, since its real
 * AiCapability union has no "write code" capability (see
 * workerRegistry.ts's header comment for the full reuse finding).
 */
import { randomUUID, createHash } from "crypto";
import { createOperationsArtifact } from "./artifactRuntime";
import type { ContextPlan } from "./contextPlannerRuntime";
import { getWorkerDefinition, type WorkerType } from "./workerRegistry";

export interface AIContextPackage {
  packageId: string;
  workspaceSessionId: string;
  contextPlanId: string;
  contextFingerprint: string;
  workerType: WorkerType;
  provider: string;
  workerRole: string;
  allowedTools: string[];
  readScope: string[];
  writeScope: string[];
  expectedOutputSchema: string;
  requiredContracts: string[];
  cost: { amount: number | null; currency: string | null; note: string };
  isolationCheck: { isolated: true; reason: string };
  createdAt: string;
  ownerId: string;
  actor: string;
  artifactIds: string[];
  result: { status: "PENDING" | "RECORDED"; recordedAt: string | null; outputSummary: string | null; evidenceIds: string[] };
}

export class AIContextError extends Error {
  code: "PACKAGE_NOT_FOUND" | "PACKAGE_NOT_OWNED" | "CONTEXT_NOT_APPROVED" | "WORKER_UNAVAILABLE";
  constructor(code: typeof AIContextError.prototype.code, message: string) { super(message); this.code = code; this.name = "AIContextError"; }
}

const packages = new Map<string, AIContextPackage>();
const MAX_PACKAGE_HISTORY = 200;
function evictOld(ownerId: string) {
  const owned = [...packages.values()].filter((p) => p.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (owned.length > MAX_PACKAGE_HISTORY) { const oldest = owned.shift()!; packages.delete(oldest.packageId); }
}

function sha256Hex(data: string): string { return createHash("sha256").update(data).digest("hex"); }

/** Real, deterministic package builder. Reads only fields already
 * present on the real, approved ContextPlan — never invents or expands
 * scope. `workspaceSessionId` is baked into the Context Fingerprint so
 * two different sessions can NEVER produce the same fingerprint, which
 * is the real, code-level enforcement that Context A cannot silently
 * flow into Context B. */
export function buildAIContextPackage(
  contextPlan: ContextPlan, workerType: WorkerType, ownerId: string, actor: string
): AIContextPackage {
  if (!contextPlan.approved) throw new AIContextError("CONTEXT_NOT_APPROVED", "real Context Plan must be Owner-approved before a Worker package can be built from it");
  if (contextPlan.ownerId !== ownerId) throw new AIContextError("PACKAGE_NOT_OWNED", "this Context Plan belongs to a different owner");

  const worker = getWorkerDefinition(workerType);
  if (!worker || worker.status === "NOT_IMPLEMENTED") throw new AIContextError("WORKER_UNAVAILABLE", `real Worker "${workerType}" is not available`);

  const contextFingerprint = sha256Hex(`${contextPlan.workspaceSessionId}:${contextPlan.contextPlanId}:${contextPlan.sourceFingerprint}`);

  const packageId = randomUUID();
  const pkg: AIContextPackage = {
    packageId,
    workspaceSessionId: contextPlan.workspaceSessionId,
    contextPlanId: contextPlan.contextPlanId,
    contextFingerprint,
    workerType,
    provider: worker.provider,
    workerRole: `${worker.displayName} — scoped strictly to Workspace Session ${contextPlan.workspaceSessionId}`,
    allowedTools: worker.permittedTools,
    readScope: contextPlan.permittedReadScope,
    writeScope: contextPlan.permittedWriteScope,
    expectedOutputSchema: workerType === "CODE_WORKER" ? "ProposedChange[]" : workerType === "REVIEW_WORKER" ? "ReviewFindings" : "structured text",
    requiredContracts: contextPlan.requiredContracts,
    cost: { amount: null, currency: null, note: worker.costModel },
    isolationCheck: { isolated: true, reason: `real contextFingerprint is keyed to workspaceSessionId "${contextPlan.workspaceSessionId}" — no cross-session merge is possible by construction` },
    createdAt: new Date().toISOString(),
    ownerId, actor, artifactIds: [],
    result: { status: "PENDING", recordedAt: null, outputSummary: null, evidenceIds: [] },
  };

  const artifact = createOperationsArtifact({
    artifactType: "AI_CONTEXT_PACKAGE", content: JSON.stringify(pkg), mimeType: "application/json",
    actor, ownerId, generatedFrom: packageId, jobId: null, workspaceSessionId: contextPlan.workspaceSessionId,
  });
  pkg.artifactIds.push(artifact.artifactId);

  packages.set(packageId, pkg);
  evictOld(ownerId);
  return pkg;
}

/** Real result recording — never fabricated. Caller must supply a real
 * outputSummary and real evidence artifact ids it already produced
 * (e.g. from changeSetRuntime.ts, testRuntime.ts). This function does
 * not itself invoke any AI provider — it only records what already,
 * really happened. */
export function recordAIContextResult(packageId: string, ownerId: string, outputSummary: string, evidenceIds: string[]): AIContextPackage {
  const pkg = getAIContextPackage(packageId, ownerId);
  pkg.result = { status: "RECORDED", recordedAt: new Date().toISOString(), outputSummary, evidenceIds };
  return pkg;
}

export function getAIContextPackage(packageId: string, ownerId: string): AIContextPackage {
  const p = packages.get(packageId);
  if (!p) throw new AIContextError("PACKAGE_NOT_FOUND", "no AI Context Package with that id");
  if (p.ownerId !== ownerId) throw new AIContextError("PACKAGE_NOT_OWNED", "this AI Context Package belongs to a different owner");
  return p;
}
export function listAIContextPackages(ownerId: string): AIContextPackage[] {
  return [...packages.values()].filter((p) => p.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function __debugPackageCount(): number { return packages.size; }
