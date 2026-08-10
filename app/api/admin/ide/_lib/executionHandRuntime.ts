/**
 * EXECUTION_HAND Runtime (owner, 2026-08-09, Constitution Rule 258 —
 * "EXECUTION_HAND (Minimal-Context Back Office Execution Worker)" — real
 * build, TASK-049). Full contract text: workers/execution-hand/ROLE.md +
 * CONTRACT.md (declarative workspace scaffolding, already created by
 * MANAGER-07). This file is the real enforcement those documents describe.
 *
 * EXECUTION_HAND is deliberately NOT another entry in workerRegistry.ts's
 * 10 WorkerType taxonomy and NOT a 7th Department under workers/ (Rule
 * 256, Capability-First Expansion — no new hierarchy without a real
 * runtime-boundary reason). It is a narrower, ad-hoc primitive: a direct
 * hand of MANAGER-07 whose entire job is RECEIVE -> EXECUTE -> RETURN
 * EVIDENCE, nothing else. Its Job Contract input has exactly 10 required
 * fields (CONTRACT.md, verbatim): task_id, operation, scope, allowed_paths,
 * forbidden_paths, tools_allowed, dependencies, expected_output,
 * acceptance_criteria, max_attempts. A missing/incomplete field is a real,
 * honest BLOCKED — never interpreted, guessed, or defaulted ("ห้ามตีความ
 * เพิ่มเอง").
 *
 * REUSE INVENTORY (Constitution Rule 101/103, done before writing this
 * file — every item below is a real, already-existing mechanism composed
 * here, never re-implemented):
 *  - Path-scope enforcement mirrors codeWorkerRuntime.ts#validateOperationScope
 *    exactly (same fsSecurity.ts#isExcludedName / isHighRiskInfraPath
 *    checks) — generalized from a single permittedWriteScope array to this
 *    Job Contract's allowed_paths/forbidden_paths pair.
 *  - Real file mutation primitives are the SAME functions the /admin/ide
 *    Explorer/Editor already use and already have real, passing coverage:
 *    fsOps.ts#createFile/createFolder/moveEntry, fileWrite.ts#writeFileAtomic
 *    (+ detectNewlineInfo/applyNewlineInfo for EDIT_FILE), fsSecurity.ts#
 *    resolveSafeRelativePath/looksBinary. Never a second write path.
 *  - RUN_COMMAND/RUN_TEST/BUILD reuse executionRegistry.ts's real
 *    isCommandDenied() (rm/git-push/curl/etc. denylist) and
 *    buildChildEnv() (secret-redacted child env — never the raw
 *    process.env) — the exact same defense-in-depth this repo's real
 *    Terminal execution path already relies on, applied here as a second,
 *    independent layer on top of this file's own tools_allowed gate.
 *  - Cost gating for RUN_COMMAND/INSTALL_PACKAGE/BUILD (the 3 operation
 *    types that could plausibly cost real money or hit a paid provider)
 *    reuses costGateRuntime.ts#checkCostGate() verbatim (Rule 257) — this
 *    file never re-implements a second cost check, and honors a LOCK
 *    outcome as a real BLOCKED, never overridden. As of the Rule 257
 *    AMENDMENT (2026-08-09, FCR-011/TASK-050), this file also passes its
 *    Job Contract's own real `command`/`args` fields straight through to
 *    checkCostGate() (runCostGateCheck() below), so a real, closed-
 *    allowlist FREE_LOCAL command (e.g. `bash scripts/governance.sh`,
 *    `git status`) releases without a pre-approved budget — never a
 *    self-declared cost_class, always computed by the gate itself from
 *    the exact command/args about to reach runChildCommand().
 *  - Lock discipline reuses the exact JSON read-modify-write CONTRACT
 *    registry/LOCK_MANAGER.json documents (append an entry to acquire,
 *    remove it entirely to release) — the same discipline
 *    registryWriterRuntime.ts#acquireLock/releaseLock already implements
 *    for a different writer identity. NOT imported directly from that
 *    file: registryWriterRuntime.ts hardcodes its own WRITER_IDENTITY
 *    ("factory-architecture-advisor...") baked into its acquireLock, so a
 *    direct import would misattribute every EXECUTION_HAND lock to that
 *    other identity in the ledger — a real, disclosed honesty concern,
 *    not a style preference. This file re-implements the identical
 *    protocol under EXECUTION_HAND's own identity instead of importing a
 *    function whose identity is hardcoded to someone else.
 *
 * STRUCTURAL GUARANTEES (Rule 258's hard restrictions — proved by
 * scripts/execution-hand-test.ts using the same import-graph-scan
 * technique already used for Rules 251/252/257, each with a positive
 * control proving the scan is meaningful, never vacuous):
 *  1. Cannot ask the Owner directly: this file never imports
 *     managerQuestionRuntime.ts's two Owner-facing-only exports
 *     (getOwnerFacingQueue/answerAggregatedQuestion). The one Owner-bound
 *     path reachable from here is transitive, through costGateRuntime.ts's
 *     already-established, legitimate LOCK-escalation call to
 *     submitWorkerQuestion() (the real, single Worker-facing ask surface
 *     Rule 251 defines) — never a second, direct ask invented here.
 *  2. Cannot dispatch other Workers: this file never imports
 *     workerTaskOrchestrator.ts#runScopedWorkerJob or
 *     switchBasedOrchestratorRuntime.ts#attemptDispatch (the two real
 *     dispatch-into-other-Workers entry points in this codebase).
 *  3. Cannot read the full Registry/Constitution/CURRENT_STATE: the ONLY
 *     registry/*.json file this module ever opens is
 *     registry/LOCK_MANAGER.json (meta-infrastructure for the lock
 *     protocol itself, not Registry business content — the same file
 *     registryWriterRuntime.ts also touches alongside its real target).
 *     There is no readdirSync/glob over registry/ anywhere in this file.
 *     registry/CONSTITUTION.json and registry/CURRENT_STATE.json are
 *     additionally hard-denied by isDeniedRegistryGovernanceScope() below
 *     even if a Job Contract's own allowed_paths mistakenly named them —
 *     defense in depth, the same "refused regardless of scope" pattern
 *     codeWorkerRuntime.ts already uses for high-risk infra paths.
 *     HONEST LIMITATION (disclosed, not overclaimed — see this task's own
 *     report): this is the one guarantee that cannot be proven as a pure
 *     type-system fact the way "never returns PASS" can. The real proof
 *     here is behavioral (a real Job Contract naming these paths is
 *     really refused, with real evidence, before any read occurs) plus a
 *     real, whole-repo grep for wildcard/wholesale registry reads in THIS
 *     file, with a positive control (managerQuestionRuntime.ts really
 *     does read both files wholesale, and scripts/compatibility-test.ts
 *     really does readdirSync the whole registry/ directory) proving the
 *     detection pattern actually catches a real instance elsewhere.
 *  4. Cannot create its own work: task_id and operation are read verbatim
 *     from the Job Contract's own JSON, or the job is BLOCKED — this file
 *     never calls randomUUID()/crypto to fabricate a task_id and never
 *     defaults contract.operation to any value.
 *  5. Cannot self-declare PASS: ExecutionHandStatus is a closed TypeScript
 *     union of exactly "EXECUTED" | "FAILED" | "BLOCKED" — a real,
 *     compiler-enforced guarantee, not just discipline — and the literal
 *     string "PASS" never appears anywhere in this file as a status value
 *     (verified by grep in the acceptance suite, with workerTaskOrchestrator.ts's
 *     real WorkerJobStatus, which DOES include "PASS", as the positive
 *     control). acceptance_criteria evaluation below is intentionally a
 *     small, LOCAL, EXECUTION_HAND-only re-implementation of just the
 *     FILE_EXISTS/FILE_CONTAINS/FILE_NOT_CONTAINS shapes
 *     acceptanceContractRuntime.ts also recognizes — NOT a reuse of that
 *     file's evaluateAcceptanceContract(), on purpose: that function (a)
 *     requires real TestRun/BuildRun/ChangeSet evidence objects tied to
 *     the full multi-stage factory pipeline EXECUTION_HAND is deliberately
 *     narrower than, and (b) its own return shape literally includes the
 *     string "overall: PASS", which would make the "PASS never appears in
 *     this file" grep proof depend on trusting that the value is never
 *     propagated rather than being mechanically absent. Re-implementing a
 *     tiny subset locally keeps guarantee 5 trivially, mechanically true.
 *     A FAILED here is a narrow, mechanical, evidence-based fact ("the
 *     command exited 2", "the required substring is not in the file") —
 *     never a holistic quality judgment. That broader judgment stays
 *     MANAGER-07/a Validator's alone, made after reading the evidence this
 *     file returns.
 *
 * HONEST, DISCLOSED DESIGN CHOICES (Rule 100/106/109/110 — declare gaps,
 * never overclaim):
 *  - CONTRACT.md's 10 required fields are the Job Contract's governance
 *    envelope (scope/permissions/bookkeeping) — they do not by themselves
 *    carry concrete operation parameters (which exact file, what content,
 *    which exact command). Rule 258's own text does not name a field for
 *    these. This file accepts them as OPTIONAL, operation-specific extra
 *    properties on the same JSON object (target_path, destination_path,
 *    content, old_import, new_import, command, args, package_name) that
 *    are NOT part of the 10-field BLOCKED check (their absence never
 *    triggers "missing required field"), but whose absence for an
 *    operation that genuinely needs them still refuses the job outright
 *    (BLOCKED, "never attempted") rather than guessing a value. This is a
 *    real, disclosed interpretation of an underspecified area of the
 *    spec, not a silent assumption.
 *  - max_attempts retries the IDENTICAL operation with no self-correction
 *    in between (EXECUTION_HAND has no judgment/LLM loop, per Rule 258) —
 *    a deterministically-failing operation (e.g. a command that always
 *    exits non-zero) will fail identically on every attempt and honestly
 *    report FAILED after the last one, never fabricating an eventual
 *    success.
 *  - tools_allowed gating convention (CONTRACT.md doesn't spell out exact
 *    string matching, so this is a disclosed, conservative choice): for
 *    the 6 filesystem operations, tools_allowed must contain the
 *    operation's own literal name (e.g. "CREATE_FILE"). For
 *    INSTALL_PACKAGE/RUN_COMMAND/RUN_TEST/BUILD, tools_allowed must
 *    contain the literal executable basename about to run (e.g. "npm",
 *    "npx") — this is the consequential gate: a Job Contract that only
 *    grants "RUN_COMMAND" in the abstract can never let this file run an
 *    arbitrary, un-named binary.
 *  - STATUS.json step-6 mirror: workers/execution-hand/STATUS.json's own
 *    text says "Only MANAGER-07 writes this file, never EXECUTION_HAND
 *    itself." Rule 258 simultaneously lists "(6) return to STANDBY
 *    (mirrored into STATUS.json)" as a literal step of EXECUTION_HAND's
 *    own 6-step protocol, and TASK-049 asks this file to implement that
 *    step. There is no separate MANAGER-07 process in this codebase to
 *    perform a second, independent write — the resolution taken here
 *    (disclosed, not silently picked): writeExecutionHandStatusMirror()
 *    below is called by runExecutionHandJobFromInbox() — the outer
 *    RECEIVE->EXECUTE->RETURN-EVIDENCE->STANDBY cycle wrapper, standing in
 *    for "MANAGER-07 reads the real result, then mirrors status" — never
 *    by executeJobContract() itself (the inner, pure execution function),
 *    which never touches STATUS.json. This keeps the distinction real:
 *    the JUDGMENT-FREE inner executor cannot flip its own status flag;
 *    only the outer orchestration boundary can.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, promises as fsp } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  WORKSPACE_ROOT, resolveSafeRelativePath, isExcludedName, isHighRiskInfraPath, looksBinary, IdeFsError,
} from "./fsSecurity";
import { createFile as fsCreateFile, createFolder as fsCreateFolder, moveEntry as fsMoveEntry } from "./fsOps";
import { writeFileAtomic, detectNewlineInfo, applyNewlineInfo } from "./fileWrite";
import { isCommandDenied, buildChildEnv } from "./executionRegistry";
import { checkCostGate, type CostGateOutcome, type CostGateOutcomeKind } from "./costGateRuntime";

const execFileAsync = promisify(execFile);
const ROOT = WORKSPACE_ROOT;

const EXECUTION_HAND_DIR = path.join(ROOT, "workers", "execution-hand");
const INBOX_DIR = path.join(EXECUTION_HAND_DIR, "INBOX");
const WORK_DIR = path.join(EXECUTION_HAND_DIR, "WORK");
const OUTBOX_DIR = path.join(EXECUTION_HAND_DIR, "OUTBOX");
const EVIDENCE_DIR = path.join(EXECUTION_HAND_DIR, "EVIDENCE");
const STATUS_PATH = path.join(EXECUTION_HAND_DIR, "STATUS.json");
const LOCK_MANAGER_PATH = path.join(ROOT, "registry", "LOCK_MANAGER.json");

// ============================================================
// Types — Job Contract (CONTRACT.md, verbatim 10 required fields)
// ============================================================
export const EXECUTION_HAND_OPERATIONS = [
  "CREATE_FILE", "EDIT_FILE", "MOVE_FILE", "CREATE_FOLDER", "INSTALL_PACKAGE",
  "UPDATE_IMPORT", "RUN_COMMAND", "RUN_TEST", "BUILD", "GENERATE_ARTIFACT",
] as const;
export type ExecutionHandOperation = (typeof EXECUTION_HAND_OPERATIONS)[number];

/** Real, closed terminal-state union — EXECUTION_HAND never declares PASS
 * (Rule 258). This is a compiler-enforced guarantee: no exported function
 * in this file can be typed to return anything else. */
