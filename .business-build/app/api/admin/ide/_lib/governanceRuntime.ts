/**
 * Governance Enforcement Runtime (owner, 2026-08-06, Software Factory Step
 * 4.5). Turns registry/CONSTITUTION.json + registry/rule-coverage.json from
 * documents into a real, queryable machine: every rule this module tracks
 * gets exactly ONE status, computed live from real evidence on disk — never
 * cached stale numbers, never guessed (Rule 118).
 *
 * Reuses (never reimplements): registry/rule-coverage.json (44 real
 * enforced_by entries + 74 real uncovered rule numbers, already the
 * project's own canonical rule-number space, 1..118 — see
 * scripts/check-rule-coverage.sh's own TOTAL formula, reused here exactly),
 * registry/CONSTITUTION.json (iron_rules[] for the 15 unnumbered bullets +
 * the 19 numbered Rule 100-118 long-form strings + runtime_contract.rules
 * for the 11 CPU-analogy rules), registry/factory-mapping.json (Factory
 * Governance join).
 *
 * Every rule in this module's output belongs to exactly one status —
 * ENFORCED | DECLARED_NOT_ENFORCED | NOT_IMPLEMENTED | DEPRECATED | GHOST |
 * UNKNOWN — computed mechanically, never by asking an AI to judge whether a
 * rule "feels" enforced.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { WORKSPACE_ROOT } from "./fsSecurity";

export type RuleStatus = "ENFORCED" | "DECLARED_NOT_ENFORCED" | "NOT_IMPLEMENTED" | "DEPRECATED" | "GHOST" | "UNKNOWN";
export type RuleSource = "rule-coverage" | "uncovered" | "iron-rule" | "runtime-contract";

export interface RuleRecord {
  ruleId: string;
  title: string;
  status: RuleStatus;
  source: RuleSource;
  enforcedBy: string[];
  resolvedFiles: string[];
  missingFiles: string[];
  detection: string | null;
  type: string | null;
  duplicateOf: string | null;
  lastVerified: string;
}

interface RuleCoverageFile {
  version: number;
  rules: Record<string, { title: string; enforced_by: string[]; type?: string; detection?: string }>;
  uncovered_rules: number[];
}
interface ConstitutionFile {
  iron_rules: string[];
  runtime_contract: { rules: { id: number; th: string; maps_to?: string; enforcement?: string; clarified?: string }[] };
}

function loadRuleCoverage(): RuleCoverageFile {
  return JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, "registry/rule-coverage.json"), "utf-8"));
}
function loadConstitution(): ConstitutionFile {
  return JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, "registry/CONSTITUTION.json"), "utf-8"));
}

/** Extracts the leading real-path-shaped token from a real enforced_by
 * string (e.g. "scripts/x.sh#Guard9" -> "scripts/x.sh", "core/y.ts (desc)"
 * -> "core/y.ts") and checks it against the REAL filesystem — never assumes
 * a citation is real just because it's shaped like a path. */
function resolveEvidenceToken(raw: string): { file: string | null; exists: boolean } {
  const firstToken = raw.trim().split(/\s+/)[0] ?? "";
  const withoutAnchor = firstToken.split("#")[0];
  if (!withoutAnchor || !withoutAnchor.includes("/")) return { file: null, exists: false };
  const abs = path.join(WORKSPACE_ROOT, withoutAnchor);
  return { file: withoutAnchor, exists: existsSync(abs) };
}

function classifyFromEnforcedBy(enforcedBy: string[]): { status: RuleStatus; resolvedFiles: string[]; missingFiles: string[] } {
  if (enforcedBy.length === 0) return { status: "DECLARED_NOT_ENFORCED", resolvedFiles: [], missingFiles: [] };
  const resolvedFiles: string[] = [];
  const missingFiles: string[] = [];
  for (const raw of enforcedBy) {
    const { file, exists } = resolveEvidenceToken(raw);
    if (!file) continue;
    if (exists) resolvedFiles.push(file);
    else missingFiles.push(file);
  }
  if (resolvedFiles.length === 0) return { status: "NOT_IMPLEMENTED", resolvedFiles, missingFiles };
  return { status: "ENFORCED", resolvedFiles, missingFiles };
}

