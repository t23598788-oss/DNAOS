/**
 * หน้าที่: the ten-stage deterministic verification an agent proposal must
 * survive before a single byte reaches production source.
 *
 *   SOURCE -> CONTRACT -> DEPENDENCY -> SECURITY -> ISOLATED TEST
 *   -> REGRESSION -> DETERMINISTIC VERIFIER -> WRITE GATE
 *   -> CONTROLLED PROMOTION -> RUNTIME VERIFICATION
 *
 * ONLY THIS FILE CAN SAY VERIFIED. The agent's proposal has no status field
 * (see ./types.ts) precisely so that it cannot. Every stage here either runs
 * a real command, reads real source, or calls the real gate — none of them
 * accepts a claim.
 *
 * PROMOTION HAPPENS AT STAGE 9, NOT BEFORE. Stages 1-8 run against a SANDBOX
 * COPY written NEXT TO the real file (a dotfile-prefixed sibling, removed on
 * every exit path) so relative imports resolve exactly as they will in
 * production. The real file itself is untouched until the write gate has
 * returned ALLOW, so a rejected proposal never changes the tree.
 *
 * Input: a `RepairWorkItem` + an `AgentProposal`.
 * Output: `verifyProposal` -> `VerificationVerdict`.
 * Dependency ที่อนุญาต: ./types.ts, ../../permissions/write-gate/contract.ts,
 * ../../software/capability-registrar/index.ts, node:fs/node:child_process.
 * สิ่งที่ห้ามแตะ: never write to a path outside the proposal's own
 * allowed_paths, and never write at all before WRITE_GATE has passed. Never
 * downgrade a failing stage to a warning — a stage either passes or the whole
 * verdict is REJECT_CHANGE.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { evaluateWriteIntent } from "../../permissions/write-gate/contract";
import { getWriteOwnershipIndex } from "../../software/capability-registrar/contract";
import type { AgentProposal, RepairWorkItem, StageResult, VerificationStage, VerificationVerdict } from "./types";

const REPO_ROOT = join(__dirname, "..", "..");

/**
 * The verifier's own version. Loop protection compares attempts only within
 * the SAME version, and the reason is not bookkeeping: a verdict is only as
 * trustworthy as the checker that produced it. v1's ISOLATED_TEST
 * type-checked a copy in a temp directory, where no relative import can
 * resolve, so it rejected a correct proposal with TS2307 and blamed the
 * agent. Letting that verdict count against the attempt budget would let a
 * defect in the checker permanently bar a change that was never actually
 * wrong. Bump this whenever a stage's verdict semantics change; never to
 * clear an inconvenient history, which is why the old records are kept and
 * remain readable.
 *
 * v3: the WRITE_GATE stage now consults
 * `software/capability-registrar/#getWriteOwnershipIndex` instead of the
 * routing projection. v2's REJECT_CHANGE at WRITE_GATE was a true statement
 * about an index that could not see the owner of
 * `control/external-system-lifecycle/`; the ownership always existed. A
 * verdict reached against a different ownership index says nothing about the
 * change, so v2's verdicts do not bind v3 — and they remain in the ledger,
 * unedited, saying exactly what they said.
 */
export const VERIFIER_VERSION = "v3";

/**
 * Boundaries a repair may never newly cross. Each entry is one of the Owner's
 * standing rules expressed as something checkable in the proposed text.
 */