export type ExecutionHandStatus = "EXECUTED" | "FAILED" | "BLOCKED";

export interface ExecutionHandJobContract {
  task_id: string;
  operation: ExecutionHandOperation;
  scope: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  tools_allowed: string[];
  dependencies: string[];
  expected_output: string;
  acceptance_criteria: string[];
  max_attempts: number;
  // Real, operation-specific payload — see this file's header for why
  // these are NOT part of the 10-field BLOCKED check.
  target_path?: string;
  destination_path?: string;
  content?: string;
  old_import?: string;
  new_import?: string;
  command?: string;
  args?: string[];
  package_name?: string;
}

const REQUIRED_JOB_CONTRACT_FIELDS = [
  "task_id", "operation", "scope", "allowed_paths", "forbidden_paths",
  "tools_allowed", "dependencies", "expected_output", "acceptance_criteria", "max_attempts",
] as const;

export interface JobContractValidationOk { ok: true; contract: ExecutionHandJobContract }
export interface JobContractValidationBlocked { ok: false; missingFields: string[] }

/** Real, strict Job Contract shape validator. Any missing, wrong-typed, or
 * empty required field is reported by name — never inferred, guessed, or
 * defaulted (CONTRACT.md: "ห้ามตีความเพิ่มเอง"). Extra, operation-specific
 * properties (target_path/content/command/...) pass through untouched. */
