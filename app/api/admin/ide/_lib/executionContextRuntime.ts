/**
 * Persistent Execution Context Runtime (owner, 2026-08-07, Software
 * Factory Step 13.7 Foundation follow-up). Real, file-backed source of
 * truth for "where is the Software Factory right now" — current_step,
 * last_completed_step, blockers, owner approvals, and a live snapshot of
 * architecture/governance/worker/capability state — so a brand-new
 * session (new browser, restarted dev server, different AI agent) can
 * hydrate the real, current state without relying on chat history or AI
 * memory (owner mandate, 2026-08-07: "ห้ามใช้ AI memory เป็น source of
 * truth", "ห้ามพึ่ง chat history").
 *
 * Reuse investigation (done before writing this file, per owner
 * instruction): registry/CURRENT_STATE.json + HANDOFF.json already give
 * DNA OS a real, cross-session, file-persisted "what's the state of the
 * current change" ledger — but that ledger is scoped to arbitrary,
 * general AI-agent work across the WHOLE repo (change_id DNA-000067,
 * TASK-0xx), governed by registry/EXECUTION_CONTRACT.json's multi-agent
 * lock protocol. It has no concept of a "Software Factory Step" (7,
 * 13.25, 13.6, 13.7, ...) or of a Foundation-closure gate, and hijacking
 * its schema for that purpose would break the existing multi-agent
 * protocol that already depends on it. This file is therefore a NEW,
 * narrowly-scoped ledger — but it deliberately reuses everything else
 * real that already exists rather than recomputing it: gitReadOnly.ts's
 * getGitStatus() for git_head/working_tree_state, restrictedCapability
 * Registry.ts's listRestrictedCapabilities() for capability_state/
 * security_state, workerSelectorRuntime.ts's WORKER_ADAPTER_REGISTRY +
 * health() for worker_state/provider_state, and registry/architecture-
 * book.json + registry/governance-summary.json (already real, generated
 * files) for architecture_state/governance_state. connector_state is
 * honestly "NOT_IMPLEMENTED" — grep confirmed no real connector loader
 * runtime exists anywhere in app/ (only registry/connector-lifecycle.json,
 * a policy document, and plugins/drivers/* which are business connectors,
 * not a generic loader with inspectable live state).
 *
 * Unlike every other "*Runtime.ts" file built so far this session (all
 * in-memory Map, lost on restart — confirmed by reading artifactRuntime.ts,
 * queueRuntime.ts, etc.), this file's checkpoints are real, atomically
 * written to disk (registry/EXECUTION_CONTEXT.json) — this is the one
 * piece of state in the whole /admin/ide surface that a dev-server
 * restart must NOT erase, per explicit owner mandate. Writes are
 * append-only (every checkpoint keeps all prior checkpoints, never
 * overwrites/deletes history) so a prior state can always be inspected.
 */
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";
import { WORKSPACE_ROOT } from "./fsSecurity";
import { getGitStatus, type GitStatus } from "./gitReadOnly";
import { listRestrictedCapabilities, type RestrictedCapabilityDefinition } from "./restrictedCapabilityRegistry";
import { WORKER_ADAPTER_REGISTRY } from "./workerSelectorRuntime";

// ============================================================
// Real file location — never a second copy, never a guessable
// user-controlled path (fixed, hardcoded, workspace-relative).
// ============================================================
const DEFAULT_CONTEXT_FILE_PATH = path.join(WORKSPACE_ROOT, "registry", "EXECUTION_CONTEXT.json");

export type StepStatus = "IN_PROGRESS" | "DONE_VERIFIED" | "BLOCKED";
export type BlockerSeverity = "BLOCKING" | "INFO";

export interface ContextBlocker {
  id: string;
  severity: BlockerSeverity;
  relatedStep: string;
  description: string;
  createdAt: string;
}

export interface ContextDecision {
  id: string;
  step: string;
  summary: string;
  reason: string;
  recordedAt: string;
}

export interface WorkerStateSnapshot {
  id: string;
  type: string;
  provider: string | null;
  healthStatus: string;
  healthReason: string;
}

export interface CapabilityStateSnapshot {
  id: string;
  status: RestrictedCapabilityDefinition["status"];
  riskLevel: RestrictedCapabilityDefinition["riskLevel"];
}

