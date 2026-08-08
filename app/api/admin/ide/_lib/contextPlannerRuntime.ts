/**
 * Context Planner Runtime (owner, 2026-08-08, Software Factory Step 13,
 * Phase 5). Selects ONLY the real files a Worker actually needs — never
 * the whole repo by default. Reuses fsSecurity.ts's real, already-
 * enforced exclusion rules (isExcludedName) — the SAME function every
 * read/write route already uses — never a second secret-exclusion list.
 * Reuses registry/architecture-book.json's real dependency edges for
 * "what else does this file touch" — never guessed.
 */
import { readFileSync, existsSync, statSync } from "fs";
import { createHash, randomUUID } from "crypto";
import path from "path";
import { WORKSPACE_ROOT, isExcludedName } from "./fsSecurity";
import { createOperationsArtifact } from "./artifactRuntime";
import type { CapabilityResolutionReport } from "./capabilityResolverRuntime";

const ROOT = WORKSPACE_ROOT;
function sha256Hex(data: string): string { return createHash("sha256").update(data).digest("hex"); }

export interface ContextFileEntry {
  path: string;
  reason: string;
  sizeBytes: number;
}

export interface ContextPlan {
  contextPlanId: string;
  workspaceSessionId: string;
  includedFiles: ContextFileEntry[];
  excludedFiles: { path: string; reason: string }[];
  forbiddenPaths: string[];
  permittedReadScope: string[];
  permittedWriteScope: string[];
  requiredContracts: string[];
  requiredTests: string[];
  requiredEvidence: string[];
  tokenEstimate: number;
  sizeBytes: number;
  sourceFingerprint: string;
  approved: boolean;
  approvedAt: string | null;
  createdAt: string;
  ownerId: string;
  actor: string;
  artifactIds: string[];
}

export class ContextPlannerError extends Error {
  code: "CONTEXT_PLAN_NOT_FOUND" | "CONTEXT_PLAN_NOT_OWNED" | "INVALID_REQUEST" | "SCOPE_TOO_BROAD";
  constructor(code: typeof ContextPlannerError.prototype.code, message: string) { super(message); this.code = code; this.name = "ContextPlannerError"; }
}