export function validateJobContract(raw: unknown): JobContractValidationOk | JobContractValidationBlocked {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, missingFields: [...REQUIRED_JOB_CONTRACT_FIELDS] };
  }
  const obj = raw as Record<string, unknown>;
  const missing: string[] = [];
  const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

  if (typeof obj.task_id !== "string" || obj.task_id.trim() === "") missing.push("task_id");
  if (typeof obj.operation !== "string" || !(EXECUTION_HAND_OPERATIONS as readonly string[]).includes(obj.operation)) missing.push("operation");
  if (typeof obj.scope !== "string" || obj.scope.trim() === "") missing.push("scope");
  if (!isStringArray(obj.allowed_paths)) missing.push("allowed_paths");
  if (!isStringArray(obj.forbidden_paths)) missing.push("forbidden_paths");
  if (!isStringArray(obj.tools_allowed)) missing.push("tools_allowed");
  if (!isStringArray(obj.dependencies)) missing.push("dependencies");
  if (typeof obj.expected_output !== "string" || obj.expected_output.trim() === "") missing.push("expected_output");
  if (!isStringArray(obj.acceptance_criteria)) missing.push("acceptance_criteria");
  if (typeof obj.max_attempts !== "number" || !Number.isInteger(obj.max_attempts) || obj.max_attempts < 1) missing.push("max_attempts");

  if (missing.length > 0) return { ok: false, missingFields: missing };
  return { ok: true, contract: obj as unknown as ExecutionHandJobContract };
}

// ============================================================
// Evidence + Result shapes — modeled on workerTaskOrchestrator.ts's real
// WorkerJobResult/AttemptRecord shape (same field philosophy: evidence
// array + status + counts + timestamps) but with a genuinely different,
// narrower status union — never the same WorkerJobStatus type, which
// includes "PASS".
// ============================================================
export interface ExecutionHandEvidenceItem {
  kind: "FILE_DIFF" | "COMMAND_RESULT" | "REFUSAL" | "ACCEPTANCE_CHECK";
  detail: string;
  path: string | null;
  before: string | null;
  after: string | null;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  capturedAt: string;
}

export interface ExecutionHandResult {
  task_id: string | null;
  operation: string | null;
  status: ExecutionHandStatus;
  reason: string;
  missingFields: string[];
  attemptsUsed: number;
  maxAttempts: number | null;
  evidence: ExecutionHandEvidenceItem[];
  lockAcquired: boolean;
  lockReleased: boolean;
  costGateOutcome: CostGateOutcomeKind | null;
  evidenceFilePath: string | null;
  computedAt: string;
}

function evidenceOf(kind: ExecutionHandEvidenceItem["kind"], detail: string, extra: Partial<ExecutionHandEvidenceItem> = {}): ExecutionHandEvidenceItem {
  return { kind, detail, path: null, before: null, after: null, stdout: null, stderr: null, exitCode: null, capturedAt: new Date().toISOString(), ...extra };
}

// ============================================================
// Path-scope enforcement — mirrors codeWorkerRuntime.ts#validateOperationScope
// (same fsSecurity.ts exclusion + high-risk-infra reuse), generalized to
// allowed_paths/forbidden_paths.
// ============================================================
function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function pathCoveredBy(relPath: string, entry: string): boolean {
  const e = normalizeRelPath(entry);
  if (relPath === e) return true;
  return relPath.startsWith(`${e}/`);
}

/** Real, hard, defense-in-depth denylist for Rule 258's two explicitly
 * named "must not read wholesale" files, and for a Job Contract that
 * (mistakenly or not) tries to grant the entire registry/ directory as a
 * blanket scope. Refused REGARDLESS of what allowed_paths says — the same
 * "refused regardless of scope" pattern fsSecurity.ts#isHighRiskInfraPath
 * already uses for DB migrations/CI-CD/infra. */
function isDeniedRegistryGovernanceScope(relPath: string): boolean {
  if (relPath === "registry") return true;
  if (relPath === "registry/CONSTITUTION.json" || relPath === "registry/CURRENT_STATE.json") return true;
  return false;
}

