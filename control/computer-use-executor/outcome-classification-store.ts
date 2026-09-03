/**
 * หน้าที่: read the registered diagnostic procedures, and append an outcome
 * classification without ever touching the evidence it classifies (Owner,
 * 2026-09-02).
 *
 * WHY THE REGISTRY IS EMPTY AND STAYS EMPTY UNTIL SOMEONE REGISTERS. A
 * diagnostic procedure is a claim that running a specific thing distinguishes a
 * specific boundary. Nothing in this repo makes that claim in machine-readable
 * form today — `software/registry-database/data/canonical/capabilities.jsonl`
 * carries no procedure metadata, and no playbook/procedure store exists
 * anywhere. So this file ships the schema and an empty store rather than
 * seeding entries: an invented procedure would be exactly the AI-authored
 * diagnosis this whole track refuses. An empty registry produces BLOCKED, which
 * is the truthful state.
 *
 * WHY CLASSIFICATION IS A NEW ROW, NOT A FIELD. The evidence for an execution
 * is finished the moment it is written. A classification is a consequence drawn
 * from it, possibly later and possibly again, so it lives in its own append-only
 * store keyed by `evidence_id`. Nothing here opens execution-evidence.jsonl for
 * writing, so no historical row — including the Step 5 row — can be mutated or
 * have its effect_verdict overwritten.
 *
 * Input: the procedure registry file; a classification to append.
 * Output: readDiagnosticProcedures, appendClassification, readClassifications.
 * Dependency ที่อนุญาต: ./outcome-classification (types), node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนทับ execution-evidence.jsonl, ห้าม seed procedure
 * ที่ไม่มีเจ้าของจริงลง registry.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OutcomeClassification } from "./outcome-classification";
import type { DiagnosticProcedure } from "./diagnostic-procedure";
import type { DiagnosticFinding } from "./diagnostic-wheel-receipt";
import type { RoutingContextDiagnosticFinding } from "./diagnostic-routing-context";

/**
 * One append-only store for every procedure's findings. Each row carries its own
 * `procedure_id` and `resolved_unknown_key`, so consumers dispatch on the fact
 * that was resolved rather than on which file wrote the row.
 */
export type AnyDiagnosticFinding = DiagnosticFinding | RoutingContextDiagnosticFinding;

const DATA_DIR = "control/computer-use-executor/data";
const PROCEDURES_FILE = "diagnostic-procedures.jsonl";
const CLASSIFICATION_FILE = "outcome-classification.jsonl";
const FINDINGS_FILE = "diagnostic-findings.jsonl";

function ensure(dir: string, file: string): string {
  const base = join(process.cwd(), dir);
  mkdirSync(base, { recursive: true });
  const path = join(base, file);
  if (!existsSync(path)) writeFileSync(path, "", { encoding: "utf8", mode: 0o600 });
  return path;
}

/** Reads whatever is registered. An unreadable or empty registry yields none — never a default procedure. */
export function readDiagnosticProcedures(dir: string = DATA_DIR): readonly DiagnosticProcedure[] {
  const path = ensure(dir, PROCEDURES_FILE);
  const out: DiagnosticProcedure[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as DiagnosticProcedure;
      // A procedure with no owner or no entry point is not registered, whatever the file says.
      // A row that does not declare what it resolves, what evidence it needs,
      // or which state contract it understands is not a registered procedure —
      // it could not be matched deterministically even if it were.
      if (typeof row.procedure_id === "string" && row.procedure_id.length > 0
        && typeof row.canonical_name === "string" && row.canonical_name.length > 0
        && typeof row.capability_id === "string" && typeof row.operation === "string"
        && Array.isArray(row.resolves_unknown) && row.resolves_unknown.length > 0
        && Array.isArray(row.requires_evidence)
        // Nullable since Step 11: a procedure whose inputs are not
        // target-published state declares no state contract and carries its
        // provenance in its own fields. `undefined` still fails — the field
        // must be present and deliberate.
        && (typeof row.requires_state_contract === "string" || row.requires_state_contract === null)
        && (row.origination === "SYSTEM" || row.origination === "OWNER_ONLY")
        && (row.status === "REGISTERED" || row.status === "DISABLED")
        && typeof row.registered_by === "string" && row.registered_by.length > 0
        && typeof row.entry_point === "string" && row.entry_point.length > 0) out.push(row);
    } catch { /* a malformed line registers nothing */ }
  }
  return out;
}

export function appendClassification(classification: OutcomeClassification, dir: string = DATA_DIR): void {
  const path = ensure(dir, CLASSIFICATION_FILE);
  appendFileSync(path, `${JSON.stringify(classification)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function readClassifications(dir: string = DATA_DIR): readonly OutcomeClassification[] {
  const path = ensure(dir, CLASSIFICATION_FILE);
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as OutcomeClassification);
}

/** Findings are append-only: a diagnostic fact about a past execution is never edited. */
export function appendDiagnosticFinding(finding: AnyDiagnosticFinding, dir: string = DATA_DIR): void {
  const path = ensure(dir, FINDINGS_FILE);
  appendFileSync(path, `${JSON.stringify(finding)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function readDiagnosticFindings(dir: string = DATA_DIR): readonly AnyDiagnosticFinding[] {
  const path = ensure(dir, FINDINGS_FILE);
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AnyDiagnosticFinding);
}
