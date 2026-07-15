#!/usr/bin/env npx tsx
/**
 * Validation Result Ledger (MISSION, registry/CHANGELOG.json DNA-000050).
 *
 * Closes the exact gap the Runtime Evidence Engine (DNA-000049) confirmed and
 * flagged on every single query: validator functions run on demand across this
 * repo (registry/*_validator.ts, engines/validation/, scripts/pre-commit-check.sh
 * guards, scripts/governance.sh checks) but NOTHING was ever persisted anywhere
 * — every validation result vanished the moment the shell exited.
 *
 * Reuse before build (Rule 101/103) — checked first:
 *   - registry/trace/ already exists but is a STATIC, build-time-imported schema
 *     (its own _loader.ts comment: "static imports... no dynamic file system
 *     reads") describing what spans/metrics COULD look like — not an append-only
 *     operational log. Appending live per-run rows into trace.registry.json would
 *     corrupt that file's real purpose and bloat the Next.js build bundle.
 *   - registry/events.json is the same shape: a static event-TYPE dictionary, not
 *     a history stream (confirmed directly in DNA-000049's Evidence Engine build).
 *   - registry/CHANGELOG.json IS the real precedent for what this needs to be: a
 *     plain array, oldest-first, read via readFileSync from scripts, appended to
 *     by scripts, never statically bundled. registry/VALIDATION_RESULTS.json
 *     follows that exact existing convention rather than inventing a new one.
 *
 * "Connect to Runtime Trace / Event Timeline / CHANGELOG / Root Cause Engine /
 * Knowledge Engine" — implemented as real, checkable links, not decoration:
 *   - Runtime Trace: registers ONE new span type ("validation_result") in
 *     registry/trace/trace.registry.json's real spans map (one-time schema
 *     addition, not per-run data — matches how that file is actually used).
 *   - Event Timeline: registers ONE new event type ("validation.result_recorded")
 *     in registry/events.json (same reasoning).
 *   - CHANGELOG: if --fixed-by names a change_id, verified against the real
 *     registry/CHANGELOG.json — WARNs if it does not exist, never fabricates one.
 *   - Root Cause Engine: no separate registry — reuses the exact field vocabulary
 *     already established in existence.json's root_cause_analysis objects
 *     (root_cause / evidence / suggested_fix), so a FAIL record here is already
 *     shaped like a Root Cause Engine entry, not a second format.
 *   - Knowledge Engine: on a FAIL, checks registry/existence.json known_mistakes
 *     for a real text match (reusing deepContainsText-equivalent logic) and
 *     records the match id if found, or an honest note that Rule 100 requires a
 *     known_mistakes entry before this failure is considered closed.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const RESULTS_PATH = join(ROOT, "registry/VALIDATION_RESULTS.json");

function readJSON<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf-8"));
}
function writeJSON(relPath: string, data: unknown) {
  writeFileSync(join(ROOT, relPath), JSON.stringify(data, null, 2) + "\n");
}

interface ValidationResultRecord {
  id: string;
  timestamp: string;
  module: string;
  command: string;
  validator: string;
  result: "PASS" | "FAIL";
  root_cause: string | null;
  evidence: string | null;
  suggested_fix: string | null;
  fixed_by: string | null;
  fixed_by_verified: boolean | null;
  verification_result: string | null;
  knowledge_ref: string | null;
  trace_ref: string;
  event_ref: string;
}

function deepContainsText(value: unknown, query: string): boolean {
  if (typeof value === "string") return value.toLowerCase().includes(query);
  if (Array.isArray(value)) return value.some((v) => deepContainsText(v, query));
  if (value && typeof value === "object") return Object.values(value).some((v) => deepContainsText(v, query));
  return false;
}

function ensureTraceSpanRegistered() {
  const path = "registry/trace/trace.registry.json";
  const trace = readJSON<any>(path);
  if (trace.trace_schema.spans.validation_result) return;
  trace.trace_schema.spans.validation_result = {
    id: "validation_result",
    label: "Validation run recorded",
    storage_field: "registry/VALIDATION_RESULTS.json",
    status_field: "result",
  };
  trace.last_updated = new Date().toISOString().slice(0, 10);
  writeJSON(path, trace);
}

function ensureEventRegistered() {
  const path = "registry/events.json";
  const events = readJSON<any>(path);
  if (events.events["validation.result_recorded"]) return;
  events.events["validation.result_recorded"] = {
    source: "registry/VALIDATION_RESULTS.json",
    data: ["module", "command", "validator", "result", "root_cause"],
  };
  writeJSON(path, events);
}

function verifyChangelogRef(changeId: string | null): boolean | null {
  if (!changeId) return null;
  const changelog = readJSON<any[]>("registry/CHANGELOG.json");
  return changelog.some((c) => c.change_id === changeId);
}

function findKnowledgeRef(rootCause: string | null): string | null {
  if (!rootCause) return null;
  const existence = readJSON<any>("registry/existence.json");
  const q = rootCause.toLowerCase();
  const match = (existence.known_mistakes?.entries ?? []).find((km: any) => deepContainsText(km, q));
  return match ? match.id : null;
}

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "";
      args[key] = val;
    }
  }
  return args;
}

function recordValidationResult(args: Record<string, string>) {
  const required = ["module", "command", "validator", "result"];
  for (const r of required) {
    if (!args[r]) {
      console.error(`Missing required --${r}. Usage: npx tsx scripts/record-validation.ts --module <m> --command <c> --validator <v> --result PASS|FAIL [--root-cause ...] [--evidence ...] [--suggested-fix ...] [--fixed-by DNA-XXXXXX] [--verification-result ...]`);
      process.exit(1);
    }
  }
  if (args.result !== "PASS" && args.result !== "FAIL") {
    console.error(`--result must be PASS or FAIL, got: ${args.result}`);
    process.exit(1);
  }

  ensureTraceSpanRegistered();
  ensureEventRegistered();

  const results: ValidationResultRecord[] = existsSync(RESULTS_PATH) ? readJSON<ValidationResultRecord[]>("registry/VALIDATION_RESULTS.json") : [];
  const id = `VR-${String(results.length + 1).padStart(6, "0")}`;

  const rootCause = args["root-cause"] ?? null;
  const fixedBy = args["fixed-by"] ?? null;

  const record: ValidationResultRecord = {
    id,
    timestamp: new Date().toISOString(),
    module: args.module,
    command: args.command,
    validator: args.validator,
    result: args.result as "PASS" | "FAIL",
    root_cause: rootCause,
    evidence: args.evidence ?? null,
    suggested_fix: args["suggested-fix"] ?? null,
    fixed_by: fixedBy,
    fixed_by_verified: verifyChangelogRef(fixedBy),
    verification_result: args["verification-result"] ?? null,
    knowledge_ref: args.result === "FAIL" ? findKnowledgeRef(rootCause) : null,
    trace_ref: "registry/trace/trace.registry.json#trace_schema.spans.validation_result",
    event_ref: "registry/events.json#events.validation.result_recorded",
  };

  results.push(record);
  writeJSON("registry/VALIDATION_RESULTS.json", results);

  // Recurring-pattern prevention (MISSION, DNA-000051): analyzing this ledger's
  // own first real batch (VR-000002/003/004/007) found that 100% of FAILs had
  // evidence:null — governance.sh streamed output straight to the terminal and
  // never captured it. Fixed at the source (governance.sh now captures real
  // output), but this WARN is the mechanical, permanent guard against the
  // pattern recurring through any OTHER caller of this recorder that forgets
  // to pass real evidence on a FAIL — same WARN-not-REJECT posture as Guard 9,
  // since a FAIL with genuinely no capturable output (e.g. a silent exit code)
  // is possible and shouldn't be blocked, only flagged.
  if (args.result === "FAIL" && !args.evidence) {
    console.log(`[record-validation] WARNING: ${id} recorded FAIL with no --evidence. This is exactly the recurring pattern KM-004 identified (root_cause/evidence silently null on every FAIL) — pass real captured output via --evidence, don't leave it blank.`);
  }

  if (args.result === "FAIL" && rootCause && !record.knowledge_ref) {
    console.log(`[record-validation] ${id} FAIL recorded — no matching known_mistakes entry found. Rule 100 requires one before this failure is considered closed (registry/existence.json known_mistakes).`);
  }
  if (fixedBy && record.fixed_by_verified === false) {
    console.log(`[record-validation] WARNING: --fixed-by "${fixedBy}" does not match any real change_id in registry/CHANGELOG.json — not linked, recorded as unverified.`);
  }
  console.log(`[record-validation] ${id} ${args.result} — ${args.validator} (${args.module})`);
}

recordValidationResult(parseArgs());