export interface PathScopeCheck { ok: boolean; reason: string }

/** Real path-scope check every operation runs BEFORE touching the
 * filesystem — the literal "act only inside allowed_paths" step (2) of
 * CONTRACT.md's execution protocol. Never reads the target path's content
 * before this check passes. */
export function isPathWithinAllowedScope(rawPath: string, contract: Pick<ExecutionHandJobContract, "allowed_paths" | "forbidden_paths">): PathScopeCheck {
  if (typeof rawPath !== "string" || rawPath.length === 0) return { ok: false, reason: "empty/invalid path" };
  if (path.isAbsolute(rawPath)) return { ok: false, reason: "absolute paths are never accepted — allowed_paths/forbidden_paths only ever match workspace-relative paths" };
  const relPath = normalizeRelPath(rawPath);
  if (relPath.split("/").includes("..")) return { ok: false, reason: "real path traversal sequence detected" };

  if (isDeniedRegistryGovernanceScope(relPath)) {
    return { ok: false, reason: `real path "${relPath}" matches Rule 258's hard registry-governance denylist (whole registry/, or the full CONSTITUTION.json/CURRENT_STATE.json) — refused regardless of allowed_paths` };
  }

  const segments = relPath.split("/");
  if (segments.some((seg, i) => isExcludedName(seg, i < segments.length - 1))) {
    return { ok: false, reason: "real path matches a real, already-enforced fsSecurity.ts exclusion pattern (reused from codeWorkerRuntime.ts#validateOperationScope)" };
  }
  if (isHighRiskInfraPath(relPath)) {
    return { ok: false, reason: "real path matches the high-risk infra denylist (DB migration / CI-CD / infra-as-code / deploy config) — refused regardless of allowed_paths (reused from fsSecurity.ts)" };
  }

  if (contract.forbidden_paths.some((f) => pathCoveredBy(relPath, f))) {
    return { ok: false, reason: `real path "${relPath}" is explicitly listed in forbidden_paths` };
  }
  if (!contract.allowed_paths.some((a) => pathCoveredBy(relPath, a))) {
    return { ok: false, reason: `real path "${relPath}" is outside allowed_paths — never attempted` };
  }
  return { ok: true, reason: "path is within allowed_paths and not forbidden" };
}

// ============================================================
// Lock discipline — same real JSON read-modify-write protocol
// registry/LOCK_MANAGER.json documents, under EXECUTION_HAND's own
// identity (see file header for why this is not a direct import of
// registryWriterRuntime.ts's identity-bound acquireLock/releaseLock).
// ============================================================
const LOCK_IDENTITY = "EXECUTION_HAND";

interface LockEntry { file: string; held_by: string; acquired_at: string }
interface LockManagerFile { version: number; protocol: string; note: string; rule: string; locks: LockEntry[] }

