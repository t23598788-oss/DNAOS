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
import { getDependents } from "@/engines/workspace/dependencyRegistry";

const ROOT = WORKSPACE_ROOT;
function sha256Hex(data: string): string { return createHash("sha256").update(data).digest("hex"); }

export interface ContextFileEntry {
  path: string;
  reason: string;
  sizeBytes: number;
}

export type RuntimeEvidenceClassification = "VERIFIED_LIVE" | "CONFIGURED" | "SOURCE_REFERENCE" | "UNKNOWN";

export interface SemanticPreflightCapability {
  capabilityId: string;
  ownerModule: string;
  exportName: string;
  mutability: string;
  status: string;
  authority: "FROZEN_CAPABILITY_REGISTRY";
}

export interface SemanticPreflightDependency {
  ownerModule: string;
  dependent: string;
  target: string;
  kind: string;
  source: "auto-dependency-graph" | "infra-dependency-graph";
}

export interface SemanticPreflightRuntimeEvidence {
  classification: RuntimeEvidenceClassification;
  relationship: string;
  evidence: string;
}

export interface SemanticPreflight {
  status: "READY" | "UNKNOWN";
  capabilityAuthority: {
    registry: "registry/capability-registry.json";
    frozen: boolean;
    capabilities: SemanticPreflightCapability[];
  };
  dependencies: SemanticPreflightDependency[];
  runtimeEvidence: SemanticPreflightRuntimeEvidence[];
  authorityBoundaries: string[];
  constraints: string[];
  unknowns: string[];
  sourceFingerprint: string;
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
  semanticPreflight: SemanticPreflight;
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

interface ArchBookNode { id: string; internal_dependencies?: string[]; runtime_entry_point?: boolean }

interface ModuleRegistryRecord {
  owner?: string;
  layer?: string;
  purpose?: string;
  purpose_th?: string;
  exports?: string[];
  status?: string;
}

interface DependencyGraphEdge {
  source: string;
  target: string;
  kind: string;
  confidence?: number;
  evidence?: Array<{ kind?: string; file?: string; detail?: string }>;
}

interface UnknownSourceDiscovery {
  candidates: { file: string; reason: string }[];
  runtimeEvidence: SemanticPreflightRuntimeEvidence[];
  unknowns: string[];
}

interface CapabilityAuthorityRecord {
  CapabilityId: string;
  OwnerModule: string;
  ExportName: string;
  Mutability: string;
  Status: string;
}

interface ArchifyRuntimeMap {
  evidence_policy?: Record<RuntimeEvidenceClassification, string>;
  edges?: Array<{
    from?: string;
    to?: string;
    via?: string;
    classification?: RuntimeEvidenceClassification;
    evidence?: string;
    source?: string;
    note?: string;
  }>;
}

function loadArchitectureBook(): { nodes: ArchBookNode[] } | null {
  try { return JSON.parse(readFileSync(path.join(ROOT, "registry/architecture-book.json"), "utf-8")); } catch { return null; }
}

function loadModuleRegistry(): { modules: Record<string, ModuleRegistryRecord> } | null {
  try { return JSON.parse(readFileSync(path.join(ROOT, "registry/module-registry.json"), "utf-8")); } catch { return null; }
}

function loadAutoDependencyGraph(): { edges: DependencyGraphEdge[] } | null {
  try { return JSON.parse(readFileSync(path.join(ROOT, "registry/auto-dependency-graph.json"), "utf-8")); } catch { return null; }
}

function sourceSearchTerms(intentKeywords: string[]): { primary: string[]; semantic: string[] } {
  const primary = [...new Set(intentKeywords.map((term) => term.trim().toLowerCase()).filter((term) => /^[a-z0-9]+$/.test(term) && term.length >= 3))];
  const semantic = new Set(intentKeywords.map((term) => term.trim().toLowerCase()).filter((term) => term.length >= 3));
  // Mechanical intent vocabulary for source context only — not a Capability
  // Resolver, not a capability declaration, and never an execution decision.
  // It lets existing English source metadata be searched from the Owner's Thai
  // operational wording without fabricating a runtime relationship.
  if (intentKeywords.some((term) => /ตรวจระบบ/.test(term))) semantic.add("observe");
  if (intentKeywords.some((term) => /รับข้อความ/.test(term))) {
    for (const term of ["inbound", "webhook", "message", "received"]) semantic.add(term);
  }
  return { primary, semantic: [...semantic] };
}

/**
 * UNKNOWN capability fallback: compose source evidence already declared by the
 * Module Registry and Architecture Book. This is deliberately not a second
 * Capability Resolver: it never selects a capability, changes the frozen
 * registry, or grants a Worker write scope. The auto dependency graph is
 * consulted only to report whether an Architecture Book relationship has
 * separately generated edge evidence; a missing generated edge stays UNKNOWN.
 */
function discoverUnknownSources(intentKeywords: string[], enabled: boolean): UnknownSourceDiscovery {
  if (!enabled) return { candidates: [], runtimeEvidence: [], unknowns: [] };

  const { primary, semantic } = sourceSearchTerms(intentKeywords);
  const moduleRegistry = loadModuleRegistry();
  const architectureBook = loadArchitectureBook();
  const dependencyGraph = loadAutoDependencyGraph();
  const unknowns: string[] = [];
  if (!moduleRegistry) unknowns.push("UNKNOWN: Module Registry is unavailable; no UNKNOWN-capability source discovery was inferred.");
  if (!architectureBook) unknowns.push("UNKNOWN: Architecture Book is unavailable; no source dependency relationship was inferred.");
  if (!dependencyGraph) unknowns.push("UNKNOWN: auto-dependency-graph.json is unavailable; generated dependency confirmation was not inferred.");
  if (!moduleRegistry || !architectureBook) return { candidates: [], runtimeEvidence: [], unknowns };

  const nodes = new Map<string, ArchBookNode>(architectureBook.nodes.map((node) => [node.id, node]));
  const rankedSeeds: { file: string; semanticMatches: string[]; score: number }[] = [];
  for (const [file, record] of Object.entries(moduleRegistry.modules)) {
      const node = nodes.get(`module:${file}`);
      if (record.status !== "active" || !node) continue;
      const sourceMetadata = [file, record.purpose, record.purpose_th, ...(record.exports ?? [])].filter(Boolean).join(" ").toLowerCase();
      if (primary.length > 0 && !primary.every((term) => sourceMetadata.includes(term))) continue;
      const semanticMatches = semantic.filter((term) => sourceMetadata.includes(term));
      if (semanticMatches.length > 0) rankedSeeds.push({ file, semanticMatches, score: semanticMatches.length + (node.runtime_entry_point ? 1 : 0) });
  }
  rankedSeeds.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  const strongestScore = rankedSeeds[0]?.score ?? 0;
  const seeds = rankedSeeds.filter((candidate) => candidate.score === strongestScore).map((candidate) => candidate.file);

  if (seeds.length === 0) {
    unknowns.push(`UNKNOWN: no active Module Registry entry and Architecture Book node matched the unresolved intent terms: ${semantic.join(", ") || "(none)"}.`);
    return { candidates: [], runtimeEvidence: [], unknowns };
  }

  const candidates = seeds.map((file) => ({
    file,
    reason: `UNKNOWN-capability source discovery: active Module Registry metadata/path matched strongest unresolved intent meaning term(s) ${rankedSeeds.find((candidate) => candidate.file === file)?.semanticMatches.join(", ")} and has a real Architecture Book module node`,
  }));
  const runtimeEvidence: SemanticPreflightRuntimeEvidence[] = seeds.map((file) => ({
    classification: "SOURCE_REFERENCE",
    relationship: `unresolved intent -> ${file}`,
    evidence: `Active registry/module-registry.json entry plus registry/architecture-book.json module:${file}; source exists on disk is checked before inclusion.`,
  }));
  const seen = new Set(seeds);

  for (const source of seeds) {
    const node = nodes.get(`module:${source}`);
    for (const dependencyId of node?.internal_dependencies ?? []) {
      const target = dependencyId.replace(/^module:/, "");
      if (seen.has(target) || !moduleRegistry.modules[target] || moduleRegistry.modules[target].status !== "active") continue;
      if (!target.startsWith("engines/integration-gateway/")) continue;
      seen.add(target);
      const graphEdge = dependencyGraph?.edges.find((edge) => edge.source === `module:${source}` && edge.target === `module:${target}`);
      const graphEvidence = graphEdge
        ? ` Separately confirmed by registry/auto-dependency-graph.json (${graphEdge.kind}, confidence=${graphEdge.confidence ?? "UNKNOWN"}).`
        : " UNKNOWN: no matching generated dependency-graph edge was found; this relationship is source-reference evidence from the Architecture Book only.";
      candidates.push({ file: target, reason: `UNKNOWN-capability source discovery: direct Architecture Book dependency of ${source}.${graphEvidence}` });
      runtimeEvidence.push({
        classification: "SOURCE_REFERENCE",
        relationship: `${source} -> ${target}`,
        evidence: `registry/architecture-book.json declares module:${target} as an internal dependency of module:${source}.${graphEvidence}`,
      });
    }
  }

  unknowns.push("UNKNOWN: source discovery proves registered source references only; it does not prove external webhook delivery, event-bus persistence, or runtime health.");
  return { candidates, runtimeEvidence, unknowns };
}

function loadArchifyRuntimeMap(): ArchifyRuntimeMap | null {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, "reports/archify-runtime-relationship-map/production-runtime-relationship-map.json"), "utf-8")) as ArchifyRuntimeMap;
  } catch {
    return null;
  }
}

