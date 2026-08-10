/**
 * Acceptance Contract Runtime (owner, 2026-08-09, Software Factory
 * Readiness gap fill — Gap 2: "compile Acceptance Contract เป็น
 * machine-checkable PASS/FAIL"). Before this file, workerContract.ts's
 * `acceptanceCriteria: string[]` was carried end-to-end as a real,
 * structured field but was never itself evaluated — codeWorkerRuntime.ts's
 * `buildAcceptanceCriteria()` was a real, honest identity pass-through, and
 * PASS/FAIL judgment came only from Test/Build subprocess exit codes, never
 * from the criteria an Owner actually wrote.
 *
 * This Runtime turns a small, real, closed set of recognized criterion
 * shapes into machine-checkable predicates evaluated directly against real
 * evidence (on-disk file content, a real TestRun, a real BuildRun, a real
 * ChangeSet's findings) — never a fabricated PASS, never an LLM asked to
 * grade its own work. Any criterion string that does not match one of the
 * recognized shapes is honestly reported NOT_MACHINE_CHECKABLE and, by
 * design, blocks an automatic overall PASS (Section: "Validator ต้องตัดสิน
 * จาก evidence โดยไม่ต้องกลับมาถาม Owner ทุกขั้น" — the Owner is asked only
 * when a criterion genuinely cannot be judged from evidence, never for the
 * machine-checkable ones).
 *
 * Recognized real criterion shapes (case-sensitive keyword prefix, `::`
 * separated args):
 *   FILE_EXISTS::<path>
 *   FILE_CONTAINS::<path>::<substring>
 *   FILE_NOT_CONTAINS::<path>::<substring>
 *   TEST_MUST_PASS
 *   BUILD_MUST_PASS
 *   REVIEW_NO_BLOCKING_FINDINGS
 * Anything else -> NOT_MACHINE_CHECKABLE (the exact string is preserved so
 * an Owner can still read and manually judge it).
 */