function readLockManagerFile(): LockManagerFile {
  return JSON.parse(readFileSync(LOCK_MANAGER_PATH, "utf-8")) as LockManagerFile;
}
function writeLockManagerFile(data: LockManagerFile): void {
  writeFileSync(LOCK_MANAGER_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export interface ScopeLockResult { acquired: boolean; reason?: string }

/** Step (1) of CONTRACT.md's protocol — lock `scope` before touching
 * anything. Real append-to-locks[] acquire, per LOCK_MANAGER.json's own
 * documented contract. */
export function acquireScopeLock(scope: string): ScopeLockResult {
  const data = readLockManagerFile();
  const existing = data.locks.find((l) => l.file === scope && l.held_by !== LOCK_IDENTITY);
  if (existing) return { acquired: false, reason: `scope "${scope}" already locked by ${existing.held_by} since ${existing.acquired_at}` };
  const alreadyMine = data.locks.some((l) => l.file === scope && l.held_by === LOCK_IDENTITY);
  if (!alreadyMine) {
    data.locks.push({ file: scope, held_by: LOCK_IDENTITY, acquired_at: new Date().toISOString() });
    writeLockManagerFile(data);
  }
  return { acquired: true };
}

/** Step (5) of CONTRACT.md's protocol — release the lock. Removes the
 * entry entirely (never just marks it idle), per LOCK_MANAGER.json's own
 * rule ("a stale entry blocks nobody but confuses the next reader"). */
export function releaseScopeLock(scope: string): void {
  const data = readLockManagerFile();
  data.locks = data.locks.filter((l) => !(l.file === scope && l.held_by === LOCK_IDENTITY));
  writeLockManagerFile(data);
}

// ============================================================
// Cost Gate integration (Rule 257) — reused verbatim, never re-implemented.
// ============================================================
const COST_GATED_OPERATIONS = new Set<ExecutionHandOperation>(["RUN_COMMAND", "INSTALL_PACKAGE", "BUILD"]);

function runCostGateCheck(contract: ExecutionHandJobContract, ownerId: string, actor: string): CostGateOutcome {
  return checkCostGate({
    provider: "execution-hand-local-shell",
    operation: contract.operation,
    // Honest, safety-conservative default: a Job Contract carries no cost
    // estimate field (not one of Rule 258's 10 fields), so this is
    // genuinely UNKNOWN_COST (null), never guessed/assumed as 0.
    estimated_cost: null,
    currency: "USD",
    max_cost: null,
    reason: `EXECUTION_HAND job ${contract.task_id}: ${contract.expected_output}`,
    task_id: contract.task_id,
    worker_id: "EXECUTION_HAND",
    evidence: [contract.scope],
    ownerId,
    actor,
    // Rule 257 AMENDMENT (2026-08-09, FCR-011/TASK-050) — the EXACT same
    // command/args this Job Contract is about to reach opShellCommand's
    // real runChildCommand() with (never a separately-declared cost
    // signal), so checkCostGate() can classify FREE_LOCAL/UNKNOWN_COST
    // from the real command text itself.
    command: contract.command,
    args: contract.args,
  });
}

// ============================================================
// Local, EXECUTION_HAND-only acceptance-criteria mini-evaluator — see
// file header (guarantee 5) for why this does NOT reuse
// acceptanceContractRuntime.ts#evaluateAcceptanceContract.
// ============================================================
export interface LocalCriterionCheck { raw: string; recognized: boolean; met: boolean | null; detail: string }

export function evaluateLocalAcceptanceCriteria(acceptanceCriteria: string[]): LocalCriterionCheck[] {
  return acceptanceCriteria.map((raw) => {
    const parts = raw.split("::").map((p) => p.trim());
    const prefix = parts[0];
    if (prefix === "FILE_EXISTS" && parts.length === 2 && parts[1]) {
      const exists = existsSync(path.join(ROOT, parts[1]));
      return { raw, recognized: true, met: exists, detail: exists ? `real file exists at ${parts[1]}` : `real file does not exist at ${parts[1]}` };
    }
    if ((prefix === "FILE_CONTAINS" || prefix === "FILE_NOT_CONTAINS") && parts.length === 3 && parts[1] && parts[2]) {
      const abs = path.join(ROOT, parts[1]);
      if (!existsSync(abs)) {
        const met = prefix === "FILE_NOT_CONTAINS";
        return { raw, recognized: true, met, detail: `real file does not exist at ${parts[1]}${met ? " — vacuously satisfied" : ""}` };
      }
      const content = readFileSync(abs, "utf-8");
      const has = content.includes(parts[2]);
      const met = prefix === "FILE_CONTAINS" ? has : !has;
      return { raw, recognized: true, met, detail: met ? `real file ${parts[1]} satisfies "${raw}"` : `real file ${parts[1]} does not satisfy "${raw}"` };
    }
    return { raw, recognized: false, met: null, detail: "not a recognized machine-checkable shape for EXECUTION_HAND — informational only, MANAGER-07/a Validator judges this one" };
  });
}

// ============================================================
// Operation executors — each returns ok / a terminal hint (BLOCKED = never
// attempted, FAILED = attempted but did not succeed) / a human reason, and
// pushes real evidence. Every one runs its own tools_allowed + path-scope
// check FIRST, before any filesystem/process access.
// ============================================================
interface OpOutcome { ok: boolean; terminal?: "BLOCKED" | "FAILED"; reason: string }

function blocked(evidence: ExecutionHandEvidenceItem[], reason: string, path_: string | null = null): OpOutcome {
  evidence.push(evidenceOf("REFUSAL", reason, { path: path_ }));
  return { ok: false, terminal: "BLOCKED", reason };
}

function requireTool(contract: ExecutionHandJobContract, evidence: ExecutionHandEvidenceItem[], toolName: string): OpOutcome | null {
  if (!contract.tools_allowed.includes(toolName)) {
    return blocked(evidence, `tools_allowed does not include the concrete tool "${toolName}" required for operation ${contract.operation} — refused before any real action`);
  }
  return null;
}

function requireScope(contract: ExecutionHandJobContract, evidence: ExecutionHandEvidenceItem[], targetPath: string | undefined, label: string): { outcome: OpOutcome | null; relPath: string } {
  if (!targetPath) return { outcome: blocked(evidence, `operation payload missing '${label}' for ${contract.operation} (not one of Rule 258's 10 governance fields, but required to execute — never guessed)`), relPath: "" };
  const check = isPathWithinAllowedScope(targetPath, contract);
  if (!check.ok) return { outcome: blocked(evidence, check.reason, targetPath), relPath: targetPath };
  return { outcome: null, relPath: targetPath };
}

async function opCreateFile(contract: ExecutionHandJobContract, evidence: ExecutionHandEvidenceItem[]): Promise<OpOutcome> {
  const toolGate = requireTool(contract, evidence, "CREATE_FILE");
  if (toolGate) return toolGate;
  const { outcome, relPath } = requireScope(contract, evidence, contract.target_path, "target_path");
  if (outcome) return outcome;
  if (contract.content === undefined) return blocked(evidence, "operation payload missing 'content' for CREATE_FILE (use an empty string to explicitly create an empty file)", relPath);
  try {
    const created = await fsCreateFile(relPath);
    const absPath = path.join(ROOT, created.relPath);
    if (contract.content.length > 0) await writeFileAtomic(absPath, Buffer.from(contract.content, "utf-8"));
    evidence.push(evidenceOf("FILE_DIFF", `real file created at ${created.relPath}`, { path: created.relPath, before: null, after: contract.content }));
    return { ok: true, reason: `real file created at ${created.relPath}` };
  } catch (e) {
    const reason = e instanceof IdeFsError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    evidence.push(evidenceOf("REFUSAL", `real CREATE_FILE failed: ${reason}`, { path: relPath }));
    return { ok: false, terminal: "FAILED", reason: `real CREATE_FILE failed: ${reason}` };
  }
}

async function opEditFile(contract: ExecutionHandJobContract, evidence: ExecutionHandEvidenceItem[]): Promise<OpOutcome> {
  const toolGate = requireTool(contract, evidence, "EDIT_FILE");
  if (toolGate) return toolGate;
  const { outcome, relPath } = requireScope(contract, evidence, contract.target_path, "target_path");
  if (outcome) return outcome;
  if (contract.content === undefined) return blocked(evidence, "operation payload missing 'content' for EDIT_FILE", relPath);
  try {
    const safe = await resolveSafeRelativePath(relPath);
    const buf = readFileSync(safe.absPath);
    if (looksBinary(buf)) {
      evidence.push(evidenceOf("REFUSAL", "real file looks binary — EDIT_FILE refuses binary content", { path: relPath }));
      return { ok: false, terminal: "FAILED", reason: `real EDIT_FILE refused: "${relPath}" looks binary` };
    }
    const before = buf.toString("utf-8");
    const newline = detectNewlineInfo(buf);
    const outContent = newline ? applyNewlineInfo(contract.content, newline) : contract.content;
    const stat = await fsp.stat(safe.absPath);
    await writeFileAtomic(safe.absPath, Buffer.from(outContent, "utf-8"), stat.mode);
    evidence.push(evidenceOf("FILE_DIFF", `real file edited at ${relPath}`, { path: relPath, before, after: contract.content }));
    return { ok: true, reason: `real file edited at ${relPath}` };
  } catch (e) {
    const reason = e instanceof IdeFsError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    evidence.push(evidenceOf("REFUSAL", `real EDIT_FILE failed: ${reason}`, { path: relPath }));
    return { ok: false, terminal: "FAILED", reason: `real EDIT_FILE failed: ${reason}` };
  }
}

async function opMoveFile(contract: ExecutionHandJobContract, evidence: ExecutionHandEvidenceItem[]): Promise<OpOutcome> {
  const toolGate = requireTool(contract, evidence, "MOVE_FILE");
  if (toolGate) return toolGate;
  const src = requireScope(contract, evidence, contract.target_path, "target_path");
  if (src.outcome) return src.outcome;
  const dest = requireScope(contract, evidence, contract.destination_path, "destination_path");
  if (dest.outcome) return dest.outcome;
  try {
    const result = await fsMoveEntry(src.relPath, dest.relPath);
    evidence.push(evidenceOf("FILE_DIFF", `real ${result.itemType} moved from ${result.sourceRelPath} to ${result.destRelPath}`, { path: result.destRelPath, before: result.sourceRelPath, after: result.destRelPath }));
    return { ok: true, reason: `real move ${result.sourceRelPath} -> ${result.destRelPath}` };
  } catch (e) {
    const reason = e instanceof IdeFsError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    evidence.push(evidenceOf("REFUSAL", `real MOVE_FILE failed: ${reason}`, { path: src.relPath }));
    return { ok: false, terminal: "FAILED", reason: `real MOVE_FILE failed: ${reason}` };
  }
}

async function opCreateFolder(contract: ExecutionHandJobContract, evidence: ExecutionHandEvidenceItem[]): Promise<OpOutcome> {
  const toolGate = requireTool(contract, evidence, "CREATE_FOLDER");
  if (toolGate) return toolGate;
  const { outcome, relPath } = requireScope(contract, evidence, contract.target_path, "target_path");
  if (outcome) return outcome;
  try {
    const created = await fsCreateFolder(relPath);
    evidence.push(evidenceOf("FILE_DIFF", `real folder created at ${created.relPath}`, { path: created.relPath, before: null, after: "directory" }));
    return { ok: true, reason: `real folder created at ${created.relPath}` };
  } catch (e) {
    const reason = e instanceof IdeFsError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    evidence.push(evidenceOf("REFUSAL", `real CREATE_FOLDER failed: ${reason}`, { path: relPath }));
    return { ok: false, terminal: "FAILED", reason: `real CREATE_FOLDER failed: ${reason}` };
  }
}

async function opUpdateImport(contract: ExecutionHandJobContract, evidence: ExecutionHandEvidenceItem[]): Promise<OpOutcome> {
  const toolGate = requireTool(contract, evidence, "UPDATE_IMPORT");
  if (toolGate) return toolGate;
  const { outcome, relPath } = requireScope(contract, evidence, contract.target_path, "target_path");
  if (outcome) return outcome;
  if (!contract.old_import || contract.new_import === undefined) return blocked(evidence, "operation payload missing 'old_import'/'new_import' for UPDATE_IMPORT", relPath);
  try {
    const safe = await resolveSafeRelativePath(relPath);
    const before = readFileSync(safe.absPath, "utf-8");
    if (!before.includes(contract.old_import)) {
      evidence.push(evidenceOf("REFUSAL", `real old_import string not found in ${relPath} — nothing changed`, { path: relPath }));
      return { ok: false, terminal: "FAILED", reason: `real UPDATE_IMPORT failed: old_import string not found in ${relPath}` };
    }
    const after = before.replace(contract.old_import, contract.new_import);
    const stat = await fsp.stat(safe.absPath);
    await writeFileAtomic(safe.absPath, Buffer.from(after, "utf-8"), stat.mode);
    evidence.push(evidenceOf("FILE_DIFF", `real import updated in ${relPath}`, { path: relPath, before, after }));
    return { ok: true, reason: `real import updated in ${relPath}` };
  } catch (e) {
    const reason = e instanceof IdeFsError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    evidence.push(evidenceOf("REFUSAL", `real UPDATE_IMPORT failed: ${reason}`, { path: relPath }));
    return { ok: false, terminal: "FAILED", reason: `real UPDATE_IMPORT failed: ${reason}` };
  }
}

async function opGenerateArtifact(contract: ExecutionHandJobContract, evidence: ExecutionHandEvidenceItem[]): Promise<OpOutcome> {
  const toolGate = requireTool(contract, evidence, "GENERATE_ARTIFACT");
  if (toolGate) return toolGate;
  const { outcome, relPath } = requireScope(contract, evidence, contract.target_path, "target_path");
  if (outcome) return outcome;
  if (contract.content === undefined) return blocked(evidence, "operation payload missing 'content' for GENERATE_ARTIFACT", relPath);
  try {
    const created = await fsCreateFile(relPath);
    const absPath = path.join(ROOT, created.relPath);
    if (contract.content.length > 0) await writeFileAtomic(absPath, Buffer.from(contract.content, "utf-8"));
    evidence.push(evidenceOf("FILE_DIFF", `real artifact generated at ${created.relPath}`, { path: created.relPath, before: null, after: contract.content }));
    return { ok: true, reason: `real artifact generated at ${created.relPath}` };
  } catch (e) {
    const reason = e instanceof IdeFsError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    evidence.push(evidenceOf("REFUSAL", `real GENERATE_ARTIFACT failed: ${reason}`, { path: relPath }));
    return { ok: false, terminal: "FAILED", reason: `real GENERATE_ARTIFACT failed: ${reason}` };
  }
}

async function runChildCommand(executable: string, args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, { cwd: ROOT, env: buildChildEnv() as NodeJS.ProcessEnv, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
    return { exitCode: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string; message: string };
    return { exitCode: typeof err.code === "number" ? err.code : null, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message };
  }
}

async function opShellCommand(contract: ExecutionHandJobContract, evidence: ExecutionHandEvidenceItem[]): Promise<OpOutcome> {
  const command = contract.command;
  if (!command) return blocked(evidence, `operation payload missing 'command' for ${contract.operation} (not one of Rule 258's 10 governance fields, but required to execute — never guessed)`);
  const args = contract.args ?? [];
  const basename = command.split("/").pop() ?? command;
  const toolGate = requireTool(contract, evidence, basename);
  if (toolGate) return toolGate;
  const deny = isCommandDenied(command, args);
  if (deny.denied) return blocked(evidence, `Command Policy denylist refused this command (reused from executionRegistry.ts#isCommandDenied): ${deny.reason}`);

  const { exitCode, stdout, stderr } = await runChildCommand(command, args);
  evidence.push(evidenceOf("COMMAND_RESULT", `real command "${command} ${args.join(" ")}" exited ${exitCode ?? "null"}`, { stdout, stderr, exitCode }));
  if (exitCode === 0) return { ok: true, reason: `real command "${command} ${args.join(" ")}" exited 0` };
  return { ok: false, terminal: "FAILED", reason: `real command "${command} ${args.join(" ")}" exited ${exitCode ?? "null (spawn/timeout error)"}` };
}

async function opInstallPackage(contract: ExecutionHandJobContract, evidence: ExecutionHandEvidenceItem[]): Promise<OpOutcome> {
  const toolGate = requireTool(contract, evidence, "npm");
  if (toolGate) return toolGate;
  if (!contract.package_name) return blocked(evidence, "operation payload missing 'package_name' for INSTALL_PACKAGE");
  if (!/^[a-zA-Z0-9@][a-zA-Z0-9@/_.-]*$/.test(contract.package_name)) {
    return blocked(evidence, `real package_name "${contract.package_name}" contains characters outside the safe npm-package-name pattern — refused, never passed to a shell`);
  }
  const { exitCode, stdout, stderr } = await runChildCommand("npm", ["install", contract.package_name]);
  evidence.push(evidenceOf("COMMAND_RESULT", `real "npm install ${contract.package_name}" exited ${exitCode ?? "null"}`, { stdout, stderr, exitCode }));
  if (exitCode === 0) return { ok: true, reason: `real "npm install ${contract.package_name}" succeeded` };
  return { ok: false, terminal: "FAILED", reason: `real "npm install ${contract.package_name}" exited ${exitCode ?? "null"}` };
}

// ============================================================
// Dispatch — routes to the executor named by contract.operation ONLY
// (never any other operation), one arm per EXECUTION_HAND_OPERATIONS
// entry, exhaustive by construction.
// ============================================================
async function dispatchOperation(contract: ExecutionHandJobContract, evidence: ExecutionHandEvidenceItem[]): Promise<OpOutcome> {
  switch (contract.operation) {
    case "CREATE_FILE": return opCreateFile(contract, evidence);
    case "EDIT_FILE": return opEditFile(contract, evidence);
    case "MOVE_FILE": return opMoveFile(contract, evidence);
    case "CREATE_FOLDER": return opCreateFolder(contract, evidence);
    case "UPDATE_IMPORT": return opUpdateImport(contract, evidence);
    case "GENERATE_ARTIFACT": return opGenerateArtifact(contract, evidence);
    case "INSTALL_PACKAGE": return opInstallPackage(contract, evidence);
    case "RUN_COMMAND": return opShellCommand(contract, evidence);
    case "RUN_TEST": return opShellCommand(contract, evidence);
    case "BUILD": return opShellCommand(contract, evidence);
    default: {
      const _exhaustive: never = contract.operation;
      return blocked(evidence, `unrecognized operation ${String(_exhaustive)}`);
    }
  }
}

function buildResult(input: {
  task_id: string | null; operation: string | null; status: ExecutionHandStatus; reason: string;
  missingFields: string[]; attemptsUsed: number; maxAttempts: number | null; evidence: ExecutionHandEvidenceItem[];
  lockAcquired: boolean; lockReleased: boolean; costGateOutcome: CostGateOutcomeKind | null;
}): ExecutionHandResult {
  return { ...input, evidenceFilePath: null, computedAt: new Date().toISOString() };
}

function safeString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// ============================================================
// THE 6-STEP PROTOCOL — the real, pure orchestration function. Never
// touches INBOX/WORK/OUTBOX/EVIDENCE or STATUS.json itself (see file
// header for why STATUS.json is written one layer up, by
// runExecutionHandJobFromInbox).
// ============================================================
export async function executeJobContract(raw: unknown, options: { ownerId: string; actor?: string }): Promise<ExecutionHandResult> {
  const actor = options.actor ?? "EXECUTION_HAND";
  const rawTaskId = typeof raw === "object" && raw !== null ? safeString((raw as Record<string, unknown>).task_id) : null;
  const rawOperation = typeof raw === "object" && raw !== null ? safeString((raw as Record<string, unknown>).operation) : null;

  const validation = validateJobContract(raw);
  if (!validation.ok) {
    return buildResult({
      task_id: rawTaskId, operation: rawOperation, status: "BLOCKED",
      reason: `Job Contract missing/invalid required field(s): ${validation.missingFields.join(", ")} — never inferred, guessed, or defaulted (CONTRACT.md: "ห้ามตีความเพิ่มเอง")`,
      missingFields: validation.missingFields, attemptsUsed: 0, maxAttempts: null, evidence: [],
      lockAcquired: false, lockReleased: false, costGateOutcome: null,
    });
  }
  const contract = validation.contract;
  const evidence: ExecutionHandEvidenceItem[] = [];

  // Step (1) — lock scope before touching anything.
  const lock = acquireScopeLock(contract.scope);
  if (!lock.acquired) {
    evidence.push(evidenceOf("REFUSAL", `could not acquire lock on scope "${contract.scope}": ${lock.reason}`));
    return buildResult({
      task_id: contract.task_id, operation: contract.operation, status: "BLOCKED",
      reason: `real lock contention — ${lock.reason}`, missingFields: [], attemptsUsed: 0, maxAttempts: contract.max_attempts,
      evidence, lockAcquired: false, lockReleased: false, costGateOutcome: null,
    });
  }

  let costGateOutcome: CostGateOutcomeKind | null = null;
  let result: ExecutionHandResult;
  try {
    // Cost Gate (Rule 257) — before actually running RUN_COMMAND/
    // INSTALL_PACKAGE/BUILD, never after.
    if (COST_GATED_OPERATIONS.has(contract.operation)) {
      const gate = runCostGateCheck(contract, options.ownerId, actor);
      costGateOutcome = gate.outcome;
      evidence.push(evidenceOf("REFUSAL", `Cost Gate decision for ${contract.operation}: ${gate.outcome} — ${gate.reason}`));
    }

    if (costGateOutcome === "LOCK") {
      result = buildResult({
        task_id: contract.task_id, operation: contract.operation, status: "BLOCKED",
        reason: `Cost Gate LOCKED this ${contract.operation} — real financial approval required before it may run: ${evidence[evidence.length - 1].detail}`,
        missingFields: [], attemptsUsed: 0, maxAttempts: contract.max_attempts, evidence,
        lockAcquired: true, lockReleased: false, costGateOutcome,
      });
    } else {
      // Steps (2)+(3) — act only inside allowed_paths, capture real
      // evidence. max_attempts retries the identical operation with no
      // self-correction (see file header — a disclosed, honest limitation).
      let attemptsUsed = 0;
      let last: OpOutcome = { ok: false, terminal: "FAILED", reason: "never attempted" };
      while (attemptsUsed < contract.max_attempts) {
        attemptsUsed += 1;
        try {
          last = await dispatchOperation(contract, evidence);
        } catch (e) {
          last = { ok: false, terminal: "FAILED", reason: `real, unexpected execution error: ${e instanceof Error ? e.message : String(e)}` };
          evidence.push(evidenceOf("REFUSAL", last.reason));
        }
        if (last.ok || last.terminal === "BLOCKED") break;
      }

      if (last.ok) {
        // Real, local, mechanical acceptance-criteria check (guarantee 5 —
        // never a holistic PASS/FAIL judgment, just falsifiable facts).
        const checks = evaluateLocalAcceptanceCriteria(contract.acceptance_criteria);
        for (const c of checks) {
          evidence.push(evidenceOf("ACCEPTANCE_CHECK", `${c.raw} -> ${c.recognized ? (c.met ? "met" : "NOT MET") : "not machine-checkable by EXECUTION_HAND"}`));
        }
        const unmet = checks.filter((c) => c.recognized && c.met === false);
        if (unmet.length > 0) {
          result = buildResult({
            task_id: contract.task_id, operation: contract.operation, status: "FAILED",
            reason: `operation completed but ${unmet.length} real, machine-checkable acceptance criterion/criteria were NOT met: ${unmet.map((u) => u.raw).join("; ")}`,
            missingFields: [], attemptsUsed, maxAttempts: contract.max_attempts, evidence,
            lockAcquired: true, lockReleased: false, costGateOutcome,
          });
        } else {
          result = buildResult({
            task_id: contract.task_id, operation: contract.operation, status: "EXECUTED",
            reason: last.reason, missingFields: [], attemptsUsed, maxAttempts: contract.max_attempts, evidence,
            lockAcquired: true, lockReleased: false, costGateOutcome,
          });
        }
      } else {
        result = buildResult({
          task_id: contract.task_id, operation: contract.operation, status: last.terminal ?? "FAILED",
          reason: last.reason, missingFields: [], attemptsUsed, maxAttempts: contract.max_attempts, evidence,
          lockAcquired: true, lockReleased: false, costGateOutcome,
        });
      }
    }
  } finally {
    // Step (5) — release the lock, always, regardless of outcome.
    releaseScopeLock(contract.scope);
  }
  // The lock is now really, provably released (the finally block above
  // already ran) — reflect that real fact in the returned result, rather
  // than the hardcoded `false` each branch above had to use before the
  // release actually happened.
  result.lockReleased = true;
  return result;
}

// ============================================================
// STATUS.json mirror — see file header for the disclosed step-6
// interpretation. Called only from runExecutionHandJobFromInbox(), never
// from executeJobContract() itself.
// ============================================================
interface ExecutionHandStatusFile { worker_id: string; status: string; note: string; last_synced_from_registry: string }

function writeExecutionHandStatusMirror(status: "STANDBY" | "EXECUTING", note: string): void {
  const file: ExecutionHandStatusFile = {
    worker_id: "EXECUTION_HAND",
    status,
    note: `${note} — this is a workspace MIRROR, not a second source of truth (same convention as workers/worker-01-connector/STATUS.json). Written by the outer RECEIVE->EXECUTE->RETURN-EVIDENCE->STANDBY cycle wrapper after reading EXECUTION_HAND's own real result, never by executeJobContract() itself.`,
    last_synced_from_registry: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(STATUS_PATH, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}

export function readExecutionHandStatusMirror(): ExecutionHandStatusFile {
  return JSON.parse(readFileSync(STATUS_PATH, "utf-8")) as ExecutionHandStatusFile;
}

// ============================================================
// INBOX / WORK / OUTBOX / EVIDENCE file convention.
// ============================================================
export function listInboxJobContracts(): string[] {
  return readdirSync(INBOX_DIR).filter((f) => f.endsWith(".json"));
}

function clearWorkDir(): void {
  for (const f of readdirSync(WORK_DIR)) {
    if (f === "README.md") continue;
    unlinkSync(path.join(WORK_DIR, f));
  }
}

/** Real, full RECEIVE->EXECUTE->RETURN-EVIDENCE->STANDBY cycle: reads a
 * Job Contract JSON from INBOX/, stages a real scratch copy in WORK/
 * (cleared afterward — never a durable store), executes it, writes the
 * real result to OUTBOX/ and real evidence to EVIDENCE/, then mirrors
 * STANDBY into STATUS.json. */
export async function runExecutionHandJobFromInbox(inboxFileName: string, options: { ownerId: string; actor?: string }): Promise<ExecutionHandResult> {
  const inboxPath = path.join(INBOX_DIR, inboxFileName);
  const raw: unknown = JSON.parse(readFileSync(inboxPath, "utf-8"));

  writeFileSync(path.join(WORK_DIR, inboxFileName), `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
  writeExecutionHandStatusMirror("EXECUTING", `processing ${inboxFileName}`);

  let result: ExecutionHandResult;
  try {
    result = await executeJobContract(raw, options);
  } finally {
    clearWorkDir();
  }

  result.lockReleased = true;
  const stamp = Date.now();
  const safeTaskId = (result.task_id ?? "UNKNOWN_TASK").replace(/[^a-zA-Z0-9_.-]/g, "_");

  const outboxFileName = `${safeTaskId}-result-${stamp}.json`;
  writeFileSync(path.join(OUTBOX_DIR, outboxFileName), `${JSON.stringify(result, null, 2)}\n`, "utf-8");

  const evidenceFileName = `${safeTaskId}-evidence-${stamp}.json`;
  writeFileSync(path.join(EVIDENCE_DIR, evidenceFileName), `${JSON.stringify(result.evidence, null, 2)}\n`, "utf-8");
  result.evidenceFilePath = `workers/execution-hand/EVIDENCE/${evidenceFileName}`;

  writeExecutionHandStatusMirror("STANDBY", `completed ${inboxFileName} -> ${result.status}`);
  return result;
}

// ============================================================
// Debug/test-only helpers — same convention as this repo's other
// Runtimes (contextPlannerRuntime.ts's __debugContextPlanCount / etc.).
// ============================================================
export function __debugClearExecutionHandLock(scope: string): void {
  releaseScopeLock(scope);
}
export function __debugClearOutboxAndEvidence(fileNames: { outbox: string[]; evidence: string[] }): void {
  for (const f of fileNames.outbox) { const p = path.join(OUTBOX_DIR, f); if (existsSync(p)) unlinkSync(p); }
  for (const f of fileNames.evidence) { const p = path.join(EVIDENCE_DIR, f); if (existsSync(p)) unlinkSync(p); }
}