// ---- The 15 unnumbered iron_rules bullets (CONSTITUTION.json indices
// 0-14, before "Rule 100") — hand-verified evidence, checked live against
// real code this session (never guessed): each either (a) literally cites
// an already-numbered rule in its own text (duplicate, inherits that
// rule's real computed status) or (b) is checked against one concrete real
// file/grep result. ----
interface IronBulletEvidence { index: number; duplicateOfRuleId: string | null; checkFile: string | null; fallback: RuleStatus; note: string }
const IRON_BULLET_EVIDENCE: IronBulletEvidence[] = [
  { index: 0, duplicateOfRuleId: "1", checkFile: null, fallback: "DECLARED_NOT_ENFORCED", note: "restates Rule 1 (ห้าม Hardcode)" },
  { index: 1, duplicateOfRuleId: "2", checkFile: null, fallback: "DECLARED_NOT_ENFORCED", note: "restates Rule 2 (ห้าม Mock/Fake/Demo)" },
  { index: 2, duplicateOfRuleId: "72", checkFile: null, fallback: "DECLARED_NOT_ENFORCED", note: "cites Rule 72 explicitly in its own text" },
  { index: 3, duplicateOfRuleId: "73", checkFile: null, fallback: "DECLARED_NOT_ENFORCED", note: "cites Rule 73 explicitly (also cites Rule 83, which has no rule-coverage.json entry and is not in uncovered_rules either — see UNKNOWN handling)" },
  { index: 4, duplicateOfRuleId: null, checkFile: "core/auth/requireAuth.ts", fallback: "DECLARED_NOT_ENFORCED", note: "checked live: core/auth/requireAuth.ts exists and is the real function this session's own Step 4/4.5 routes call on every request" },
  { index: 5, duplicateOfRuleId: "31", checkFile: null, fallback: "DECLARED_NOT_ENFORCED", note: "restates Rule 31 (ทุก Module ต้อง Register)" },
  { index: 6, duplicateOfRuleId: "39", checkFile: null, fallback: "DECLARED_NOT_ENFORCED", note: "restates Rule 39 (ทุก Command ลงทะเบียนใน Registry)" },
  { index: 7, duplicateOfRuleId: "14", checkFile: null, fallback: "DECLARED_NOT_ENFORCED", note: "restates Rule 14 (ห้าม Layer เรียก Layer อื่นโดยตรง)" },
  { index: 8, duplicateOfRuleId: "118", checkFile: null, fallback: "DECLARED_NOT_ENFORCED", note: "restates Rule 118 (No Guess)" },
  { index: 9, duplicateOfRuleId: "101", checkFile: null, fallback: "DECLARED_NOT_ENFORCED", note: "restates Rule 101 (Connect before Create)" },
  { index: 10, duplicateOfRuleId: null, checkFile: null, fallback: "DECLARED_NOT_ENFORCED", note: "checked live: registry/portals.json is never read by any real .ts file in core/engines/scripts/app (grep confirmed zero code references) — the registry exists but no guard enforces one-business-logic-per-portal" },
  { index: 11, duplicateOfRuleId: null, checkFile: "core/connector-loader.ts", fallback: "DECLARED_NOT_ENFORCED", note: "checked live: core/connector-loader.ts is a real file that reads registry/connector-lifecycle.json — real code exists, though it was not verified this session whether every lifecycle STAGE (Connect/Register/Test/Enable/Run) is itself gated" },
  { index: 12, duplicateOfRuleId: null, checkFile: null, fallback: "DECLARED_NOT_ENFORCED", note: "behavioral/process rule — no code can mechanically prevent one AI session from directly messaging another; no such guard exists in this repository" },
  { index: 13, duplicateOfRuleId: "101", checkFile: null, fallback: "DECLARED_NOT_ENFORCED", note: "same discipline as Rule 101/103's own coverage note — behavioral, no mechanical check" },
  { index: 14, duplicateOfRuleId: null, checkFile: null, fallback: "DECLARED_NOT_ENFORCED", note: "checked live: registry/CURRENT_STATE.json's plan_lock is only ever READ/displayed (scripts/hello.ts prints gate_tasks_in_order; core/shared/types.ts and engines/governance/hardcode-decision-engine.ts only comment-reference exceptions_log) — no code path found this session that actually blocks creating a new Module/Page/Feature while the Plan Lock is active" },
];