import { readFileSync, existsSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import type { TestRun } from "./testRuntime";
import type { BuildRun } from "./buildRuntime";
import type { ChangeSet } from "./changeSetRuntime";

export type CompiledCriterionKind =
  | "FILE_EXISTS" | "FILE_CONTAINS" | "FILE_NOT_CONTAINS"
  | "TEST_MUST_PASS" | "BUILD_MUST_PASS" | "REVIEW_NO_BLOCKING_FINDINGS"
  | "REVIEW_NO_BLOCKING_FINDINGS_IN_WORKER_DIFF" | "BUILD_NO_ERRORS_IN_WORKER_DIFF"
  | "UI_NO_OVERFLOW" | "UI_RESPONSIVE_OK" | "UI_TEXT_NOT_TRUNCATED" | "UI_ROUTE_RESPONDS"
  | "NOT_MACHINE_CHECKABLE";

export interface CompiledCriterion {
  raw: string;
  kind: CompiledCriterionKind;
  path: string | null;
  substring: string | null;
}

const KNOWN_PREFIXES = [
  "FILE_EXISTS", "FILE_CONTAINS", "FILE_NOT_CONTAINS", "TEST_MUST_PASS", "BUILD_MUST_PASS", "REVIEW_NO_BLOCKING_FINDINGS",
  "REVIEW_NO_BLOCKING_FINDINGS_IN_WORKER_DIFF", "BUILD_NO_ERRORS_IN_WORKER_DIFF",
  "UI_NO_OVERFLOW", "UI_RESPONSIVE_OK", "UI_TEXT_NOT_TRUNCATED", "UI_ROUTE_RESPONDS",
] as const;

/** Real, deterministic compiler — never guesses intent from free text,
 * never calls an LLM to interpret a criterion. A criterion either
 * matches one of the recognized real shapes exactly, or it is honestly
 * NOT_MACHINE_CHECKABLE. */
export function compileAcceptanceCriteria(acceptanceCriteria: string[]): CompiledCriterion[] {
  return acceptanceCriteria.map((raw) => {
    const parts = raw.split("::").map((p) => p.trim());
    const prefix = parts[0];
    if (!(KNOWN_PREFIXES as readonly string[]).includes(prefix)) {
      return { raw, kind: "NOT_MACHINE_CHECKABLE", path: null, substring: null };
    }
    if (prefix === "FILE_EXISTS") {
      if (parts.length !== 2 || !parts[1]) return { raw, kind: "NOT_MACHINE_CHECKABLE", path: null, substring: null };
      return { raw, kind: "FILE_EXISTS", path: parts[1], substring: null };
    }
    if (prefix === "FILE_CONTAINS" || prefix === "FILE_NOT_CONTAINS") {
      if (parts.length !== 3 || !parts[1] || !parts[2]) return { raw, kind: "NOT_MACHINE_CHECKABLE", path: null, substring: null };
      return { raw, kind: prefix, path: parts[1], substring: parts[2] };
    }
    // TEST_MUST_PASS / BUILD_MUST_PASS / REVIEW_NO_BLOCKING_FINDINGS take no args.
    if (parts.length !== 1) return { raw, kind: "NOT_MACHINE_CHECKABLE", path: null, substring: null };
    return { raw, kind: prefix as CompiledCriterionKind, path: null, substring: null };
  });
}

export interface CriterionResult {
  criterion: CompiledCriterion;
  status: "PASS" | "FAIL" | "NOT_MACHINE_CHECKABLE";
  detail: string;
}

/** Minimal, structural shape of a real browserInspectionRuntime.ts
 * UiScanResult — imported as a type-only shape here (not the concrete
 * type) to avoid this file depending on Playwright at all; the real
 * UiScanResult satisfies this shape exactly. */
export interface UiScanEvidenceLike {
  targetUrl: string;
  inspectionRecords: { findings: { code: string; severity: string }[] }[];
}

export interface AcceptanceEvidence {
  testRun: TestRun | null;
  buildRun: BuildRun | { blocked: true; reasons: string[] } | null;
  changeSet: ChangeSet | null;
  /** Real, precise list of files THIS Worker actually wrote this attempt
   * (Software Factory Readiness, baseline-isolation gap fill,
   * 2026-08-09) — never derived by mutating git state (git stash is on
   * the Constitution's DENIED_GIT_SUBCOMMANDS list). Sourced directly
   * from applyCodeWorkerProposal()'s real, already-known return value.
   * Used by the *_IN_WORKER_DIFF criteria below to judge only the
   * Worker's own change, not a repo's pre-existing, unrelated backlog. */
  workerOwnFiles: string[];
  /** Real UI Inspection evidence (browserInspectionRuntime.ts), present
   * only when a Job Contract's uiScan config actually ran one. */
  uiScan: UiScanEvidenceLike | null;
}

function readWorkspaceFile(relPath: string): string | null {
  const segments = relPath.split("/");
  if (segments.some((s) => s === "..")) return null;
  const absPath = path.join(WORKSPACE_ROOT, relPath);
  if (!existsSync(absPath)) return null;
  try { return readFileSync(absPath, "utf-8"); } catch { return null; }
}

/** Real, evidence-only evaluation — every PASS/FAIL below is derived
 * from a real, already-produced artifact (on-disk file, real TestRun,
 * real BuildRun, real ChangeSet), never invented. */
export function evaluateAcceptanceContract(
  compiled: CompiledCriterion[], evidence: AcceptanceEvidence
): { results: CriterionResult[]; overall: "PASS" | "FAIL" | "NEEDS_OWNER_REVIEW" } {
  const results: CriterionResult[] = compiled.map((c) => {
    switch (c.kind) {
      case "FILE_EXISTS": {
        const content = readWorkspaceFile(c.path!);
        return { criterion: c, status: content !== null ? "PASS" : "FAIL", detail: content !== null ? `real file exists at ${c.path}` : `real file does not exist at ${c.path}` };
      }
      case "FILE_CONTAINS": {
        const content = readWorkspaceFile(c.path!);
        if (content === null) return { criterion: c, status: "FAIL", detail: `real file does not exist at ${c.path}` };
        const pass = content.includes(c.substring!);
        return { criterion: c, status: pass ? "PASS" : "FAIL", detail: pass ? `real file ${c.path} contains the required substring` : `real file ${c.path} does not contain "${c.substring}"` };
      }
      case "FILE_NOT_CONTAINS": {
        const content = readWorkspaceFile(c.path!);
        if (content === null) return { criterion: c, status: "PASS", detail: `real file does not exist at ${c.path} — vacuously satisfied` };
        const pass = !content.includes(c.substring!);
        return { criterion: c, status: pass ? "PASS" : "FAIL", detail: pass ? `real file ${c.path} does not contain the forbidden substring` : `real file ${c.path} contains forbidden "${c.substring}"` };
      }
      case "TEST_MUST_PASS": {
        if (!evidence.testRun) return { criterion: c, status: "FAIL", detail: "no real TestRun evidence was provided" };
        const pass = evidence.testRun.status === "PASSED";
        return { criterion: c, status: pass ? "PASS" : "FAIL", detail: `real TestRun status is ${evidence.testRun.status}` };
      }
      case "BUILD_MUST_PASS": {
        if (!evidence.buildRun) return { criterion: c, status: "FAIL", detail: "no real BuildRun evidence was provided" };
        if ("blocked" in evidence.buildRun) return { criterion: c, status: "FAIL", detail: `real Build was honestly BLOCKED: ${evidence.buildRun.reasons.join("; ")}` };
        const pass = evidence.buildRun.status === "SUCCEEDED" || evidence.buildRun.status === "SUCCEEDED_WITH_WARNINGS";
        return { criterion: c, status: pass ? "PASS" : "FAIL", detail: `real BuildRun status is ${evidence.buildRun.status}` };
      }
      case "REVIEW_NO_BLOCKING_FINDINGS": {
        if (!evidence.changeSet) return { criterion: c, status: "FAIL", detail: "no real ChangeSet evidence was provided" };
        const openBlocking = evidence.changeSet.findings.filter((f) => f.blocking && f.status === "OPEN");
        return { criterion: c, status: openBlocking.length === 0 ? "PASS" : "FAIL", detail: openBlocking.length === 0 ? "zero real open blocking findings" : `${openBlocking.length} real open blocking finding(s)` };
      }
      case "REVIEW_NO_BLOCKING_FINDINGS_IN_WORKER_DIFF": {
        // Real baseline isolation (2026-08-09): a real ChangeSet reflects
        // the WHOLE real git working tree, which may carry a real,
        // pre-existing, unrelated backlog (this repo: 204 dirty files as
        // of this Step). This criterion judges only findings on files
        // this Worker itself wrote — a real, honest, read-only
        // diff-of-diff, never a git mutation.
        if (!evidence.changeSet) return { criterion: c, status: "FAIL", detail: "no real ChangeSet evidence was provided" };
        const ownSet = new Set(evidence.workerOwnFiles);
        const openBlockingInDiff = evidence.changeSet.findings.filter((f) => f.blocking && f.status === "OPEN" && f.file !== null && ownSet.has(f.file));
        return { criterion: c, status: openBlockingInDiff.length === 0 ? "PASS" : "FAIL", detail: openBlockingInDiff.length === 0 ? `zero real open blocking findings within the Worker's own ${evidence.workerOwnFiles.length} file(s) (repo-wide backlog findings on OTHER files are ignored)` : `${openBlockingInDiff.length} real open blocking finding(s) within the Worker's own files: ${openBlockingInDiff.map((f) => f.message).join("; ")}` };
      }
      case "BUILD_NO_ERRORS_IN_WORKER_DIFF": {
        if (!evidence.buildRun) return { criterion: c, status: "FAIL", detail: "no real BuildRun evidence was provided" };
        if ("blocked" in evidence.buildRun) return { criterion: c, status: "FAIL", detail: `real Build was honestly BLOCKED before it could produce real per-file findings: ${evidence.buildRun.reasons.join("; ")}` };
        const ownSet = new Set(evidence.workerOwnFiles);
        const errorsInDiff = evidence.buildRun.failures.filter((f) => f.file !== null && ownSet.has(f.file) && (f.severity === "ERROR" || f.severity === "CRITICAL"));
        return { criterion: c, status: errorsInDiff.length === 0 ? "PASS" : "FAIL", detail: errorsInDiff.length === 0 ? `zero real build error(s) attributed to the Worker's own ${evidence.workerOwnFiles.length} file(s) (real BuildRun status was ${evidence.buildRun.status} — pre-existing, unrelated errors on other files are ignored)` : `${errorsInDiff.length} real build error(s) in the Worker's own files: ${errorsInDiff.map((f) => f.message).join("; ")}` };
      }
      case "UI_NO_OVERFLOW": {
        if (!evidence.uiScan) return { criterion: c, status: "FAIL", detail: "no real UI Inspection scan evidence was provided" };
        const findings = evidence.uiScan.inspectionRecords.flatMap((r) => r.findings).filter((f) => (f.code.startsWith("UI_OVERFLOW_") || f.code === "UI_TEXT_CLIPPED") && f.severity !== "INFO");
        return { criterion: c, status: findings.length === 0 ? "PASS" : "FAIL", detail: findings.length === 0 ? "zero real overflow/clipping findings from the live scan" : `${findings.length} real overflow/clipping finding(s): ${findings.map((f) => f.code).join(", ")}` };
      }
      case "UI_RESPONSIVE_OK": {
        if (!evidence.uiScan) return { criterion: c, status: "FAIL", detail: "no real UI Inspection scan evidence was provided" };
        const findings = evidence.uiScan.inspectionRecords.flatMap((r) => r.findings).filter((f) => f.code.startsWith("UI_RESPONSIVE_") && f.severity !== "INFO");
        return { criterion: c, status: findings.length === 0 ? "PASS" : "FAIL", detail: findings.length === 0 ? "zero real cross-viewport responsive-break findings from the live scan" : `${findings.length} real responsive-break finding(s)` };
      }
      case "UI_TEXT_NOT_TRUNCATED": {
        if (!evidence.uiScan) return { criterion: c, status: "FAIL", detail: "no real UI Inspection scan evidence was provided" };
        const findings = evidence.uiScan.inspectionRecords.flatMap((r) => r.findings).filter((f) => f.code === "UI_TEXT_CLIPPED" && f.severity !== "INFO");
        return { criterion: c, status: findings.length === 0 ? "PASS" : "FAIL", detail: findings.length === 0 ? "zero real clipped/truncated-text findings from the live scan" : `${findings.length} real clipped-text finding(s)` };
      }
      case "UI_ROUTE_RESPONDS": {
        if (!evidence.uiScan) return { criterion: c, status: "FAIL", detail: "no real UI Inspection scan evidence was provided — the real, live scan never ran (route unreachable, or scan blocked)" };
        return { criterion: c, status: "PASS", detail: `real UI Inspection scan reached ${evidence.uiScan.targetUrl} and produced ${evidence.uiScan.inspectionRecords.length} real inspection record(s)` };
      }
      default:
        return { criterion: c, status: "NOT_MACHINE_CHECKABLE", detail: `real criterion "${c.raw}" does not match a recognized machine-checkable shape — an Owner must judge it manually` };
    }
  });

  const anyNotMachineCheckable = results.some((r) => r.status === "NOT_MACHINE_CHECKABLE");
  const anyFail = results.some((r) => r.status === "FAIL");
  const overall: "PASS" | "FAIL" | "NEEDS_OWNER_REVIEW" =
    anyFail ? "FAIL" : anyNotMachineCheckable ? "NEEDS_OWNER_REVIEW" : "PASS";

  return { results, overall };
}
