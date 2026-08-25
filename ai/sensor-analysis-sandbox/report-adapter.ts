/**
 * หน้าที่: the ONE-WAY REPORT ADAPTER — the missing joint between a validated
 * sandbox analysis and the Monitor (Owner, 2026-08-26).
 *
 *   VALIDATED_AI_OUTPUT -> [this file] -> observability/joint-monitor/contract.ts -> MONITOR
 *
 * QWEN NEVER SENDS ANYTHING. The model process has no network, no credentials
 * and no writable path (see ./sandbox-profile.sb); it prints text and exits.
 * This file runs in a different process entirely, reads that text only after
 * ./output-contract.ts has validated it, and is the party that calls the
 * Monitor. The model cannot reach this code, and this code passes nothing back
 * to the model.
 *
 * WHY reportViolation AND NOT A NEW MONITOR INPUT: `POST /findings` on
 * dna-os-circuit is the repo's existing report input, but its `FindingEvent`
 * contract binds `warning_type` to DNA-LAB-FILE-INTELLIGENCE's fourteen real
 * Warning values ("Preserved verbatim from the real Warning.type — never
 * re-labeled") and requires scan_id/owner_folder/files_involved. A sensor
 * pattern is none of those, so using it would mean mislabeling. The Monitor's
 * own existing violation channel already carries exactly this shape: a
 * DETECTED condition, with evidence, with an `enforced` flag that keeps
 * "detected" separate from "acted on". Every record this adapter publishes is
 * `enforced: false` — nothing was blocked, nothing was acted on.
 *
 * NO FREE TEXT REACHES THE MONITOR. `detail` is composed here from validated
 * fields only — enum values, ids that were checked against the input, and
 * integer counts. The model's own prose (`unknowns[]`) is deliberately dropped:
 * it is the one part of the output that nothing can check.
 *
 * Input: a `ValidationResult` from ./output-contract.ts + the `SandboxInput` it
 * was produced from.
 * Output: `PublishOutcome`, and — as a side effect — real violation records in
 * the Monitor, or a durable validation-failure record on disk.
 * Dependency ที่อนุญาต: ./output-contract.ts, ./input-contract.ts,
 * `../../observability/joint-monitor/contract.ts` (its public boundary), node built-ins.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามส่ง output ที่ validator ปฏิเสธขึ้น Monitor เด็ดขาด — rejected analyses
 *   are dropped and recorded here, and the Monitor never hears about them.
 * - ห้ามแต่ง anomaly ตอน insufficient_evidence — one status record, nothing more.
 * - ห้ามส่งข้อความอิสระของโมเดลขึ้น Monitor.
 * - ห้ามเพิ่มเส้นทางย้อนกลับเข้า sandbox — ไม่มีฟังก์ชันในไฟล์นี้ที่คืนอะไรให้โมเดล.
 */

declare const require: any;
declare const __dirname: string;

import { reportViolation } from "../../observability/joint-monitor/contract";
import type { SandboxInput } from "./input-contract";
import type { SandboxOutput, ValidationResult } from "./output-contract";

const fs = require("node:fs");
const path = require("node:path");

/** `source` on every record — the real call site, matching the evidence-citation convention the rest of this repo uses. */
export const ADAPTER_SOURCE = "ai/sensor-analysis-sandbox/report-adapter.ts#publishAnalysis";

/**
 * The one marker that keeps this from becoming a loop. Records published by
 * this adapter carry it, and `observability/joint-monitor/supabase-sink.ts`
 * refuses to mirror anything carrying it into `dna_os_sensor`. Without that,
 * an AI report would become a sensor event, the sandbox reads sensor events,
 * and the model would be analysing its own output on the next run — a real
 * return path built by accident.
 */
export const AI_REPORT_MARKER = "ai-sensor-analysis";

const FAILURE_LOG = path.join(__dirname, "data", "validation-failures.jsonl");

export type PublishOutcome =
  | { published: true; kind: "FINDINGS"; records: number; launch_id: string }
  | { published: true; kind: "INSUFFICIENT_EVIDENCE"; records: 1; launch_id: string }
  | { published: false; kind: "VALIDATION_FAILED"; reasons: string[]; recorded_at: string };

/** Deterministic, composed here — never a sentence the model wrote. */
function composeDetail(finding: SandboxOutput["findings"][number]): string {
  const parts = [
    `joint=${finding.joint_id ?? "UNKNOWN"}`,
    `pattern_type=${finding.pattern_type}`,
    `pattern_reference=${finding.pattern_reference ?? "NONE"}`,
    `occurrence_count=${finding.occurrence_count ?? "UNKNOWN"}`,
    `confidence=${finding.confidence}`,
    `related_event_ids=${finding.related_event_ids.join(",")}`,
    `evidence_refs=${finding.evidence_refs.join(",")}`,
  ];
  return parts.join(" ");
}

/**
 * A rejected analysis is dropped, not forwarded, and not silently forgotten:
 * the reasons are appended to a durable local log so a refusal is as
 * inspectable afterwards as an accepted one. Nothing about it is sent to the
 * Monitor — that is the Owner's rule for this path, and it is the reason this
 * function returns before any reportViolation call.
 */
function recordValidationFailure(analysisId: string, reasons: string[]): string {
  const recordedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(FAILURE_LOG), { recursive: true });
  fs.appendFileSync(FAILURE_LOG, `${JSON.stringify({ analysis_id: analysisId, recorded_at: recordedAt, reasons })}\n`);
  return recordedAt;
}

/**
 * The whole adapter. Fire-and-forget on the Monitor side, exactly like every
 * other reporter in this repo: a Monitor that is down must never break the
 * process that had something to report.
 */
export async function publishAnalysis(validation: ValidationResult, input: SandboxInput): Promise<PublishOutcome> {
  if (!validation.ok) {
    const recordedAt = recordValidationFailure(input.analysis_id, validation.reasons);
    return { published: false, kind: "VALIDATION_FAILED", reasons: validation.reasons, recorded_at: recordedAt };
  }

  const output = validation.output;
  const launchId = `${AI_REPORT_MARKER}:${output.analysis_id}`;

  if (output.insufficient_evidence) {
    // Exactly one record, saying only that the evidence was not enough. No
    // finding, no anomaly, no guess.
    await reportViolation({
      launch_id: launchId,
      reason: "INSUFFICIENT_EVIDENCE",
      detail: `analysis_id=${output.analysis_id} window=${input.window.from}..${input.window.to} events_in_window=${input.events.length} findings=0`,
      source: ADAPTER_SOURCE,
      enforced: false,
    });
    return { published: true, kind: "INSUFFICIENT_EVIDENCE", records: 1, launch_id: launchId };
  }

  const reportable = output.findings.filter((finding) => finding.anomaly_class !== "NONE" && finding.anomaly_class !== "INSUFFICIENT_EVIDENCE");
  for (const finding of reportable) {
    await reportViolation({
      launch_id: launchId,
      // An enum from the output contract, not prose.
      reason: finding.anomaly_class,
      detail: composeDetail(finding),
      source: ADAPTER_SOURCE,
      // Nothing was blocked or acted on. This is an observation.
      enforced: false,
    });
  }
  return { published: true, kind: "FINDINGS", records: reportable.length, launch_id: launchId };
}
