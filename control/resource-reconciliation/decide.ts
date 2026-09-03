/**
 * หน้าที่: turn lineage + supersession evidence into ONE of the allowed
 * verdicts. This is the only file in the capability that produces a verdict,
 * and it produces nothing else — no mutation, no candidate submission, no
 * side effect.
 *
 * THE SHAPE OF THE RULE SET IS DELIBERATE. It is ordered by refusal first:
 * every reason to keep a resource is evaluated before any reason to remove one,
 * so a resource with a live consumer can never be argued into AUTO_TRASH by a
 * later rule. AUTO_TRASH is reachable only after every earlier rule declined to
 * fire AND all seven conditions are independently true.
 *
 * UNKNOWN NEVER BECOMES AUTO_TRASH. A single unanswered condition forces
 * UNRESOLVED. That is not conservatism for its own sake: an unanswered
 * condition means a read path did not respond, and a silent read path is
 * indistinguishable from a read path that would have said "still in use".
 *
 * Input: `ResourceLineage`, optional `Supersession`.
 * Output: `decideVerdict`, `SOURCE_OF_TRUTH_MARKERS`.
 * Dependency ที่อนุญาต: ./types.ts, ./supersession.ts, ./lineage.ts, node built-ins.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ AUTO_TRASH ผ่านได้ถ้ามี unanswered แม้ข้อเดียว.
 * - ห้ามให้ AI/LLM ตัดสิน — ทุกเงื่อนไขต้องมาจากข้อเท็จจริงที่อ่านได้.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lineage";
import type { Supersession } from "./supersession";
import type { AutoTrashConditions, ResourceLineage, VerdictDecision } from "./types";

/**
 * Content classes that are the record itself rather than a derivation of one.
 * Deleting any of these destroys information that exists nowhere else, so they
 * are refused before any other rule is consulted.
 *
 * Matched on real path structure. The financial/document and migration entries
 * are here because the Owner's rule is explicit: financial records, payment
 * records, invoices and tax/document evidence default to BLOCK unless an
 * existing explicit lifecycle policy permits removal — and no such policy
 * exists in either repository today.
 */