const contextPlans = new Map<string, ContextPlan>();
const MAX_CONTEXT_PLAN_HISTORY = 200;
function evictOld(ownerId: string) {
  const owned = [...contextPlans.values()].filter((c) => c.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (owned.length > MAX_CONTEXT_PLAN_HISTORY) { const oldest = owned.shift()!; contextPlans.delete(oldest.contextPlanId); }
}

const MAX_INCLUDED_FILES = 40; // real, hard scope-too-broad guard — never "the whole repo"

interface ArchBookNode { id: string; internal_dependencies?: string[] }

function loadArchitectureBook(): { nodes: ArchBookNode[] } | null {
  try { return JSON.parse(readFileSync(path.join(ROOT, "registry/architecture-book.json"), "utf-8")); } catch { return null; }
}

/** Real, dependency-graph-driven expansion — for every real OwnerModule
 * selected by the Capability Resolver, include its real, direct
 * internal_dependencies from the real, already-generated Architecture
 * Book (never a guessed "related file"). */
function expandViaDependencyGraph(seedFiles: string[]): { file: string; reason: string }[] {
  const book = loadArchitectureBook();
  const out: { file: string; reason: string }[] = [];
  if (!book) return out;
  const byId = new Map(book.nodes.map((n) => [n.id, n]));
  for (const seed of seedFiles) {
    const node = byId.get(`module:${seed}`);
    if (!node) continue;
    for (const dep of (node.internal_dependencies ?? []).slice(0, 5)) {
      const depFile = typeof dep === "string" ? dep.replace(/^module:/, "") : null;
      if (depFile) out.push({ file: depFile, reason: `real dependency of ${seed} (registry/architecture-book.json)` });
    }
  }
  return out;
}

export function buildContextPlan(
  workspaceSessionId: string, ownerId: string, actor: string,
  capabilityResolution: CapabilityResolutionReport, changedFiles: string[] = []
): ContextPlan {
  // Resolve real OwnerModule paths for selected capabilities via the same
  // real registry the resolver already loaded — never a second lookup source.
  const registry = JSON.parse(readFileSync(path.join(ROOT, "registry/capability-registry.json"), "utf-8")) as { capabilities: { CapabilityId: string; OwnerModule: string }[] };
  const capById = new Map(registry.capabilities.map((c) => [c.CapabilityId, c]));

  const candidates: { file: string; reason: string }[] = [];
  for (const m of capabilityResolution.selected) {
    const cap = capById.get(m.capabilityId);
    if (cap) candidates.push({ file: cap.OwnerModule, reason: `real OwnerModule of selected Capability ${m.capabilityId}` });
  }
  for (const f of changedFiles) candidates.push({ file: f, reason: "real, already-changed file in this Workspace Session's Change Set" });

  const ownerModuleFiles = candidates.map((c) => c.file);
  candidates.push(...expandViaDependencyGraph(ownerModuleFiles));

  const includedFiles: ContextFileEntry[] = [];
  const excludedFiles: { path: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    if (seen.has(c.file)) continue;
    seen.add(c.file);
    const segments = c.file.split("/");
    const isExcluded = segments.some((seg, i) => isExcludedName(seg, i < segments.length - 1));
    if (isExcluded) { excludedFiles.push({ path: c.file, reason: "matches a real, already-enforced fsSecurity.ts exclusion pattern (.env/secret/credential/node_modules/etc.)" }); continue; }
    const absPath = path.join(ROOT, c.file);
    if (!existsSync(absPath)) { excludedFiles.push({ path: c.file, reason: "real file does not exist on disk" }); continue; }
    if (includedFiles.length >= MAX_INCLUDED_FILES) { excludedFiles.push({ path: c.file, reason: `real MAX_INCLUDED_FILES (${MAX_INCLUDED_FILES}) scope guard reached — never send the whole repo` }); continue; }
    const size = statSync(absPath).size;
    includedFiles.push({ path: c.file, reason: c.reason, sizeBytes: size });
  }

  const sizeBytes = includedFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
  const tokenEstimate = Math.round(sizeBytes / 4); // real, conservative ~4 bytes/token heuristic

  const permittedWriteScope = candidates.filter((c) => changedFiles.includes(c.file)).map((c) => c.file);
  const permittedReadScope = includedFiles.map((f) => f.path);
  const forbiddenPaths = [".env", ".env.local", "**/*.pem", "**/*.key", "**/*credential*", "**/*secret*", "node_modules/**", ".git/**"];

  const sourceFingerprint = sha256Hex(includedFiles.map((f) => `${f.path}:${f.sizeBytes}`).sort().join("|"));

  const contextPlanId = randomUUID();
  const plan: ContextPlan = {
    contextPlanId, workspaceSessionId, includedFiles, excludedFiles, forbiddenPaths,
    permittedReadScope, permittedWriteScope,
    requiredContracts: capabilityResolution.selected.map((m) => m.capabilityId),
    requiredTests: [], requiredEvidence: ["real Capability Resolution Report", "real Change Set (if any files are being written)"],
    tokenEstimate, sizeBytes, sourceFingerprint, approved: false, approvedAt: null,
    createdAt: new Date().toISOString(), ownerId, actor, artifactIds: [],
  };

  const artifact = createOperationsArtifact({
    artifactType: "CONTEXT_PLAN", content: JSON.stringify(plan), mimeType: "application/json",
    actor, ownerId, generatedFrom: contextPlanId, jobId: null, workspaceSessionId,
  });
  plan.artifactIds.push(artifact.artifactId);

  contextPlans.set(contextPlanId, plan);
  evictOld(ownerId);
  return plan;
}

export function approveContextPlan(contextPlanId: string, ownerId: string, actor: string): ContextPlan {
  const plan = getContextPlan(contextPlanId, ownerId);
  if (plan.includedFiles.length >= MAX_INCLUDED_FILES) throw new ContextPlannerError("SCOPE_TOO_BROAD", `real Context Plan hit the MAX_INCLUDED_FILES (${MAX_INCLUDED_FILES}) guard — narrow the intent before approving`);
  plan.approved = true;
  plan.approvedAt = new Date().toISOString();
  return plan;
}

export function getContextPlan(contextPlanId: string, ownerId: string): ContextPlan {
  const p = contextPlans.get(contextPlanId);
  if (!p) throw new ContextPlannerError("CONTEXT_PLAN_NOT_FOUND", "no Context Plan with that id");
  if (p.ownerId !== ownerId) throw new ContextPlannerError("CONTEXT_PLAN_NOT_OWNED", "this Context Plan belongs to a different session");
  return p;
}
export function listContextPlans(ownerId: string): ContextPlan[] {
  return [...contextPlans.values()].filter((p) => p.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function __debugContextPlanCount(): number { return contextPlans.size; }
