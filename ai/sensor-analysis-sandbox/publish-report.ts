/**
 * หน้าที่: the entrypoint that walks the whole one-way path end to end
 * (Owner, 2026-08-26):
 *
 *   dna_os_sensor READ ONLY -> input-contract -> Qwen Sandbox
 *     -> output-contract + deterministic validator -> report-adapter -> MONITOR
 *
 * Deliberately a separate file from ./analyze.ts: analyze.ts must stay usable
 * as read-analyse-validate with no Monitor coupling at all, so that the step
 * which publishes is always an explicit, separate decision by a process
 * outside the sandbox.
 *
 * Input: env for the READ-only sensor role (see ./analyze.ts) + the Monitor's
 * own `JOINT_MONITOR_URL`/`JOINT_MONITOR_SHARED_SECRET`. Note that these two
 * sets never meet inside the sandbox process — the model runs with `env -i`
 * and sees neither.
 * Output: prints the publish outcome as JSON.
 * Dependency ที่อนุญาต: ./analyze.ts, ./report-adapter.ts.
 * สิ่งที่ห้ามแตะ: ห้ามส่งอะไรกลับเข้า sandbox — this file ends the path.
 */

declare const require: any;
declare const process: { argv: string[]; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

import { buildInputFromSensor, runSandbox } from "./analyze";
import { publishAnalysis } from "./report-adapter";

async function main(): Promise<void> {
  const taskRef = process.argv[2];
  const sandboxDir = process.argv[3] ?? "/tmp/dna-os-sensor-sandbox-publish";
  const input = await buildInputFromSensor(`analysis-${taskRef ?? "all"}-${process.argv[4] ?? "run"}`, taskRef === "ALL" ? undefined : taskRef);
  const run = runSandbox(input, sandboxDir);
  const outcome = await publishAnalysis(run.validation, input);
  console.log(JSON.stringify({
    analysis_id: input.analysis_id,
    input_events: input.events.length,
    validation_ok: run.validation.ok,
    findings: run.validation.ok ? run.validation.output.findings.length : 0,
    publish_outcome: outcome,
  }, null, 1));
}

main().catch((error) => { console.error(error); process.exit(1); });