export const SOURCE_OF_TRUTH_MARKERS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /(^|\/)supabase\/migrations\//, reason: "a database migration — the schema's only history; removing one rewrites what the database is believed to be" },
  { pattern: /(^|\/)(receipt|invoice|payment|billing|tax|document)s?[-_/]/i, reason: "financial or document lineage — BLOCK by default per the Owner's explicit rule" },
  { pattern: /(^|\/)\.git\//, reason: "git's own object store" },
  { pattern: /(^|\/)(credentials|secrets)\//, reason: "credential material" },
  { pattern: /(^|\/)registry\//, reason: "a registry file — the system's record of what exists" },
  { pattern: /(^|\/)blueprint\//, reason: "architecture record" },
  { pattern: /audit|evidence|provenance/i, reason: "audit or evidence material with a historical requirement" },
  { pattern: /(^|\/)migrations?\//, reason: "a migration — schema history" },
];

export function sourceOfTruthReason(repoRelativePath: string): string | null {
  for (const marker of SOURCE_OF_TRUTH_MARKERS) {
    if (marker.pattern.test(`/${repoRelativePath}`)) return marker.reason;
  }
  return null;
}

/**
 * FILES ARE NOT ONLY REACHED BY IMPORT.
 *
 * The census answers "who imports this", and that is the wrong question for
 * anything invoked by name: a test that spawns a worker with
 * `agentArgv: [WORKER_SCRIPT, "violation-dryrun.ts"]` has no import edge to
 * that file at all. This was not hypothetical — the first run of this rule set
 * returned AUTO_TRASH for
 * control/circuit-breaker/tests/__sandbox__/violation-enforced.ts, a file
 * control/circuit-breaker/tests/kill-on-violation-proof.test.ts drives by
 * string literal. Zero importers, and deleting it breaks a security test.
 *
 * So the basename is searched as a literal across the source. The match is
 * deliberately loose: a common basename produces spurious hits, and a spurious
 * hit costs one retained file while a missed hit costs a working test. Those
 * two errors are not symmetric, and this leans to the side that is recoverable.
 */
const literalRefCache = new Map<string, string[]>();

function literalReferences(repoRelativePath: string, repoRoot: string): string[] {
  const cacheKey = `${repoRoot}::${repoRelativePath}`;
  const cached = literalRefCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const basename = repoRelativePath.split("/").pop() ?? repoRelativePath;
  const found = new Set<string>();
  for (const needle of [repoRelativePath, basename]) {
    try {
      const out = execFileSync("/bin/sh", ["-c",
        // data/ directories are excluded from the SEARCH as well as from the
        // results: they are records that name things, never consumers, and they
        // hold the bulk of the tree's bytes. Excluding them changes no answer
        // and is the difference between a scan that finishes and one that does
        // not.
        `/usr/bin/grep -rlF ${JSON.stringify(needle)} ${JSON.stringify(repoRoot)} --include=*.ts --include=*.tsx --include=*.js --include=*.json --include=*.md --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=data --exclude-dir=.next --exclude-dir=dist --exclude-dir=coverage 2>/dev/null || true`],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
      for (const f of out ? out.split("\n") : []) {
        const rel = f.startsWith(`${repoRoot}/`) ? f.slice(repoRoot.length + 1) : f;
        if (rel === repoRelativePath) continue;   // the file naming itself proves nothing
        // A DERIVED INDEX IS NOT A CONSUMER. software/live-census/data/last-census.json
        // lists every file in the repository by construction, so counting it as a
        // reference would make every artifact permanently referenced by a file
        // that merely inventories it. Records under a data/ directory name
        // things; they do not use them.
        if (/(^|\/)data\//.test(rel)) continue;
        found.add(rel);
      }
    } catch { /* grep found nothing, or could not run */ }
  }
  const result = [...found];
  literalRefCache.set(cacheKey, result);
  return result;
}

/** Committed to git = recoverable from history, independently of any trash can. */
function isTrackedAndCommitted(repoRelativePath: string, repoRoot: string): boolean {
  try {
    const out = execFileSync("/usr/bin/git", ["ls-files", "--error-unmatch", "--", repoRelativePath], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export interface DecideInput {
  lineage: ResourceLineage;
  supersession: Supersession | null;
  /** The identical sibling that survives, when the pair is byte-identical. Removing a copy while its twin remains destroys nothing. */
  identicalSurvivor: string | null;
  repoRoot?: string;
}

export function decideVerdict(input: DecideInput): VerdictDecision {
  const { lineage, supersession, identicalSurvivor } = input;
  const repoRoot = input.repoRoot ?? REPO_ROOT;
  const rel = lineage.repo_relative_path;

  const sotReason = sourceOfTruthReason(rel);
  const tracked = isTrackedAndCommitted(rel, repoRoot);
  const survivorExists = identicalSurvivor !== null && existsSync(join(repoRoot, identicalSurvivor));

  const unanswered: string[] = [];
  // Each condition is answered from a specific fact, or declared unanswered.
  const zeroConsumers = lineage.capability_key === null && lineage.consumers.length === 0
    ? (unanswered.push("zero_active_consumers: no capability covers this path, so the consumer question was never answered by the census"), false)
    : lineage.consumers.length === 0;
  const zeroRuntime = lineage.runtime_owner === null;
  const literalRefs = literalReferences(rel, repoRoot)
    // An identical twin naturally contains nothing about its sibling, but a
    // duplicate pair's OTHER member is not a consumer either way.
    .filter((r) => r !== identicalSurvivor);
  const zeroProtected = lineage.blueprint_references.length === 0 && literalRefs.length === 0;
  const replacementVerified = supersession === null
    ? true // not applicable: nothing claims to replace it
    : existsSync(join(repoRoot, supersession.new_path));
  const recoverable = tracked || survivorExists;
  // Retention is satisfied only for a byte-identical copy whose twin survives:
  // the content is retained in full, so no retention window can be violated by
  // removing the duplicate. Anything else has no declared window here.
  const retentionSatisfied = survivorExists;
  if (!survivorExists && supersession !== null) {
    unanswered.push("retention_satisfied: no retention policy in this repository declares a window for this path, and no identical copy survives it");
  }
  const notSourceOfTruth = sotReason === null;

  const conditions: AutoTrashConditions = {
    zero_active_consumers: zeroConsumers,
    zero_runtime_use: zeroRuntime,
    zero_protected_references: zeroProtected,
    replacement_verified_where_applicable: replacementVerified,
    recoverability_proven: recoverable,
    retention_satisfied: retentionSatisfied,
    source_of_truth_is_false: notSourceOfTruth,
    unanswered,
  };

  // ---- REFUSALS FIRST ----------------------------------------------------
  if (sotReason !== null) {
    return { verdict: "BLOCK", reason: `source of truth: ${sotReason}`, conditions, rule: "SOURCE_OF_TRUTH_BLOCK" };
  }
  if (lineage.runtime_owner !== null) {
    return { verdict: "RETAIN", reason: `a live process holds it: ${lineage.runtime_owner}`, conditions, rule: "ACTIVE_RUNTIME_RETAIN" };
  }
  if (lineage.current_state === "ACTIVE") {
    // ACTIVE is set when the census observed a live runtime consumer for this
    // capability (lsof, not a guess), or a caller, or a process holding it.
    // Reaching a removal verdict for something the OS says is in use right now
    // is the failure this whole capability exists to prevent.
    return { verdict: "RETAIN", reason: "the census classifies it ACTIVE — a live runtime consumer or caller was observed", conditions, rule: "ACTIVE_STATE_RETAIN" };
  }
  if (lineage.consumers.length > 0) {
    return {
      verdict: "RETAIN",
      reason: `${lineage.consumers.length} consumer(s) still import it: ${lineage.consumers.slice(0, 3).join(", ")}${lineage.consumers.length > 3 ? ", …" : ""}`,
      conditions,
      rule: "ACTIVE_CONSUMER_RETAIN",
    };
  }
  if (literalRefs.length > 0) {
    return {
      verdict: "RETAIN",
      reason: `${literalRefs.length} file(s) name it as a literal string rather than importing it: ${literalRefs.slice(0, 3).join(", ")}${literalRefs.length > 3 ? ", …" : ""}`,
      conditions,
      rule: "LITERAL_REFERENCE_RETAIN",
    };
  }
  if (lineage.blueprint_references.length > 0) {
    return {
      verdict: "REVIEW",
      reason: `${lineage.blueprint_references.length} blueprint reference(s) still name it — the architecture record must be reconciled before the implementation is touched`,
      conditions,
      rule: "BLUEPRINT_REFERENCE_REVIEW",
    };
  }
  if (lineage.current_state === "UNKNOWN") {
    return { verdict: "UNRESOLVED", reason: `state is UNKNOWN: ${lineage.unresolved.slice(0, 2).join("; ")}`, conditions, rule: "UNKNOWN_NEVER_AUTO_TRASH" };
  }

  // ---- ONLY NOW MAY A REMOVAL BE CONSIDERED ------------------------------
  if (unanswered.length > 0) {
    return {
      verdict: "UNRESOLVED",
      reason: `${unanswered.length} AUTO_TRASH condition(s) could not be answered: ${unanswered.join("; ")}`,
      conditions,
      rule: "UNANSWERED_CONDITION_UNRESOLVED",
    };
  }

  const allTrue = zeroConsumers && zeroRuntime && zeroProtected && replacementVerified && recoverable && retentionSatisfied && notSourceOfTruth;
  if (allTrue) {
    return {
      verdict: "AUTO_TRASH",
      reason: supersession !== null
        ? `superseded by ${supersession.new_path} (${supersession.basis}), zero consumers, zero runtime use, and the surviving copy makes removal lossless`
        : "zero consumers, zero runtime use, no protected reference, and recoverable",
      conditions,
      rule: "ALL_AUTO_TRASH_CONDITIONS_TRUE",
    };
  }

  // Something is false but nothing was unanswered — say exactly which.
  const failed = Object.entries(conditions)
    .filter(([k, v]) => k !== "unanswered" && v === false)
    .map(([k]) => k);
  return {
    verdict: "REVIEW",
    reason: `not eligible for automatic removal; unmet condition(s): ${failed.join(", ")}`,
    conditions,
    rule: "CONDITION_UNMET_REVIEW",
  };
}
