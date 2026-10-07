/**
 * หน้าที่: the `RegistrationCandidate` for the real, verified
 * WORK_ID -> PROCESS_ID -> RESOURCE_USAGE -> COST -> EVIDENCE capability,
 * submitted through `control/registration-pipeline/`'s existing
 * Validation -> Classification -> Duplicate Resolution -> Decision ->
 * Repository Resolution -> Registry Writer stages into
 * `software/registry-database/`'s canonical persistent store. No new
 * registry, no new pipeline, no direct write.
 *
 * WHY THIS IS A `RegistrationCandidate` AND NOT A `CapabilityMetadata`:
 * this folder's sibling `./local-qwen-semantic-check.ts` is a
 * `CapabilityMetadata` record — the Step-1 shape that nothing consumes yet
 * (see ../README.md). The Registration Pipeline consumes
 * `control/event-pipeline/registration-contract.ts`'s
 * `RegistrationCandidate` instead, and that pipeline is the ONLY path to
 * the persistent registry. Using the shape the real pipeline accepts is
 * what makes this an actual registration rather than another inert record.
 *
 * EVERY FIELD BELOW IS EVIDENCE, NOT DESCRIPTION. `evidence_refs` name real
 * files and real verified work ids that exist right now; the behaviour
 * string describes what was actually proven to run, not what is intended.
 *
 * Input: none (one const value).
 * Output: `REAL_WORK_RESOURCE_COST_CANDIDATE`.
 * Dependency ที่อนุญาต: `../../../control/event-pipeline/registration-contract.ts`
 * (type only).
 * สิ่งที่ห้ามแตะ: never edit `evidence_refs` to point at something that has
 * not been verified — Duplicate Resolution fingerprints the candidate's
 * normalized content, so a cosmetic edit to an already-registered record
 * produces a SECOND resource rather than an update. Never add
 * `requested_owner`/`requested_repository` unless BOTH are real ids in
 * `software/repository-registry/`: exactly one present is always REJECTED,
 * and both absent is a legitimate NOT_APPLICABLE.
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

/**
 * The capability lives in the sibling DNA-LAB-PERMISSION-REASONER checkout,
 * where research.db, dna_os.db and the existing measurement/pricing code all
 * are. `source_location` says so plainly rather than pretending the code sits
 * in this repo — the same honesty `control/command-router/capability-registry.ts`'s
 * own header demands about external repos.
 */
export const REAL_WORK_RESOURCE_COST_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-real-work-resource-cost-measurement-v1",
  name: "real-work-resource-cost-measurement",
  kind: "capability",
  source_location: "DNA-LAB-PERMISSION-REASONER/research/measurements/ (sibling checkout — process_probe.py, work_cost.py, compute_source.py, workload_profile.py)",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/real-work-resource-cost-measurement.ts",

  input: [
    "work_id",
    "argv/cwd/env describing real work to execute",
    "compute_source_id (resolved against the compute source registry)",
  ],
  output: [
    "ProcessResourceUsage: pid, host_id, os, architecture, duration_ms, cpu_user/system/total_ms, ram_peak/footprint_bytes, disk_read/write_bytes, network_in/out_bytes, gpu_runtime_ms, gpu_utilization, vram_peak_bytes, input/output/cached/reasoning_tokens — each with source, method and evidence class",
    "WorkCost: rate card (COMPUTE/GPU/STORAGE/NETWORK/AI/FX), per-component cost in integer micro-USD, total, billing identity",
    "frozen, sha256-sealed evidence ledger entry",
  ],
  side_effects: [
    "spawns one real child process and measures it",
    "writes to existing research.db tables only (executions, raw_measurements, experiments, run_identities, runs, hardware_profiles)",
    "appends one sealed row per verified work item to research/reports/frozen_work_evidence.jsonl",
    "reads dna_os.db read-only for rate cards",
  ],
  dependencies: [
    "control/runtime-adapter (process launch boundary)",
    "software/registry-database (this registration's own destination)",
    "DNA-LAB-PERMISSION-REASONER/research/formulas/registry.py (WORK_RESOURCE_COST v1, STORAGE_IO_COST v1, NETWORK_COST v1, AI_PROVIDER_COST v1)",
    "control/infrastructure-billing (integer minor-unit money discipline)",
    "dna-os-compute-api :8788 (read surfaces: /api/compute/sources, /api/pricing/rate-cards, /api/execution/resource-evidence, /api/execution/cost, /api/evidence/frozen)",
  ],

  behavior:
    "measure_one_real_process_and_price_it: binds a work_id to a real pid at spawn, samples kernel per-process counters while it runs, reads exact totals at exit via waitid(WNOWAIT) without reaping, resolves a rate card from evidence rows, computes each cost component through a registered versioned formula in integer micro-USD, and writes the result plus its full sample series back into the existing research tables. Any metric the host cannot measure is recorded as NULL with the OS-level reason and is never substituted with 0.",

  version: "1.0.0",

  // Real, checkable references only. The six work ids are verified work
  // items sitting in research.db and in the sealed ledger right now.
  evidence_refs: [
    "DNA-LAB-PERMISSION-REASONER/research/measurements/process_probe.py",
    "DNA-LAB-PERMISSION-REASONER/research/measurements/work_cost.py",
    "DNA-LAB-PERMISSION-REASONER/research/measurements/compute_source.py",
    "DNA-LAB-PERMISSION-REASONER/research/measurements/workload_profile.py",
    "DNA-LAB-PERMISSION-REASONER/research/experiments/run_real_work.py",
    "DNA-LAB-PERMISSION-REASONER/research/experiments/verify_real_work.py",
    "DNA-LAB-PERMISSION-REASONER/research/experiments/freeze_evidence.py",
    "DNA-LAB-PERMISSION-REASONER/tests/test_work_cost_chain.py (7 tests, passing)",
    "DNA-LAB-PERMISSION-REASONER/research/reports/frozen_work_evidence.jsonl",
    "verified work item work-7812a7c34417 (permission-suite, CPU-heavy)",
    "verified work item work-30bdba924534 (disk-io, 64MiB written and read back)",
    "verified work item work-8b99f69b1e6a (external-api, live third-party HTTPS)",
  ],

  // SOFTWARE_CONTROL_PLANE, not ENGINEERING_EVIDENCE. The first submission
  // declared ENGINEERING_EVIDENCE and Classification rejected it with
  // DOMAIN_RESOURCE_TYPE_MISMATCH — correctly. What is being registered is a
  // CAPABILITY (software that runs), and the ground-truth map in
  // control/event-pipeline/domain-classification.ts puts every CAPABILITY in
  // SOFTWARE_CONTROL_PLANE. The evidence this capability PRODUCES is
  // engineering evidence; the capability itself is not. Conflating the two
  // would have filed a piece of software in the evidence domain.
  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "measurement/compute/cost",

  // Deliberately absent, both of them. The code lives in a sibling checkout
  // that software/repository-registry/ does not hold an id for, and a claim
  // that cannot be resolved must not be made: Repository Resolution treats
  // both-absent as a legitimate NOT_APPLICABLE and exactly-one-present as
  // REJECTED. Guessing a repository id here would put a false ownership
  // record into the canonical registry.
};