function classifyIronBullet(evidence: IronBulletEvidence, allById: Map<string, RuleRecord>): { status: RuleStatus; duplicateOf: string | null } {
  if (evidence.duplicateOfRuleId) {
    const target = allById.get(evidence.duplicateOfRuleId);
    if (target) return { status: target.status, duplicateOf: evidence.duplicateOfRuleId };
    // The cited rule number has no real record anywhere (rule-coverage.json
    // covers it as neither an entry nor an uncovered number) — real gap,
    // reported honestly as UNKNOWN rather than guessed.
    return { status: "UNKNOWN", duplicateOf: evidence.duplicateOfRuleId };
  }
  if (evidence.checkFile) {
    const exists = existsSync(path.join(WORKSPACE_ROOT, evidence.checkFile));
    return { status: exists ? "ENFORCED" : "NOT_IMPLEMENTED", duplicateOf: null };
  }
  return { status: evidence.fallback, duplicateOf: null };
}

// ---- runtime_contract.rules (11 CPU-analogy rules, ids 1-11 — namespaced
// "RC-<n>" here so they never collide with rule-coverage.json's own 1-118
// numbering, which is a completely different rule set). ----
function classifyRuntimeContractRule(r: { enforcement?: string }): RuleStatus {
  if (!r.enforcement) return "UNKNOWN"; // never evaluated — honestly unknown, not guessed as either enforced or not
  const e = r.enforcement.toLowerCase();
  if (e.includes("not yet technically gated") || e.includes("process/documentation only") || e.includes("honor-system")) return "DECLARED_NOT_ENFORCED";
  if (e.includes("code-enforced") || e.includes("partially code-enforced")) return "ENFORCED";
  return "UNKNOWN";
}

let cachedAll: RuleRecord[] | null = null;
let cachedAt = 0;
const CACHE_MS = 2000; // short-lived: real fs reads are cheap for these small files, but avoids re-parsing on every single findRule() call within one request