/** Read-time composition only. This neither writes a registry nor treats the
 * Archify report as a resolver: every relationship remains classified with its
 * recorded evidence level, and missing data remains UNKNOWN. */
function buildSemanticPreflight(
  capabilityResolution: CapabilityResolutionReport,
  capabilities: CapabilityAuthorityRecord[],
  frozen: boolean,
  unknownSourceDiscovery: UnknownSourceDiscovery,
): SemanticPreflight {
  const selected = capabilityResolution.selected
    .map((match) => capabilities.find((capability) => capability.CapabilityId === match.capabilityId))
    .filter((capability): capability is CapabilityAuthorityRecord => !!capability);
  const dependencies = selected.flatMap((capability) => getDependents(capability.OwnerModule).map((edge) => ({
    ownerModule: capability.OwnerModule,
    dependent: edge.source,
    target: edge.target,
    kind: edge.kind,
    source: edge.source_generated === "infra-dependency-graph" ? ("infra-dependency-graph" as const) : ("auto-dependency-graph" as const),
  })));
  const map = loadArchifyRuntimeMap();
  const runtimeEvidence: SemanticPreflightRuntimeEvidence[] = [...unknownSourceDiscovery.runtimeEvidence];
  const unknowns: string[] = [...unknownSourceDiscovery.unknowns];

  if (capabilityResolution.overallClass === "UNKNOWN" && capabilityResolution.selected.length === 0) {
    unknowns.push("UNKNOWN: Capability Resolver selected no frozen capability; source discovery is read-only context evidence and does not change capability authority.");
  }

  if (!map) {
    unknowns.push("UNKNOWN: Archify Runtime Relationship Map is unavailable; no runtime relationship was inferred.");
  } else {
    for (const edge of map.edges ?? []) {
      const edgeText = [edge.from, edge.to, edge.via, edge.source, edge.evidence, edge.note].filter(Boolean).join(" ");
      if (!selected.some((capability) => edgeText.includes(capability.OwnerModule))) continue;
      runtimeEvidence.push({
        classification: edge.classification ?? "UNKNOWN",
        relationship: `${edge.from ?? "UNKNOWN"} -> ${edge.to ?? "UNKNOWN"}${edge.via ? ` via ${edge.via}` : ""}`,
        evidence: edge.evidence ?? edge.source ?? edge.note ?? "No evidence detail was recorded.",
      });
    }
    if (runtimeEvidence.length === 0) {
      unknowns.push("UNKNOWN: Archify contains no runtime edge directly attributable to the selected capability OwnerModule(s); no runtime ownership or traffic relationship was inferred.");
    }
  }

  const authorityBoundaries = [
    `Capability ownership is read from frozen registry/capability-registry.json (frozen=${frozen}).`,
    "Dependency impact is read through engines/workspace/dependencyRegistry.ts, which composes auto-dependency-graph.json with infra-dependency-graph.json.",
    "Any external connector Run remains gated by core/connector-loader.ts#requireConnector() and the Connect -> Register -> Test -> Enable -> Run lifecycle; this read-only preflight never bypasses or invokes that gate.",
  ];
  const constraints = [
    "No registry, database, controller, or canonical writer is created by Semantic Preflight.",
    "Owner approval and existing Context Plan scope gates remain required before a Worker receives context or any file change executes.",
    "Post-change verification remains the existing execute -> review -> test flow.",
  ];
  const sourceFingerprint = sha256Hex(JSON.stringify({
    capabilityIds: selected.map((capability) => capability.CapabilityId), frozen,
    dependencies: dependencies.map((dependency) => `${dependency.dependent}->${dependency.target}:${dependency.source}`),
    runtimeEvidence: runtimeEvidence.map((evidence) => `${evidence.classification}:${evidence.relationship}`),
    unknowns,
  }));
  return {
    status: unknowns.length > 0 ? "UNKNOWN" : "READY",
    capabilityAuthority: {
      registry: "registry/capability-registry.json",
      frozen,
      capabilities: selected.map((capability) => ({
        capabilityId: capability.CapabilityId,
        ownerModule: capability.OwnerModule,
        exportName: capability.ExportName,
        mutability: capability.Mutability,
        status: capability.Status,
        authority: "FROZEN_CAPABILITY_REGISTRY",
      })),
    },
    dependencies,
    runtimeEvidence,
    authorityBoundaries,
    constraints,
    unknowns,
    sourceFingerprint,
  };
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
  const registry = JSON.parse(readFileSync(path.join(ROOT, "registry/capability-registry.json"), "utf-8")) as { frozen: boolean; capabilities: CapabilityAuthorityRecord[] };
  const capById = new Map(registry.capabilities.map((c) => [c.CapabilityId, c]));
  const unknownSourceDiscovery = discoverUnknownSources(
    capabilityResolution.intentKeywords,
    capabilityResolution.overallClass === "UNKNOWN" && capabilityResolution.selected.length === 0 && changedFiles.length === 0,
  );
  const semanticPreflight = buildSemanticPreflight(capabilityResolution, registry.capabilities, registry.frozen, unknownSourceDiscovery);

  const candidates: { file: string; reason: string }[] = [];
  for (const m of capabilityResolution.selected) {
    const cap = capById.get(m.capabilityId);
    if (cap) candidates.push({ file: cap.OwnerModule, reason: `real OwnerModule of selected Capability ${m.capabilityId}` });
  }
  candidates.push(...unknownSourceDiscovery.candidates);
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
    requiredTests: ["existing Workspace execute -> review -> test flow"],
    requiredEvidence: ["real Capability Resolution Report", "real Dependency Registry impact analysis", "Archify Runtime Relationship Map evidence classifications (or explicit UNKNOWN)", "real Change Set (if any files are being written)"],
    semanticPreflight,
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

/** Real, minimum-context Context Plan constructor (Software Factory
 * Readiness gap fill — Job Contract minimum context, 2026-08-09). Unlike
 * buildContextPlan() above, this NEVER expands via the Capability
 * Registry or the Architecture Book's dependency graph — it includes
 * ONLY the literal files a Job Contract's own permittedReadScope names,
 * nothing else. This is the real, minimum-context delivery path for a
 * scoped Worker task (Job Contract) that must not see the repo beyond
 * what it was explicitly given. Reuses the exact same real
 * isExcludedName/MAX_INCLUDED_FILES/existence checks as
 * buildContextPlan() — never a second, weaker safety check. */
export function buildMinimalContextPlan(
  workspaceSessionId: string, ownerId: string, actor: string,
  permittedReadScope: string[], permittedWriteScope: string[],
): ContextPlan {
  const includedFiles: ContextFileEntry[] = [];
  const excludedFiles: { path: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const file of permittedReadScope) {
    if (seen.has(file)) continue;
    seen.add(file);
    const segments = file.split("/");
    const isExcluded = segments.some((seg, i) => isExcludedName(seg, i < segments.length - 1));
    if (isExcluded) { excludedFiles.push({ path: file, reason: "matches a real, already-enforced fsSecurity.ts exclusion pattern (.env/secret/credential/node_modules/etc.)" }); continue; }
    const absPath = path.join(ROOT, file);
    if (!existsSync(absPath)) { excludedFiles.push({ path: file, reason: "real file does not exist on disk" }); continue; }
    if (includedFiles.length >= MAX_INCLUDED_FILES) { excludedFiles.push({ path: file, reason: `real MAX_INCLUDED_FILES (${MAX_INCLUDED_FILES}) scope guard reached — never send the whole repo` }); continue; }
    const size = statSync(absPath).size;
    includedFiles.push({ path: file, reason: "real, literal file named in this Job Contract's permittedReadScope — never dependency-graph-expanded", sizeBytes: size });
  }

  const sizeBytes = includedFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
  const tokenEstimate = Math.round(sizeBytes / 4);
  const forbiddenPaths = [".env", ".env.local", "**/*.pem", "**/*.key", "**/*credential*", "**/*secret*", "node_modules/**", ".git/**"];
  const sourceFingerprint = sha256Hex(includedFiles.map((f) => `${f.path}:${f.sizeBytes}`).sort().join("|"));

  const contextPlanId = randomUUID();
  const plan: ContextPlan = {
    contextPlanId, workspaceSessionId, includedFiles, excludedFiles, forbiddenPaths,
    permittedReadScope: includedFiles.map((f) => f.path), permittedWriteScope,
    requiredContracts: [], requiredTests: [], requiredEvidence: ["real Job Contract (minimum-context path — no Capability Resolver, no dependency-graph expansion)"],
    semanticPreflight: {
      status: "UNKNOWN",
      capabilityAuthority: { registry: "registry/capability-registry.json", frozen: true, capabilities: [] },
      dependencies: [], runtimeEvidence: [],
      authorityBoundaries: ["Job Contract minimum-context flow does not perform Capability Resolution or dependency-graph expansion."],
      constraints: ["No runtime relationship was inferred for this minimum-context path."],
      unknowns: ["UNKNOWN: Job Contract minimum-context path intentionally bypasses Semantic Preflight because no Capability Resolution exists."],
      sourceFingerprint: sha256Hex("job-contract-minimum-context-semantic-preflight-unknown"),
    },
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
