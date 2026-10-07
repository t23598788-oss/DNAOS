/**
 * หน้าที่: registers `control/runtime-control/` — the bounded Runtime
 * Control Adapter (start/stop/restart/health/status over launchd for
 * deadboard/lab-ui/research-api/compute-api) — through the real,
 * unmodified `control/registration-pipeline/` -> Persistent Software
 * Registry. Duplicate Gate already run manually before this capability was
 * built (see `control/runtime-control/README.md`'s "Duplicate Gate result"
 * section) — zero existing match for runtime-control/process-control/
 * service-control/supervisor/process-manager/launchctl by canonical_name
 * or purpose text.
 *
 * How to run: npx tsx scripts/register-runtime-control-2026-08-22.ts
 */

import { randomUUID } from "node:crypto";
import { runRegistrationPipeline } from "../control/registration-pipeline/contract";
import type { RegistrationCandidate } from "../control/event-pipeline/contract";
import { createPersistentFileStore } from "../software/registry-database/adapters/persistent-file-store";

const store = createPersistentFileStore();

const candidate: RegistrationCandidate = {
  candidate_id: `candidate-${randomUUID()}`,
  name: "runtime-control",
  kind: "capability",
  source_location: "control/runtime-control/contract.ts",
  owner: "dna-os-infrastructure",
  input: ["ServiceId", "Action"],
  output: ["OperationEvidence"],
  side_effects: [
    "issues launchctl bootstrap/bootout/kickstart against four already-registered LaunchAgent labels (com.dnaos.deadboard-dev, com.dnaos.research-monitor-ui, com.dnaos.research-api, com.dnaos.dna-os-compute-api)",
    "issues one read-only HTTP GET health probe per operation against 127.0.0.1:3000/5177/8787/8788",
  ],
  dependencies: [],
  behavior:
    "Bounded Runtime Control Adapter: DNA OS Control -> Runtime Control Adapter -> launchd -> Process -> Health/Evidence -> DNA OS. launchd remains the only real process supervisor/executor; this capability never spawns, forks, or polls in the background. Every operation issues at most one launchctl mutation, waits (bounded, max 10s) for it to settle, then records launchd's own PID claim and a real HTTP health probe as two separate facts, plus real lsof-observed listening PIDs for duplicate detection. A service already loaded/running per launchd is never reported healthy without a real, passing HTTP response. Every operation is appended as durable evidence to control/runtime-control/data/operations.jsonl.",
  version: "1",
  evidence_refs: [
    "control/runtime-control/tests/runtime-control.test.ts",
    "control/runtime-control/data/operations.jsonl",
  ],
  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "internal",
  source_system: "dna-os-infrastructure",
  scope: "local-dev-runtime-lifecycle-control",
};

const result = runRegistrationPipeline(candidate, store, "capability-registration-runtime-control");
console.log(JSON.stringify({ name: candidate.name, result }, null, 2));