export function computeAllRules(): RuleRecord[] {
  if (cachedAll && Date.now() - cachedAt < CACHE_MS) return cachedAll;
  const coverage = loadRuleCoverage();
  const constitution = loadConstitution();
  const now = new Date().toISOString();
  const records: RuleRecord[] = [];
  const byId = new Map<string, RuleRecord>();

  // 1) rule-coverage.json's 44 real entries (rules 1-118 sparse)
  for (const [ruleId, def] of Object.entries(coverage.rules)) {
    const { status, resolvedFiles, missingFiles } = classifyFromEnforcedBy(def.enforced_by ?? []);
    const rec: RuleRecord = {
      ruleId, title: def.title, status, source: "rule-coverage",
      enforcedBy: def.enforced_by ?? [], resolvedFiles, missingFiles,
      detection: def.detection ?? null, type: def.type ?? null, duplicateOf: null, lastVerified: now,
    };
    records.push(rec);
    byId.set(ruleId, rec);
  }

  // 2) uncovered_rules — 74 bare numbers, zero title/definition anywhere in
  // the repository. Real ghosts: referenced by number in the project's own
  // rule-count total, backed by nothing.
  for (const n of coverage.uncovered_rules) {
    const ruleId = String(n);
    const rec: RuleRecord = {
      ruleId, title: `(no title — rule number ${n} appears only in registry/rule-coverage.json's uncovered_rules list)`,
      status: "GHOST", source: "uncovered", enforcedBy: [], resolvedFiles: [], missingFiles: [],
      detection: null, type: null, duplicateOf: null, lastVerified: now,
    };
    records.push(rec);
    byId.set(ruleId, rec);
  }

  // 3) The 19 numbered Rule 100-118 iron_rules strings are ALREADY covered
  // by rule-coverage.json entries "100".."118" above (verified: every one
  // of them has a real rule-coverage.json entry) — not re-added here, that
  // would violate this module's own "one status per rule" contract.

  // 4) The 15 unnumbered iron_rules bullets (CONSTITUTION.json indices
  // 0-14) — real duplicates of already-numbered rules, or independently
  // hand-verified this session.
  for (const evidence of IRON_BULLET_EVIDENCE) {
    const text = constitution.iron_rules[evidence.index];
    const { status, duplicateOf } = classifyIronBullet(evidence, byId);
    const ruleId = `IRON-${evidence.index + 1}`;
    const rec: RuleRecord = {
      ruleId, title: text, status, source: "iron-rule",
      enforcedBy: evidence.checkFile ? [evidence.checkFile] : [],
      resolvedFiles: evidence.checkFile && existsSync(path.join(WORKSPACE_ROOT, evidence.checkFile)) ? [evidence.checkFile] : [],
      missingFiles: evidence.checkFile && !existsSync(path.join(WORKSPACE_ROOT, evidence.checkFile)) ? [evidence.checkFile] : [],
      detection: evidence.note, type: null, duplicateOf, lastVerified: now,
    };
    records.push(rec);
    byId.set(ruleId, rec);
  }

  // 5) runtime_contract.rules — the 11 CPU-analogy rules, namespaced RC-n.
  for (const r of constitution.runtime_contract.rules) {
    const ruleId = `RC-${r.id}`;
    const status = classifyRuntimeContractRule(r);
    const rec: RuleRecord = {
      ruleId, title: r.th, status, source: "runtime-contract",
      enforcedBy: r.maps_to ? [r.maps_to] : [], resolvedFiles: [], missingFiles: [],
      detection: r.enforcement ?? null, type: null, duplicateOf: null, lastVerified: now,
    };
    records.push(rec);
    byId.set(ruleId, rec);
  }

  cachedAll = records;
  cachedAt = Date.now();
  return records;
}

export function getRule(ruleId: string): RuleRecord | undefined {
  return computeAllRules().find((r) => r.ruleId === ruleId);
}
export function listRulesByStatus(status: RuleStatus): RuleRecord[] {
  return computeAllRules().filter((r) => r.status === status);
}
/** Rules whose enforced_by cites a given real file — the query Inspection/
 * Queue/Terminal/Editor need to ask "which rules cover this file". */
export function listRulesCitingFile(relPath: string): RuleRecord[] {
  return computeAllRules().filter((r) => r.resolvedFiles.includes(relPath) || r.missingFiles.includes(relPath));
}

export interface CoverageSummary {
  totalRules: number;
  enforced: number;
  declaredNotEnforced: number;
  notImplemented: number;
  deprecated: number;
  ghost: number;
  unknown: number;
  coveragePercent: number;
  bySource: Record<RuleSource, number>;
  computedAt: string;
}
export function computeCoverageSummary(): CoverageSummary {
  const rules = computeAllRules();
  const count = (s: RuleStatus) => rules.filter((r) => r.status === s).length;
  const bySource: Record<RuleSource, number> = { "rule-coverage": 0, uncovered: 0, "iron-rule": 0, "runtime-contract": 0 };
  for (const r of rules) bySource[r.source]++;
  const enforced = count("ENFORCED");
  return {
    totalRules: rules.length,
    enforced,
    declaredNotEnforced: count("DECLARED_NOT_ENFORCED"),
    notImplemented: count("NOT_IMPLEMENTED"),
    deprecated: count("DEPRECATED"),
    ghost: count("GHOST"),
    unknown: count("UNKNOWN"),
    coveragePercent: rules.length > 0 ? Math.round((enforced / rules.length) * 1000) / 10 : 0,
    bySource,
    computedAt: new Date().toISOString(),
  };
}

// ============================================================
// Ghost / Duplicate / Orphan detection (section 4) — report only, never
// deletes or auto-fixes anything.
// ============================================================
export interface GhostFinding {
  kind: "GHOST_RULE" | "DUPLICATE_RULE" | "ORPHAN_ENFORCEMENT" | "DUPLICATE_IMPLEMENTATION_FILE";
  ruleId: string | null;
  file: string | null;
  message: string;
}
const GOVERNANCE_SHAPED_FILE_PATTERN = /^scripts\/(check-|governance\.sh|dashboard\.sh|intelligence\.sh|existence\.sh|pre-commit-check\.sh|deploy-gate\.ts|record-validation\.ts|verify-environment\.sh|build-governance-summary\.ts)/;

