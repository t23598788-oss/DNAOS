/**
 * หน้าที่: PRODUCER-SIDE, STANDALONE script (Owner UNLOCK 2026-09-06,
 * PERSIST_FIRST_REAL_DNA_OS_MEASUREMENT). Run manually or on a schedule —
 * `npx tsx governance/source-validation/publish-capability-folder-law-measurement.ts`
 * — NEVER imported by `control/conversation-runtime/`. Calls the real,
 * existing gate directly; no rule, formula, or classification logic is
 * reimplemented here.
 *
 * SCOPE: exactly one metric — CAPABILITY_FOLDER_LAW_COMPLIANCE. This file
 * has no opinion about "system completeness", "security", or "release
 * readiness" and must never grow one.
 *
 * FORMULA_VERSION is a sha256 of `./folder-law-gate.ts`'s own current
 * source text — it changes if and only if the rule/formula logic itself
 * changes, never on a hand-typed version string.
 *
 * evidence_refs stored per measurement are `${subject}#${rule_row}`
 * identifiers for every REAL_VIOLATION at this run — small, real,
 * per-subject identity references (not the full violation payload:
 * verdict/measured/classification_reason/root_cause are NOT stored here,
 * only referenced by re-running the gate itself if the full detail is ever
 * needed) — enough for `compareCapabilityFolderLawMeasurements()` to name
 * exactly which subjects changed between two runs.
 *
 * Input: none (reads the real repo).
 * Output: appends one `CapabilityFolderLawMeasurement` via
 * `publishCapabilityFolderLawMeasurement` — never overwrites a prior one.
 * Dependency ที่อนุญาต: ./folder-law-gate.ts, ../../control/runtime-revision/contract.ts,
 * ../../control/conversation-read-model/contract.ts, node:crypto, node:fs.
 * สิ่งที่ห้ามแตะ: ห้ามให้ไฟล์นี้ถูก import จาก control/conversation-runtime/.
 * ห้ามแก้ folder-law-gate.ts's classification logic จากที่นี่.
 */

declare const __dirname: string;

import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { runCapabilityFolderLawGate } from "./folder-law-gate";
import { readRuntimeRevision } from "../../control/runtime-revision/contract";
import { publishCapabilityFolderLawMeasurement } from "../../control/conversation-read-model/contract";
import type { CapabilityFolderLawMeasurement } from "../../control/conversation-read-model/contract";

function formulaVersion(): string {
  const source = readFileSync(join(__dirname, "folder-law-gate.ts"));
  return createHash("sha256").update(source).digest("hex");
}

function main(): void {
  const gate = runCapabilityFolderLawGate();
  const revision = readRuntimeRevision();

  const measurement: CapabilityFolderLawMeasurement = {
    measurement_id: randomUUID(),
    metric_id: "CAPABILITY_FOLDER_LAW_COMPLIANCE",
    subject_id: "DNA_OS_INFRASTRUCTURE_REPOSITORY",
    measured_at: new Date().toISOString(),
    source_revision: revision.revision,
    source_dirty: revision.dirty,
    formula_id: "CAPABILITY_FOLDER_LAW_PASS_RATIO",
    formula_version: formulaVersion(),
    subject_count: gate.subject_count,
    passed_count: gate.passed_count,
    failed_count: gate.failed_count,
    gate_status: gate.status,
    evidence_refs: gate.violations.map((v) => `${v.subject}#${v.rule_row}`),
  };

  publishCapabilityFolderLawMeasurement(measurement);
  console.log(`published measurement ${measurement.measurement_id}: ${measurement.passed_count}/${measurement.subject_count} passed, revision=${measurement.source_revision}${measurement.source_dirty ? " (dirty)" : ""}`);
}

main();