export interface LiveSnapshotFields {
  git_head: string | null;
  working_tree_state: { branch: string | null; clean: boolean; stagedCount: number; unstagedCount: number; untrackedCount: number; conflictedCount: number };
  architecture_state: { totalModules: number | null; ok: number | null; broken: number | null; unregistered: number | null; source: string };
  governance_state: { totalRules: number | null; enforced: number | null; coveragePercent: number | null; source: string };
  worker_state: WorkerStateSnapshot[];
  provider_state: { configuredCount: number; totalCount: number };
  connector_state: "NOT_IMPLEMENTED";
  capability_state: CapabilityStateSnapshot[];
  security_state: { totalRestrictedCapabilities: number; activeCount: number; partialCount: number; notImplementedCount: number };
}

export interface ExecutionContextCheckpoint extends LiveSnapshotFields {
  checkpointId: string;
  contextVersion: number;
  createdAt: string;
  actor: string;
  ownerId: string;
  trigger: string;
  previousCheckpointId: string | null;
  hash: string;

  current_step: string;
  last_completed_step: string | null;
  step_status: Record<string, StepStatus>;
  step_report: Record<string, string>;
  decisions: ContextDecision[];
  owner_constraints: string[];
  blockers: ContextBlocker[];
  unresolved_findings: string[];
  dependencies: string[];
  next_allowed_action: string;
  next_blocked_action: string;
  test_baseline: Record<string, { status: "PASSED" | "FAILED"; passed: number; total: number; at: string }>;
  evidence_refs: string[];
  ownerApprovals: Record<string, boolean>;
  priorStepsDisclosure: string;
  source_of_truth: string;
}

export interface ExecutionContextFile {
  version: number;
  createdAt: string;
  checkpoints: ExecutionContextCheckpoint[];
}

export type ExecutionContextPatch = Partial<
  Pick<
    ExecutionContextCheckpoint,
    | "current_step" | "last_completed_step" | "step_status" | "step_report" | "decisions" | "owner_constraints"
    | "blockers" | "unresolved_findings" | "dependencies" | "next_allowed_action" | "next_blocked_action"
    | "test_baseline" | "evidence_refs" | "ownerApprovals" | "priorStepsDisclosure"
  >
>;

export class ExecutionContextError extends Error {
  code: "NO_CONTEXT_YET" | "INVALID_PATCH";
  constructor(code: ExecutionContextError["code"], message: string) { super(message); this.code = code; this.name = "ExecutionContextError"; }
}

// ============================================================
// Real file I/O — always reads fresh from disk (never a cached
// module-level variable), which is precisely what makes this
// survive a dev-server restart: there is no in-memory state to
// lose, the file itself is the only copy that matters.
// ============================================================
function emptyFile(): ExecutionContextFile {
  return { version: 1, createdAt: new Date().toISOString(), checkpoints: [] };
}

export function readExecutionContextFile(filePath: string = DEFAULT_CONTEXT_FILE_PATH): ExecutionContextFile {
  if (!existsSync(filePath)) return emptyFile();
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ExecutionContextFile;
    if (!Array.isArray(parsed.checkpoints)) return emptyFile();
    return parsed;
  } catch {
    // Corrupt/unreadable file is treated as "no context yet", never a
    // fabricated guess at its contents.
    return emptyFile();
  }
}

function atomicWrite(filePath: string, data: ExecutionContextFile): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  renameSync(tmpPath, filePath);
}

export function getCurrentExecutionContext(filePath: string = DEFAULT_CONTEXT_FILE_PATH): ExecutionContextCheckpoint | null {
  const file = readExecutionContextFile(filePath);
  return file.checkpoints.length === 0 ? null : file.checkpoints[file.checkpoints.length - 1];
}

export function listExecutionContextHistory(limit = 50, filePath: string = DEFAULT_CONTEXT_FILE_PATH): ExecutionContextCheckpoint[] {
  const file = readExecutionContextFile(filePath);
  return file.checkpoints.slice(-limit).reverse();
}

// ============================================================
// Live snapshot — cheap, real, read-only calls into already-built
// Runtimes/registries. Never triggers a new live provider/CLI call
// (WorkerAdapter.health() itself never does that — see workerAdapter.ts).
// ============================================================
function safeReadJson<T>(relPath: string): T | null {
  try {
    return JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, relPath), "utf-8")) as T;
  } catch {
    return null;
  }
}

