/**
 * หน้าที่: proves `control/machine-observation/` against THIS Mac — real
 * processes, real `lsof`, a real write (Owner, 2026-08-26).
 *
 * The assertions that matter are the refusals: a process whose name matches an
 * application but whose mapped binary does not must NOT be claimed, and a
 * correlation must not reach PROVEN without a real descriptor.
 *
 * How to run: npx tsx control/machine-observation/tests/machine-observation-proof.test.ts
 */

declare const require: any;
declare const process: { exit(code?: number): never; pid: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const setTimeout: any;

import { listProcesses, observeProcesses, relationshipsFor, bundleOf, topologyFor, correlate, strongestVerdict, deriveMeaning, observationCircuitGraph } from "../contract";
import { startObserving, stopObserving } from "../../realtime-change/contract";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";
import type { ChangeEvent } from "../../realtime-change/contract";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}
const sleep = (ms: number) => new Promise((resolve: any) => setTimeout(resolve, ms));

async function run(): Promise<void> {
  console.log("=== control/machine-observation/tests/machine-observation-proof.test.ts ===");

  // Real process table, real lsof, for this very process.
  const rows = listProcesses();
  assert(rows.length > 10, `the process table is read from ps, got ${rows.length} rows`);
  const self = observeProcesses([process.pid])[0];
  assert(self.executable !== null, "the mapped executable is read from lsof ftxt, not from the process name");
  assert(self.cwd !== null, "the working directory is read from lsof fcwd");
  assert(self.ppid > 0, "lineage comes from ps ppid");
  console.log(`PASS: self observed — pid=${self.pid} executable=${path.basename(self.executable!)} cwd=${self.cwd}`);

  // Every relationship carries the command and field it came from.
  const edges = relationshipsFor(self);
  assert(edges.length > 0 && edges.every((e) => e.evidence.length > 0), "every observed relationship carries OS evidence");
  assert(edges.some((e) => e.kind === "EXECUTES") && edges.some((e) => e.kind === "CHILD_OF"), "EXECUTES and CHILD_OF are produced from real fields");
  console.log(`PASS: ${edges.length} relationships, all evidenced`);

  // A name that matches an application is NOT ownership.
  const notAnApp = topologyFor("/Applications/Definitely Not Installed.app", [process.pid]);
  assert(notAnApp.application === null && notAnApp.processes.length === 0, "a process is never claimed for a bundle its mapped binary is not inside");
  assert(notAnApp.unknown.length > 0 && notAnApp.unknown[0].includes(String(process.pid)), "the rejection says which pid was refused and why");
  console.log(`PASS: bundle membership is a path fact — ${notAnApp.unknown[0].slice(0, 90)}`);
  assert(bundleOf("/Applications/Visual Studio Code.app/Contents/MacOS/Code") === "/Applications/Visual Studio Code.app", "bundleOf reads the bundle out of the real path");
  assert(bundleOf("/bin/zsh") === null, "a binary outside any bundle belongs to no application");

  // Real write, real event.
  const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), "dna-os-machine-"));
  const events: ChangeEvent[] = [];
  startObserving((event) => events.push(event), [{ path: watchDir, origin: "EXPLICIT_REQUEST", origin_ref: "machine-test" }]);
  await sleep(300);
  const target = path.join(watchDir, "observed.txt");
  execFileSync("/bin/sh", ["-c", `printf 'x\\n' > ${target}`]);
  await sleep(700);
  stopObserving();
  const event = events.find((e) => e.path.endsWith("observed.txt"));
  assert(event !== undefined, "an external write produced a real filesystem event");
  console.log(`PASS: external write observed (${event!.event_type}, inode=${event!.filesystem_evidence.inode})`);

  // Correlation must not reach PROVEN without a descriptor.
  const before = correlate(event!, [observeProcesses([process.pid])[0]]);
  assert(before[0].verdict !== "PROVEN", `without an open descriptor the verdict is not PROVEN, got ${before[0].verdict}`);
  const fd = fs.openSync(target, "r");
  const after = correlate(event!, [observeProcesses([process.pid])[0]]);
  fs.closeSync(fd);
  assert(after[0].verdict === "PROVEN", "PROVEN is reached only when the process really holds the path open");
  assert(after[0].evidence.some((e: string) => e.includes("lsof")), "the PROVEN verdict cites the lsof line that proves it");
  console.log(`PASS: ${before[0].verdict} -> PROVEN only after a real descriptor existed`);

  // An empty observation set is UNKNOWN, never an assumed writer.
  const none = correlate(event!, []);
  assert(none[0].verdict === "UNKNOWN" && none[0].pid === null, "with no observed process the writer is UNKNOWN");
  console.log("PASS: no observed process -> UNKNOWN, no writer invented");

  // Meaning records: identity reused, never minted; unproven things stay UNKNOWN.
  const store = createPersistentFileStore();
  const meanings = deriveMeaning(event!, store, before[0]);
  assert(meanings.every((m) => m.proof.length > 0), "every meaning record carries proof");
  assert(meanings.every((m) => m.derived_by.includes("machine-observation")), "every meaning names the deterministic code that derived it");
  assert(meanings.some((m) => m.meaning_type === "STATE"), "the observed filesystem state is recorded");
  const softwareMeaning = meanings.find((m) => m.source.startsWith("process:"));
  assert(softwareMeaning === undefined || softwareMeaning.meaning_type === "UNKNOWN", "an unproven software relation is recorded as UNKNOWN, not asserted");
  console.log(`PASS: ${meanings.length} meaning records, all with proof, unproven ones marked UNKNOWN`);

  // The circuit view draws only what is evidenced; the rest becomes visible UNRESOLVED nodes.
  const graph = observationCircuitGraph({ relationships: edges, correlations: [...before, ...none], meanings });
  assert(graph.edges.every((e) => e.evidence.length > 0), "no edge is drawn without evidence");
  assert(graph.nodes.some((n) => n.kind === "unresolved"), "what could not be proven appears as an UNRESOLVED node rather than vanishing");
  console.log(`PASS: ${graph.nodes.length} nodes / ${graph.edges.length} edges, ${graph.nodes.filter((n) => n.kind === "unresolved").length} unresolved shown`);

  // This layer commands nothing.
  // Checked on the EXPORT statements, not on the prose: this contract's own
  // header says the layer "interrupts" nothing, and a substring check flagged
  // that sentence (same trap as an earlier test in this repo).
  const source = fs.readFileSync(path.join(__dirname, "..", "contract.ts"), "utf8");
  const exportedNames = [...source.matchAll(/^export\s*\{([^}]*)\}/gm)].flatMap((match) => match[1].split(",").map((name: string) => name.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "")));
  for (const forbidden of ["interrupt", "deliverinterrupt", "pause", "kill", "stop", "signal"]) {
    const offender = exportedNames.find((name: string) => name.toLowerCase().includes(forbidden));
    assert(offender === undefined, `the observation contract must not export anything named like "${forbidden}" — found ${offender}`);
  }
  assert(exportedNames.length > 0, "the export list was actually parsed");
  console.log("PASS: the observation layer exports no interrupt/pause/kill path");

  console.log("=== ALL machine-observation-proof.test.ts CASES PASSED ===");
  process.exit(0);
}

declare const __dirname: string;
run().catch((error) => { console.error(error); process.exit(1); });