export function findGhostFindings(): GhostFinding[] {
  const rules = computeAllRules();
  const findings: GhostFinding[] = [];

  for (const r of rules) {
    if (r.status === "GHOST") {
      findings.push({ kind: "GHOST_RULE", ruleId: r.ruleId, file: null, message: `Rule ${r.ruleId} has no title or implementation anywhere in the repository (bare number in rule-coverage.json's uncovered_rules)` });
    }
    if (r.duplicateOf) {
      findings.push({ kind: "DUPLICATE_RULE", ruleId: r.ruleId, file: null, message: `${r.ruleId} restates Rule ${r.duplicateOf} — not a distinct rule` });
    }
  }

  // Orphan enforcement: real governance-shaped scripts on disk that no
  // rule's enforced_by cites anywhere.
  const citedFiles = new Set<string>();
  for (const r of rules) for (const f of [...r.resolvedFiles, ...r.missingFiles]) citedFiles.add(f);
  const scriptsDir = path.join(WORKSPACE_ROOT, "scripts");
  let scriptFiles: string[] = [];
  try {
    scriptFiles = readdirSync(scriptsDir).map((f: string) => `scripts/${f}`);
  } catch { /* scripts dir always exists in this repo; defensive only */ }
  const seenBasenames = new Map<string, string[]>();
  for (const f of scriptFiles) {
    if (!GOVERNANCE_SHAPED_FILE_PATTERN.test(f)) continue;
    if (!citedFiles.has(f)) {
      findings.push({ kind: "ORPHAN_ENFORCEMENT", ruleId: null, file: f, message: `${f} is a real governance-shaped script but no rule's enforced_by cites it` });
    }
    // Duplicate-looking filenames (a trailing " 2", " 3", ... before the
    // extension) are a real, observable filesystem pattern for an
    // accidental duplicate copy — reported, never deleted (Rule 104 —
    // nothing is wasted without extracting knowledge first, and this scope
    // forbids delete/cleanup entirely).
    const base = f.replace(/ \d+(\.[a-z]+)$/, "$1");
    const list = seenBasenames.get(base) ?? [];
    list.push(f);
    seenBasenames.set(base, list);
  }
  for (const [base, files] of seenBasenames) {
    if (files.length > 1) {
      findings.push({ kind: "DUPLICATE_IMPLEMENTATION_FILE", ruleId: null, file: files.join(", "), message: `${files.length} files share the same governance-script basename (${base}) — a real duplicate-file pattern, not a guessed one` });
    }
  }

  return findings;
}