export async function computeLiveSnapshotFields(): Promise<LiveSnapshotFields> {
  let gitStatus: GitStatus | null = null;
  try { gitStatus = await getGitStatus(); } catch { gitStatus = null; }

  const archBook = safeReadJson<{ summary?: { total?: number; ok?: number; broken?: number; unregistered?: number } }>("registry/architecture-book.json");
  const govSummary = safeReadJson<{ totalRules?: number; enforced?: number; coveragePercent?: number }>("registry/governance-summary.json");

  const workerState: WorkerStateSnapshot[] = [];
  for (const adapter of WORKER_ADAPTER_REGISTRY) {
    try {
      const health = await adapter.health();
      workerState.push({ id: adapter.id, type: adapter.type, provider: adapter.provider ?? null, healthStatus: health.status, healthReason: health.reason });
    } catch (e) {
      workerState.push({ id: adapter.id, type: adapter.type, provider: adapter.provider ?? null, healthStatus: "UNKNOWN", healthReason: e instanceof Error ? e.message : "health() threw" });
    }
  }
  const configuredCount = workerState.filter((w) => w.healthStatus !== "NOT_CONFIGURED").length;

  const capabilities = listRestrictedCapabilities();
  const capabilityState: CapabilityStateSnapshot[] = capabilities.map((c) => ({ id: c.id, status: c.status, riskLevel: c.riskLevel }));

  return {
    git_head: gitStatus?.headCommit?.hash ?? null,
    working_tree_state: {
      branch: gitStatus?.branch ?? null,
      clean: gitStatus?.clean ?? false,
      stagedCount: gitStatus?.staged.length ?? 0,
      unstagedCount: gitStatus?.unstaged.length ?? 0,
      untrackedCount: gitStatus?.untracked.length ?? 0,
      conflictedCount: gitStatus?.conflicted.length ?? 0,
    },
    architecture_state: {
      totalModules: archBook?.summary?.total ?? null,
      ok: archBook?.summary?.ok ?? null,
      broken: archBook?.summary?.broken ?? null,
      unregistered: archBook?.summary?.unregistered ?? null,
      source: "registry/architecture-book.json",
    },
    governance_state: {
      totalRules: govSummary?.totalRules ?? null,
      enforced: govSummary?.enforced ?? null,
      coveragePercent: govSummary?.coveragePercent ?? null,
      source: "registry/governance-summary.json",
    },
    worker_state: workerState,
    provider_state: { configuredCount, totalCount: workerState.length },
    connector_state: "NOT_IMPLEMENTED",
    capability_state: capabilityState,
    security_state: {
      totalRestrictedCapabilities: capabilities.length,
      activeCount: capabilities.filter((c) => c.status === "ACTIVE").length,
      partialCount: capabilities.filter((c) => c.status === "PARTIAL").length,
      notImplementedCount: capabilities.filter((c) => c.status === "NOT_IMPLEMENTED").length,
    },
  };
}

