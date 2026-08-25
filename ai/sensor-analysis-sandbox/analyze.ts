/**
 * หน้าที่: the one-way pipeline this capability exists to prove (Owner,
 * 2026-08-26):
 *
 *   dna_os_sensor_reader -> FIXED INPUT CONTRACT -> QWEN SANDBOX -> STRUCTURED OUTPUT CONTRACT
 *
 * Every arrow points forward. This file reads from the sensor's read-only role,
 * projects the allow-listed fields, hands that file to an isolated process, and
 * validates what comes back. There is no return arrow: nothing here writes to
 * Supabase, calls the sensor's ingest, touches the repo on the model's behalf,
 * or executes anything the model produced.
 *
 * Input: env `DNA_OS_SENSOR_URL`, `DNA_OS_SENSOR_ANON_KEY`,
 * `DNA_OS_SENSOR_READER_JWT` (the READ-only role — the writer JWT is not used
 * here and must never be given to this path).
 * Output: `AnalysisRun` — the input that was sent, the raw text that came back,
 * and either the validated structured output or the reasons it was refused.
 * Dependency ที่อนุญาต: ./input-contract.ts, ./output-contract.ts, node built-ins.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามส่ง writer JWT / service_role / secret ใดๆ เข้ามาในไฟล์นี้ — the sandbox
 *   half of this pipeline must stay unable to write by construction.
 * - ห้าม eval/exec ผลลัพธ์ของโมเดล — the only thing done with model output is
 *   parse-and-check.
 */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined>; argv: string[]; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

import { projectEvent, type SandboxInput, type SandboxPatterns } from "./input-contract";
import { validateSandboxOutput, type ValidationResult } from "./output-contract";

const { execFileSync } = require("node:child_process") as { execFileSync: (file: string, args: string[], options: unknown) => { toString(): string } };
const fs = require("node:fs") as { writeFileSync(path: string, data: string): void; mkdirSync(path: string, options: unknown): void; readdirSync(path: string): string[] };
const path = require("node:path") as { join(...parts: string[]): string; dirname(p: string): string };

const PATTERN_NAMES = ["repeated_sequence", "repeated_failure", "joint_health", "latency_outlier", "unexpected_transition"] as const;

interface ReaderConfig { url: string; anonKey: string; readerJwt: string }

function readerConfig(): ReaderConfig {
  const url = process.env.DNA_OS_SENSOR_URL;
  const anonKey = process.env.DNA_OS_SENSOR_ANON_KEY;
  const readerJwt = process.env.DNA_OS_SENSOR_READER_JWT;
  if (!url || !anonKey || !readerJwt) throw new Error("DNA_OS_SENSOR_URL / DNA_OS_SENSOR_ANON_KEY / DNA_OS_SENSOR_READER_JWT must all be set (read-only role)");
  return { url, anonKey, readerJwt };
}

async function callReader(config: ReaderConfig, fn: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${config.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.anonKey, Authorization: `Bearer ${config.readerJwt}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${fn} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

/** Builds the fixed input from the live read-only contract. `taskRef` narrows the window to one real task. */
export async function buildInputFromSensor(analysisId: string, taskRef?: string): Promise<SandboxInput> {
  const config = readerConfig();
  const rawEvents = (await callReader(config, "dna_os_sensor_events", taskRef ? { p_task_ref: taskRef, p_limit: 1000 } : { p_limit: 1000 })) as Record<string, unknown>[];
  const events = rawEvents.map(projectEvent);
  const patterns = {} as Record<string, unknown[]>;
  for (const name of PATTERN_NAMES) patterns[name] = (await callReader(config, "dna_os_sensor_pattern", { p_name: name })) as unknown[];
  return {
    analysis_id: analysisId,
    window: {
      from: events.length > 0 ? events[0].occurred_at : "EMPTY",
      to: events.length > 0 ? events[events.length - 1].occurred_at : "EMPTY",
    },
    patterns: patterns as unknown as SandboxPatterns,
    events,
  };
}

export interface AnalysisRun {
  input: SandboxInput;
  raw_output: string;
  validation: ValidationResult;
  sandbox_dir: string;
}

/**
 * Runs the sandbox on an input. The sandbox directory is created fresh and
 * contains exactly one file — the input — so "the model can only see what it
 * was given" is enforced by the filesystem, not by asking it nicely.
 */
export function runSandbox(input: SandboxInput, sandboxDir: string): AnalysisRun {
  fs.mkdirSync(sandboxDir, { recursive: true });
  const inputFile = path.join(sandboxDir, "input.json");
  fs.writeFileSync(inputFile, JSON.stringify(input, null, 1));

  const launcher = path.join(__dirname, "run-sandbox.sh");
  const raw = execFileSync(launcher, [sandboxDir, "input.json"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).toString();

  return { input, raw_output: raw, validation: validateSandboxOutput(raw, input), sandbox_dir: sandboxDir };
}

declare const __dirname: string;

async function main(): Promise<void> {
  const taskRef = process.argv[2];
  const sandboxDir = process.argv[3] ?? "/tmp/dna-os-sensor-sandbox";
  const input = await buildInputFromSensor(`analysis-${taskRef ?? "all"}`, taskRef === "ALL" ? undefined : taskRef);
  const run = runSandbox(input, sandboxDir);
  console.log(JSON.stringify({ input_events: input.events.length, validation: run.validation, raw_output: run.raw_output }, null, 1));
}

if (require("node:process").argv[1]?.endsWith("analyze.ts")) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