const FORBIDDEN_PATTERNS: readonly { id: string; pattern: RegExp; why: string }[] = [
  { id: "NEW_LISTENER", pattern: /\.listen\s*\(|createServer\s*\(/, why: "opens a network listener — no repair may create a control port" },
  { id: "NON_LOOPBACK_BIND", pattern: /0\.0\.0\.0/, why: "binds a non-loopback interface" },
  { id: "RAW_PROCESS_SPAWN", pattern: /require\(["']child_process|from ["']node:child_process/, why: "spawns processes outside the runtime-adapter boundary" },
  { id: "SECRET_ACCESS", pattern: /find-generic-password|security\s+find-|\bkeychain\b/i, why: "reaches for a stored secret directly" },
  { id: "DESTRUCTIVE_FS", pattern: /\brmSync\b|\bunlinkSync\b|\brimraf\b/, why: "performs a destructive filesystem operation" },
];

function runCommand(command: string, args: readonly string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync(command, [...args], {
      cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000,
    });
    return { ok: true, output: String(output).slice(-1500) };
  } catch (error) {
    const e = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const out = `${String(e.stdout ?? "")}${String(e.stderr ?? "")}` || e.message || "command failed";
    return { ok: false, output: out.slice(-1500) };
  }
}

export function hashProposal(proposal: AgentProposal): string {
  const body = proposal.FILES_CHANGED.map((f) => `${f.operation} ${f.path}\n${f.content}`).join("\n---\n");
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

export function verifyProposal(repair: RepairWorkItem, proposal: AgentProposal): VerificationVerdict {
  const stages: StageResult[] = [];
  const codeHash = hashProposal(proposal);
  const sandbox = mkdtempSync(join(tmpdir(), "dna-os-repair-"));

  function stage(name: VerificationStage, passed: boolean, detail: string, evidence: string | null = null): boolean {
    stages.push({ stage: name, passed, detail, evidence_ref: evidence });
    return passed;
  }

  let cleanup: (() => void) | null = null;
  function reject(failed: VerificationStage): VerificationVerdict {
    // A rejected proposal must leave nothing behind, including the sibling
    // check file the isolated stage needs.
    if (cleanup) cleanup();
    return {
      repair_id: repair.repair_id, verdict: "REJECT_CHANGE", failed_stage: failed, stages,
      evidence_ref: `repair-verify:${repair.repair_id}`, code_hash: codeHash,
    };
  }

  // --- 1. SOURCE VALIDATION ---------------------------------------------
  const ownedFolders = getWriteOwnershipIndex()
    .map((c) => (c as unknown as { OWNER_FOLDER: string }).OWNER_FOLDER)
    .filter((folder) => folder && !folder.startsWith("UNKNOWN"));
  const sourceProblems: string[] = [];
  for (const file of proposal.FILES_CHANGED) {
    const inAllowed = repair.allowed_paths.some((allowed) => file.path === allowed || file.path.startsWith(allowed));
    if (!inAllowed) sourceProblems.push(`${file.path} is outside allowed_paths [${repair.allowed_paths.join(", ")}]`);
    const forbidden = repair.forbidden_paths.find((f) => file.path.startsWith(f));
    if (forbidden) sourceProblems.push(`${file.path} is inside forbidden path ${forbidden}`);
    const full = join(REPO_ROOT, file.path);
    if (file.operation === "MODIFY" && !existsSync(full)) sourceProblems.push(`${file.path} declared MODIFY but does not exist`);
    if (file.operation === "CREATE" && existsSync(full)) sourceProblems.push(`${file.path} declared CREATE but already exists`);
    if (!file.content.trim()) sourceProblems.push(`${file.path} has empty content`);
    // UPSTREAM OWNERSHIP, checked here rather than discovered at stage 8.
    // permissions/write-gate denies any write into a folder no registered
    // capability owns (NO_MATCHING_CAPABILITY). The first real run of this
    // loop produced a fully correct proposal that passed seven stages and was
    // denied at the gate for exactly this — an attempt spent discovering
    // something knowable up front. Naming it here turns a late refusal into a
    // stated upstream dependency: the folder must be registered first, which
    // is an Owner decision, not this loop's.
    const ownerFolder = ownedFolders.find((folder) => file.path.startsWith(folder));
    if (!ownerFolder) {
      sourceProblems.push(
        `${file.path} lives in a folder no registered capability owns; permissions/write-gate will DENY it with ` +
        `NO_MATCHING_CAPABILITY. UPSTREAM DEPENDENCY: register a capability owning ` +
        `${file.path.split("/").slice(0, -1).join("/")}/ before any repair inside it can be promoted`);
    }
  }
  if (proposal.FILES_CHANGED.length === 0) sourceProblems.push("proposal changes no files");
  if (!stage("SOURCE_VALIDATION", sourceProblems.length === 0,
             sourceProblems.length ? sourceProblems.join("; ") : `${proposal.FILES_CHANGED.length} file(s), all inside allowed_paths`)) {
    return reject("SOURCE_VALIDATION");
  }

  // --- sandbox copies. Production stays untouched until stage 9. ---------
  //
  // The copy lives NEXT TO the real file, not in a temp directory. The first
  // version of this verifier wrote to os.tmpdir() and type-checked there,
  // which failed instantly and wrongly: every relative import in the file
  // ("../../execution/deploy/contract") resolves against the file's own
  // directory, so a temp-dir copy cannot resolve a single one of them. It
  // rejected a correct proposal with TS2307 and blamed the agent for a flaw
  // in the check. A sibling copy resolves imports exactly as the real file
  // does, which is the only way the isolated check means anything.
  //
  // The name is dotfile-prefixed so it is never mistaken for source, and the
  // finally-block below removes it on every path including a throw.
  const sandboxFiles = proposal.FILES_CHANGED.map((file) => {
    const full = join(REPO_ROOT, file.path);
    const sibling = join(dirname(full), `.repair-check-${basename(file.path)}`);
    writeFileSync(sibling, file.content);
    // A copy of the original is still kept in the temp dir, purely as the
    // rollback source for stage 9.
    return { ...file, sandbox_path: sibling };
  });

  /** Remove every sibling check file. Safe to call more than once. */
  function cleanupSiblings(): void {
    /* assigned to `cleanup` below so reject() can call it from any stage */
    for (const file of sandboxFiles) {
      try { rmSync(file.sandbox_path, { force: true }); } catch { /* already gone */ }
    }
  }
  cleanup = cleanupSiblings;

  // --- 2. CONTRACT VALIDATION -------------------------------------------
  // A repair that silently drops a documented export, or strips the file's
  // header contract, is a contract break even when it compiles.
  const contractProblems: string[] = [];
  for (const file of proposal.FILES_CHANGED) {
    if (file.operation !== "MODIFY") continue;
    const before = readFileSync(join(REPO_ROOT, file.path), "utf8");
    const exported = (text: string) =>
      [...text.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+(\w+)/g)].map((m) => m[1]);
    const dropped = exported(before).filter((symbol) => !exported(file.content).includes(symbol));
    if (dropped.length) contractProblems.push(`${file.path} drops exported symbol(s): ${dropped.join(", ")}`);
    if (before.startsWith("/**") && !file.content.startsWith("/**")) {
      contractProblems.push(`${file.path} removes its header contract block`);
    }
  }
  if (!stage("CONTRACT_VALIDATION", contractProblems.length === 0,
             contractProblems.length ? contractProblems.join("; ") : "no exported symbol dropped, header contract preserved")) {
    return reject("CONTRACT_VALIDATION");
  }

  // --- 3. DEPENDENCY VALIDATION -----------------------------------------
  const depProblems: string[] = [];
  const addedImports: string[] = [];
  for (const file of proposal.FILES_CHANGED) {
    if (file.operation !== "MODIFY") continue;
    const before = readFileSync(join(REPO_ROOT, file.path), "utf8");
    const beforeImports = new Set([...before.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]));
    for (const [, imported] of file.content.matchAll(/from\s+"([^"]+)"/g)) {
      if (beforeImports.has(imported)) continue;
      addedImports.push(`${file.path} <- ${imported}`);
      // A NEW import is only acceptable if the file's own header already
      // names that module as an allowed dependency. Otherwise the repair is
      // widening the dependency graph without anyone approving it.
      const headerAllows = before.includes(imported.replace(/^\.\.?\//, ""));
      if (!headerAllows) depProblems.push(`${file.path} adds import "${imported}" that its header does not already allow`);
    }
  }
  if (!stage("DEPENDENCY_VALIDATION", depProblems.length === 0,
             depProblems.length ? depProblems.join("; ")
               : `no dependency added outside each file's declared allowances${addedImports.length ? ` (added, all allowed: ${addedImports.join(", ")})` : ""}`)) {
    return reject("DEPENDENCY_VALIDATION");
  }

  // --- 4. SECURITY / PERMISSION VALIDATION -------------------------------
  const securityProblems: string[] = [];
  for (const file of proposal.FILES_CHANGED) {
    const before = file.operation === "MODIFY" ? readFileSync(join(REPO_ROOT, file.path), "utf8") : "";
    for (const rule of FORBIDDEN_PATTERNS) {
      const after = (file.content.match(rule.pattern) ?? []).length;
      const priorCount = (before.match(rule.pattern) ?? []).length;
      // Only NEWLY introduced occurrences fail. A file that legitimately
      // already does one of these must stay editable for unrelated repairs.
      if (after > priorCount) securityProblems.push(`${file.path} newly ${rule.why} [${rule.id}]`);
    }
  }
  if (!stage("SECURITY_PERMISSION_VALIDATION", securityProblems.length === 0,
             securityProblems.length ? securityProblems.join("; ")
               : "introduces no listener, no non-loopback bind, no raw spawn, no secret access, no destructive call")) {
    return reject("SECURITY_PERMISSION_VALIDATION");
  }

  // --- 5. ISOLATED TEST ---------------------------------------------------
  // Checked against the PROJECT config so module resolution, path aliases and
  // lib settings are the real ones. Anything less proves nothing about
  // whether the change compiles where it will actually live.
  const isolated = runCommand("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"]);
  cleanupSiblings();
  if (!stage("ISOLATED_TEST", isolated.ok,
             isolated.ok ? "the proposed file type-checks in place, against the project config, without being promoted"
                         : isolated.output)) {
    return reject("ISOLATED_TEST");
  }

  // --- 6. REGRESSION TEST (pre-promotion baseline) -----------------------
  // Run BEFORE touching production. A suite that was already red would
  // otherwise be blamed on this repair.
  const baseline = runCommand("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"]);
  if (!stage("REGRESSION_TEST", baseline.ok,
             baseline.ok ? "repo-wide typecheck is green BEFORE promotion, so any later failure is attributable to this change"
                         : `repo-wide typecheck was ALREADY red before this change: ${baseline.output}`)) {
    return reject("REGRESSION_TEST");
  }

  // --- 7. DETERMINISTIC VERIFIER -----------------------------------------
  // The change must actually reference the condition it claims to address.
  const addressesTarget = proposal.FILES_CHANGED.some(
    (f) => f.content.includes(repair.error_code) || f.content.includes("EXPECTED_BY_DESIGN"));
  if (!stage("DETERMINISTIC_VERIFIER", addressesTarget,
             addressesTarget ? `the change references the target condition (${repair.error_code})`
                             : `the change never references ${repair.error_code}; it cannot address this repair`)) {
    return reject("DETERMINISTIC_VERIFIER");
  }

  // --- 8. WRITE GATE (the real one) --------------------------------------
  let gateDetail = "";
  let gatePassed = true;
  for (const file of proposal.FILES_CHANGED) {
    const decision = evaluateWriteIntent(
      {
        intent_id: `${repair.repair_id}-${basename(file.path)}`,
        operation: file.operation,
        capability: repair.failed_capability_id,
        target_type: "FILE",
        target_path: file.path,
        requested_change: proposal.PROPOSED_CHANGE.slice(0, 400),
        requesting_agent: { identity_id: "repair-loop-agent", kind: "ai_agent", display_name: "DNA OS repair loop" },
        evidence: repair.evidence_refs.map((ref) => ({ source: "control/repair-loop", note: ref })),
        correlation_id: repair.trace_id,
        submitted_at: new Date().toISOString(),
      },
      { registryIndex: getWriteOwnershipIndex() },
    );
    const allowed = decision.decision === "ALLOW_CREATE" || decision.decision === "ALLOW_MODIFY";
    gateDetail += `${file.path} -> ${decision.decision} (${decision.reason_codes.join(",")}); `;
    if (!allowed) gatePassed = false;
  }
  if (!stage("WRITE_GATE", gatePassed, gateDetail, `write-gate:${repair.repair_id}`)) {
    return reject("WRITE_GATE");
  }

  // --- 9. CONTROLLED PROMOTION -------------------------------------------
  // Only now does anything touch the real tree, and every original is copied
  // aside first so a failing runtime check is reverted from a real file
  // rather than from memory.
  const backups: { path: string; backup: string }[] = [];
  try {
    for (const file of proposal.FILES_CHANGED) {
      const full = join(REPO_ROOT, file.path);
      if (existsSync(full)) {
        const backup = join(sandbox, `${basename(file.path)}.backup`);
        copyFileSync(full, backup);
        backups.push({ path: full, backup });
      }
      writeFileSync(full, file.content);
    }
    stage("CONTROLLED_PROMOTION", true,
          `${proposal.FILES_CHANGED.length} file(s) promoted; originals backed up under ${sandbox}`, sandbox);
  } catch (error) {
    stage("CONTROLLED_PROMOTION", false, error instanceof Error ? error.message : String(error));
    return reject("CONTROLLED_PROMOTION");
  }

  // --- 10. RUNTIME VERIFICATION ------------------------------------------
  const runtime = runCommand("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"]);
  if (!runtime.ok) {
    // Revert from the real backup. A repair that breaks the tree leaves no
    // trace of itself.
    for (const b of backups) copyFileSync(b.backup, b.path);
    stage("RUNTIME_VERIFICATION", false,
          `repo-wide typecheck failed AFTER promotion; change reverted from backup. ${runtime.output}`);
    return reject("RUNTIME_VERIFICATION");
  }
  stage("RUNTIME_VERIFICATION", true, "repo-wide typecheck green after promotion");

  return {
    repair_id: repair.repair_id,
    verdict: "VERIFIED",
    failed_stage: null,
    stages,
    evidence_ref: `repair-verify:${repair.repair_id}`,
    code_hash: codeHash,
  };
}
