/**
 * หน้าที่: proves `control/realtime-change/` against the real filesystem, the
 * real registries and a real cooperating process (Owner, 2026-08-26).
 *
 * The cases that matter most are the negative ones: an unrelated change must
 * interrupt nobody, and an unavailable observer must report itself unavailable
 * rather than produce a quiet, empty, reassuring result.
 *
 * How to run: npx tsx control/realtime-change/tests/realtime-change-proof.test.ts
 */

declare const require: any;
declare const process: { exit(code?: number): never; argv: string[] };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const setTimeout: any;

import { startObserving, stopObserving, observationStatus, resolvePath, findRelatedWork, buildInterrupt, buildImpactContext, deliverInterrupt, deliverContext, readInterrupt, readAck, writeAck, changeFlowCircuitGraph, toRepoRelative } from "../contract";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";
import type { ChangeEvent } from "../types";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}
const sleep = (ms: number) => new Promise((resolve: any) => setTimeout(resolve, ms));

async function run(): Promise<void> {
  console.log("=== control/realtime-change/tests/realtime-change-proof.test.ts ===");
  const store = createPersistentFileStore();

  // An observer that was never started must say so, not return an empty scope list.
  stopObserving();
  const idle = observationStatus();
  assert(idle.observing === false && idle.reason === "OBSERVATION_UNAVAILABLE", "an unstarted observer reports OBSERVATION_UNAVAILABLE");
  console.log("PASS: unavailable observer reports OBSERVATION_UNAVAILABLE, no fabricated event");

  // Real watch, real external write, real event.
  const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), "dna-os-watch-"));
  const events: ChangeEvent[] = [];
  const status = startObserving((event) => events.push(event), [{ path: watchDir, origin: "EXPLICIT_REQUEST", origin_ref: "test" }]);
  assert(status.observing === true, "the observer started on a real directory");

  const target = path.join(watchDir, "external.txt");
  // Written by /bin/sh, not by this process — the write bypasses DNA OS entirely.
  execFileSync("/bin/sh", ["-c", `printf 'external\\n' > ${target}`]);
  await sleep(600);
  assert(events.length > 0, "an external shell write produced a real CHANGE_EVENT");
  const event = events.find((e) => e.path.endsWith("external.txt"))!;
  assert(event.filesystem_evidence.exists && event.filesystem_evidence.inode !== null, "the event carries real stat evidence from the OS");
  assert(event.source.includes("fs.watch"), "the event names the observing mechanism, not a guessed author process");
  console.log(`PASS: external write observed — ${event.event_type} ${path.basename(event.path)} inode=${event.filesystem_evidence.inode}`);
  stopObserving();

  // Path resolves to the identities that already exist — never a new one.
  const resolved = resolvePath("execution/run/registry.ts", store);
  assert(resolved.capability?.capability_id === "execution", `a real source path resolves to its registered capability, got ${resolved.capability?.capability_id}`);
  assert(resolved.resource !== null && resolved.resource.resource_id.startsWith("resource-"), "the same path resolves to the resource identity the registry already holds");
  assert(resolved.resource!.evidence.some((e) => e.startsWith("matched_form=")), "the resolution records which source_location form matched");
  console.log(`PASS: path -> capability=${resolved.capability!.capability_id}, resource=${resolved.resource!.resource_id}`);

  // Nothing is being worked on: no overlap, therefore no interrupt.
  const unrelated = findRelatedWork("execution/run/registry.ts");
  assert(unrelated.write_lock === null && unrelated.active_launch === null, "no active work claims this path");
  assert(buildInterrupt(event, unrelated) === null, "no proven overlap produces NO interrupt — an unrelated agent is never woken");
  console.log("PASS: unrelated change interrupts nobody");

  // The two channels are separate files, and the ack is read, not assumed.
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dna-os-ws-"));
  const proven = { write_lock: { holder: "test-holder", scope_path: "execution/run", evidence: ['scopesOverlap("execution/run","execution/run/registry.ts")=true'] }, active_launch: null, overlap_evidence: ['scopesOverlap("execution/run","execution/run/registry.ts")=true'] };
  const interrupt = buildInterrupt(event, proven)!;
  assert(interrupt.authorizes === "NOTHING", "the interrupt states that it authorizes nothing");
  assert(!JSON.stringify(interrupt).includes("grant") && !JSON.stringify(interrupt).includes("capability_id"), "the interrupt carries no grant and no capability");
  const impact = buildImpactContext(event, store, null);

  assert(deliverInterrupt(workspace, interrupt).delivered === true, "the interrupt is delivered");
  assert(deliverContext(workspace, impact).delivered === true, "the context is delivered");
  const inbox = fs.readdirSync(path.join(workspace, ".dna-os")).sort();
  assert(inbox.includes("interrupt.json") && inbox.includes("change-context.json"), `interrupt and context are two separate files, got ${inbox.join(",")}`);
  assert(readAck(workspace) === null, "no ack exists until the execution really writes one — never assumed");
  console.log("PASS: interrupt and context delivered on separate channels; ack absent until written");

  // The receiving half, as a cooperating execution would use it.
  const received = readInterrupt(workspace)!;
  writeAck(workspace, { interrupt_id: received.interrupt_id, acknowledged_at: new Date().toISOString(), state: "PAUSED", current_step: "test-step", note: null });
  const ack = readAck(workspace)!;
  assert(ack.state === "PAUSED" && ack.interrupt_id === interrupt.interrupt_id, "the ack read back is the one the execution wrote");
  console.log(`PASS: ack observed — state=${ack.state}`);

  // Five directed edges, none decorative.
  const graph = changeFlowCircuitGraph();
  assert(graph.edges.length === 5, `the change flow renders as five directed edges, got ${graph.edges.length}`);
  assert(graph.edges.every((e) => e.direction && e.evidence.length > 0), "every edge is directed and carries evidence");
  assert(new Set(graph.edges.map((e) => `${e.from}->${e.to}`)).size === 5, "no two edges duplicate the same direction");
  console.log(`PASS: ${graph.edges.length} directed edges, all with evidence`);

  console.log("=== ALL realtime-change-proof.test.ts CASES PASSED ===");
  process.exit(0);
}

run().catch((error) => { console.error(error); process.exit(1); });