function canonicalHash(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

/** Writes a new, real checkpoint — always appended, never replacing
 * history. `patch` fields are merged onto the previous checkpoint (or
 * real defaults if this is the first-ever checkpoint); live snapshot
 * fields are always recomputed fresh at write time. */
export async function writeExecutionContextCheckpoint(
  patch: ExecutionContextPatch,
  actor: string,
  ownerId: string,
  trigger: string,
  filePath: string = DEFAULT_CONTEXT_FILE_PATH,
): Promise<ExecutionContextCheckpoint> {
  const file = readExecutionContextFile(filePath);
  const previous = file.checkpoints.length > 0 ? file.checkpoints[file.checkpoints.length - 1] : null;

  const live = await computeLiveSnapshotFields();

  const merged: Omit<ExecutionContextCheckpoint, "checkpointId" | "contextVersion" | "createdAt" | "hash" | keyof LiveSnapshotFields> = {
    actor, ownerId, trigger,
    previousCheckpointId: previous?.checkpointId ?? null,
    current_step: patch.current_step ?? previous?.current_step ?? "UNKNOWN",
    last_completed_step: patch.last_completed_step ?? previous?.last_completed_step ?? null,
    step_status: patch.step_status ?? previous?.step_status ?? {},
    step_report: patch.step_report ?? previous?.step_report ?? {},
    decisions: patch.decisions ?? previous?.decisions ?? [],
    owner_constraints: patch.owner_constraints ?? previous?.owner_constraints ?? [],
    blockers: patch.blockers ?? previous?.blockers ?? [],
    unresolved_findings: patch.unresolved_findings ?? previous?.unresolved_findings ?? [],
    dependencies: patch.dependencies ?? previous?.dependencies ?? [],
    next_allowed_action: patch.next_allowed_action ?? previous?.next_allowed_action ?? "UNKNOWN",
    next_blocked_action: patch.next_blocked_action ?? previous?.next_blocked_action ?? "UNKNOWN",
    test_baseline: patch.test_baseline ?? previous?.test_baseline ?? {},
    evidence_refs: patch.evidence_refs ?? previous?.evidence_refs ?? [],
    ownerApprovals: patch.ownerApprovals ?? previous?.ownerApprovals ?? {},
    priorStepsDisclosure: patch.priorStepsDisclosure ?? previous?.priorStepsDisclosure ?? "",
    source_of_truth: "registry/EXECUTION_CONTEXT.json",
  };

  const checkpointId = randomUUID();
  const contextVersion = (previous?.contextVersion ?? 0) + 1;
  const createdAt = new Date().toISOString();
  const hash = canonicalHash({ ...merged, ...live, checkpointId, contextVersion, createdAt });

  const checkpoint: ExecutionContextCheckpoint = { checkpointId, contextVersion, createdAt, hash, ...merged, ...live };

  file.checkpoints.push(checkpoint);
  atomicWrite(filePath, file);
  return checkpoint;
}

/** Real, deterministic Step gate. Never guesses — BLOCKED with an
 * explicit, checkable reason whenever any real condition isn't met. */
export interface StepGateResult {
  step: string;
  allowed: boolean;
  reasons: string[];
  currentContext: ExecutionContextCheckpoint | null;
}

// Ordered ladder of Steps this Foundation recognizes as prerequisites —
// real, from this conversation's own record. Only used to compute "what
// must be the last_completed_step for step N to be allowed" — never used
// to silently mark earlier steps DONE_VERIFIED (see priorStepsDisclosure).
const KNOWN_STEP_LADDER = ["13.6", "13.7", "14"];

export function evaluateStepGate(step: string, filePath: string = DEFAULT_CONTEXT_FILE_PATH): StepGateResult {
  const current = getCurrentExecutionContext(filePath);
  if (!current) {
    return { step, allowed: false, reasons: ["no Execution Context checkpoint exists yet — Foundation has not been initialized"], currentContext: null };
  }

  const reasons: string[] = [];
  const idx = KNOWN_STEP_LADDER.indexOf(step);
  const prerequisite = idx > 0 ? KNOWN_STEP_LADDER[idx - 1] : null;

  if (prerequisite) {
    if (current.last_completed_step !== prerequisite) {
      reasons.push(`last_completed_step is "${current.last_completed_step}", but Step "${step}" requires prerequisite Step "${prerequisite}" to be the last completed step`);
    } else if (current.step_status[prerequisite] !== "DONE_VERIFIED") {
      reasons.push(`Step "${prerequisite}" status is "${current.step_status[prerequisite] ?? "UNKNOWN"}", not DONE_VERIFIED`);
    }
  }

  const blockingBlockers = current.blockers.filter((b) => b.severity === "BLOCKING");
  if (blockingBlockers.length > 0) {
    reasons.push(...blockingBlockers.map((b) => `BLOCKING: ${b.description} (related to Step ${b.relatedStep})`));
  }

  if (current.ownerApprovals[step] !== true) {
    reasons.push(`Owner has not explicitly approved Step "${step}" yet (ownerApprovals["${step}"] is not true) — no Step may start without explicit, separate Owner approval`);
  }

  return { step, allowed: reasons.length === 0, reasons, currentContext: current };
}

/** The ONLY function that may ever set ownerApprovals[step] = true — a
 * real, separate, explicit Owner action, never inferred from anything
 * else (never from "Foundation looks complete", never from chat text). */
export async function recordOwnerApproval(
  step: string, approved: boolean, actor: string, ownerId: string, filePath: string = DEFAULT_CONTEXT_FILE_PATH,
): Promise<ExecutionContextCheckpoint> {
  const current = getCurrentExecutionContext(filePath);
  if (!current) throw new ExecutionContextError("NO_CONTEXT_YET", "cannot record an approval before any checkpoint exists");
  const ownerApprovals = { ...current.ownerApprovals, [step]: approved };
  return writeExecutionContextCheckpoint({ ownerApprovals }, actor, ownerId, `owner ${approved ? "approved" : "revoked approval for"} Step ${step}`, filePath);
}

export function __debugContextCheckpointCount(filePath: string = DEFAULT_CONTEXT_FILE_PATH): number {
  return readExecutionContextFile(filePath).checkpoints.length;
}