// ============================================================
// Factory Governance (section 7) — join with real factory-mapping.json
// ============================================================
export interface FactoryGovernance {
  factoryId: string;
  factoryName: string;
  factoryRules: string[];
  factoryCoveragePercent: number;
  factoryMissingRules: string[];
  factoryHealth: "HEALTHY" | "AT_RISK" | "UNGOVERNED";
  factoryUnknownFiles: string[];
}
export function computeFactoryGovernance(): FactoryGovernance[] {
  const factoryRegistry = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, "registry/factory-registry.json"), "utf-8")) as { factories: { id: string; name: string; ownedModules?: string[] }[] };
  const factoryMapping = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, "registry/factory-mapping.json"), "utf-8")) as { modules: Record<string, { factoryOwner: string }> };
  const rules = computeAllRules();

  // file -> rules citing it (real evidence join, computed once)
  const fileToRules = new Map<string, RuleRecord[]>();
  for (const r of rules) {
    for (const f of [...r.resolvedFiles, ...r.missingFiles]) {
      const list = fileToRules.get(f) ?? [];
      list.push(r);
      fileToRules.set(f, list);
    }
  }

  return factoryRegistry.factories.map((factory) => {
    const ownedFiles = Object.entries(factoryMapping.modules)
      .filter(([, m]) => m.factoryOwner === factory.id)
      .map(([file]) => file);
    const citingRules = new Map<string, RuleRecord>();
    const unknownFiles: string[] = [];
    for (const file of ownedFiles) {
      const cited = fileToRules.get(file);
      if (cited && cited.length > 0) {
        for (const r of cited) citingRules.set(r.ruleId, r);
      } else {
        unknownFiles.push(file);
      }
    }
    const ruleList = [...citingRules.values()];
    const enforcedCount = ruleList.filter((r) => r.status === "ENFORCED").length;
    const missingRules = ruleList.filter((r) => r.status !== "ENFORCED").map((r) => r.ruleId);
    const coveragePercent = ruleList.length > 0 ? Math.round((enforcedCount / ruleList.length) * 1000) / 10 : 0;
    const health: FactoryGovernance["factoryHealth"] = ruleList.length === 0 ? "UNGOVERNED" : coveragePercent >= 60 ? "HEALTHY" : "AT_RISK";
    return {
      factoryId: factory.id, factoryName: factory.name,
      factoryRules: ruleList.map((r) => r.ruleId), factoryCoveragePercent: coveragePercent,
      factoryMissingRules: missingRules, factoryHealth: health, factoryUnknownFiles: unknownFiles,
    };
  });
}

// ============================================================
// Runtime Events (section 9) — real, bounded, in-memory event log.
// Reuses the exact same Map + eviction pattern already established by
// executionRuntime.ts/queueRuntime.ts/inspectionRuntime.ts — never a 4th
// reimplementation of "bounded in-memory event history".
// ============================================================
export type GovernanceEventType = "RULE_VERIFIED" | "RULE_FAILED" | "RULE_DECLARED" | "RULE_UNKNOWN" | "RULE_GHOST" | "RULE_DEPRECATED";
export interface GovernanceEvent {
  eventId: string; ruleId: string; type: GovernanceEventType; actor: string; timestamp: string; evidence: string;
}
const governanceEvents: GovernanceEvent[] = [];
const MAX_GOVERNANCE_EVENTS = 2000;

function statusToEventType(status: RuleStatus): GovernanceEventType {
  switch (status) {
    case "ENFORCED": return "RULE_VERIFIED";
    case "NOT_IMPLEMENTED": return "RULE_FAILED";
    case "DECLARED_NOT_ENFORCED": return "RULE_DECLARED";
    case "GHOST": return "RULE_GHOST";
    case "DEPRECATED": return "RULE_DEPRECATED";
    case "UNKNOWN": return "RULE_UNKNOWN";
  }
}

/** Live Governance Verification (section 12) — walks every real rule,
 * recomputes its status from disk, and emits one real event per rule.
 * Never fabricates a rule or a status; this is the same computeAllRules()
 * every other accessor in this module uses. */
export function runGovernanceVerification(actor: string): { summary: CoverageSummary; events: GovernanceEvent[] } {
  cachedAll = null; // force a fresh read from disk — a verification run must never report a stale cache
  const rules = computeAllRules();
  const newEvents: GovernanceEvent[] = [];
  for (const r of rules) {
    const event: GovernanceEvent = {
      eventId: randomUUID(), ruleId: r.ruleId, type: statusToEventType(r.status), actor,
      timestamp: new Date().toISOString(),
      evidence: r.resolvedFiles.length > 0 ? `resolved: ${r.resolvedFiles.join(", ")}` : r.missingFiles.length > 0 ? `missing: ${r.missingFiles.join(", ")}` : r.detection ?? "no evidence",
    };
    governanceEvents.push(event);
    newEvents.push(event);
  }
  while (governanceEvents.length > MAX_GOVERNANCE_EVENTS) governanceEvents.shift();
  return { summary: computeCoverageSummary(), events: newEvents };
}

export function listGovernanceEvents(limit = 200): GovernanceEvent[] {
  return governanceEvents.slice(-limit).reverse();
}

// ---- Test-only introspection ----
export function __debugGovernanceEventCount(): number {
  return governanceEvents.length;
}
export function __debugClearCache(): void {
  cachedAll = null;
}
