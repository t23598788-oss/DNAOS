/**
 * หน้าที่: measure the evidence files each declaration names, and turn the
 * counts into self-resource records — the only path by which a method can
 * reach RUNTIME_PROVEN (Owner, 2026-09-02).
 *
 * THE SPLIT THAT MATTERS. This file does the I/O; `./contract.ts` does the
 * deciding, and it is pure. So the state of a method is a function of what is
 * on disk, and nothing in between can put a thumb on it. Re-running this after
 * deleting an evidence file downgrades the method automatically, which is the
 * behaviour a self-knowledge layer has to have to be worth trusting.
 *
 * COUNTING IS DELIBERATELY LITERAL. A row counts when it contains the declared
 * substring — no parsing, no interpretation, no partial credit. A missing file
 * is `exists: false` with zero rows rather than an error, because "the evidence
 * is not there" is exactly the fact being recorded.
 *
 * EVERY RECORD CARRIES ITS OWN PROVENANCE. `evidence_refs` keeps the path, the
 * required count, the observed count and whether it was satisfied — so a reader
 * can re-derive any state by hand from the same files, and can see immediately
 * which file to look at when a state changes.
 *
 * Input: the declarations + the repository's evidence files.
 * Output: deriveSelfResources, writeSelfResources, readSelfResources.
 * Dependency ที่อนุญาต: ./contract, ./declarations, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามเขียน runtime state ลงไฟล์นี้โดยตรง, ห้ามนับแถวที่ไม่ตรง
 * เงื่อนไขว่าเป็นหลักฐาน, ห้ามเติมเวลาปัจจุบันแทน timestamp ที่อ่านไม่ได้.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveRuntimeState, type EvidenceRule, type MeasuredEvidence, type SelfResourceDeclaration, type SelfResourceRecord } from "./contract";
import { SELF_RESOURCE_DECLARATIONS } from "./declarations";

const DATA_DIR = "control/self-resource/data";
const STORE_FILE = "self-resources.jsonl";

/** Reads one evidence file literally. A missing file is a fact, not a failure. */
function measure(rule: EvidenceRule, root: string): MeasuredEvidence {
  const full = join(root, rule.path);
  const base: MeasuredEvidence = { path: rule.path, exists: false, matching_rows: 0, required_rows: rule.min_rows, satisfied: false, newest_timestamp: null };
  if (!existsSync(full)) return base;

  let raw: string;
  try { raw = readFileSync(full, "utf8"); } catch { return base; }

  let rows: string[];
  if (rule.kind === "FILE_EXISTS") {
    rows = [raw];
  } else if (rule.kind === "JSON_ARRAY_FILE") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      rows = Array.isArray(parsed) ? parsed.map((r) => JSON.stringify(r)) : [];
    } catch { return { ...base, exists: true }; }
  } else {
    rows = raw.split("\n").filter((l) => l.trim());
  }

  // Normalise whitespace so a declared substring matches regardless of how the
  // producer spaced its JSON — the fact is the field and value, not the format.
  const needle = rule.must_contain;
  const matching = needle ? rows.filter((r) => r.replace(/\s*:\s*/g, ":").includes(needle.replace(/\s*:\s*/g, ":"))) : rows;

  let newest: string | null = null;
  if (rule.timestamp_field) {
    for (const r of matching) {
      const m = new RegExp(`"${rule.timestamp_field}"\\s*:\\s*"([^"]+)"`).exec(r);
      if (m?.[1] && (newest === null || m[1] > newest)) newest = m[1];
    }
  }
  return { path: rule.path, exists: true, matching_rows: matching.length, required_rows: rule.min_rows, satisfied: matching.length >= rule.min_rows, newest_timestamp: newest };
}

/** Derives every record. Pure decisions, measured inputs, no model, no defaults. */
export function deriveSelfResources(
  root: string = process.cwd(),
  declarations: readonly SelfResourceDeclaration[] = SELF_RESOURCE_DECLARATIONS,
  now: () => Date = () => new Date(),
): readonly SelfResourceRecord[] {
  const derived_at = now().toISOString();
  return declarations.map((d): SelfResourceRecord => {
    const measured = d.proof_rules.map((r) => measure(r, root));
    const drift = d.drift_rule ? measure(d.drift_rule, root) : null;
    const { runtime_state, last_observed_at } = deriveRuntimeState(d, measured, drift);
    return {
      method_id: d.method_id,
      method_kind: d.method_kind,
      capability_id: d.capability_id,
      capability_canonical_name: d.capability_canonical_name,
      implementation_boundary: d.implementation_boundary,
      authority_requirement: d.authority_requirement,
      credential_mode: d.credential_mode,
      observation_support: d.observation_support,
      observation_source: d.observation_source,
      verification_support: d.verification_support,
      verification_source: d.verification_source,
      measured_dimensions: d.measured_dimensions,
      unmeasured_dimensions: d.unmeasured_dimensions,
      runtime_state,
      runtime_state_source: "MEASURED_EVIDENCE",
      last_observed_at,
      evidence_refs: drift ? [...measured, drift] : measured,
      known_limitations: d.known_limitations,
      freshness_model: "MISSING",
      derived_at,
    };
  });
}

function storePath(dir: string): string {
  const base = join(process.cwd(), dir);
  mkdirSync(base, { recursive: true });
  const path = join(base, STORE_FILE);
  if (!existsSync(path)) writeFileSync(path, "", { encoding: "utf8", mode: 0o600 });
  return path;
}

/**
 * Replaces the store with a freshly derived snapshot. Replacement rather than
 * append on purpose: a self-resource record is a statement about now, and two
 * contradictory statements about the same method would be worse than one that
 * can be re-derived at any moment from the same files.
 */
export function writeSelfResources(records: readonly SelfResourceRecord[], dir: string = DATA_DIR): void {
  const path = storePath(dir);
  writeFileSync(path, "", { encoding: "utf8", mode: 0o600 });
  for (const r of records) appendFileSync(path, `${JSON.stringify(r)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function readSelfResources(dir: string = DATA_DIR): readonly SelfResourceRecord[] {
  const path = storePath(dir);
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as SelfResourceRecord);
}
