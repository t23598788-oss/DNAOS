/**
 * หน้าที่: feeds this layer's evidenced observations into the EXISTING
 * lifecycle runtime — `software/live-census/` — without creating a second
 * anything (Owner, 2026-08-26).
 *
 * WHAT THE EXISTING RUNTIME ALREADY IS, named honestly: the Owner's task used
 * `runtimeConsumer` / `temporalConsumer` / `canonicalLifecycleReport` /
 * `lifecycleCircuit` / `actuator`. None of those identifiers exist in this
 * repository (grep: zero hits). What DOES exist, and what this file connects
 * to, is:
 *   canonical report  -> software/live-census `observeCensus()` -> LiveCensus
 *   runtime consumer  -> `CapabilityRecord.runtime_state` (RUNNING / REGISTERED_NOT_RUNNING / UNKNOWN)
 *   temporal history  -> `deriveDrift(previous, current)` + data/verification-ledger.jsonl
 *   lifecycle circuit -> dna-os-circuit's HTTP graphs
 *   actuator          -> MISSING; no mutation-boundary component exists by any name
 *
 * WHY IT ENRICHES RATHER THAN REPLACES: live-census decides `runtime_state`
 * from `liveRepoProcesses()` — `ps -Ao command` lines that CONTAIN the
 * capability's path. That is a command-string match: a process merely mentioning
 * a path counts, and a process genuinely working in it under a different
 * command line does not. This file offers the same question answered from OS
 * evidence — the mapped binary, the real cwd, the open descriptors — and leaves
 * the existing derivation in place beside it.
 *
 * IT WRITES NOTHING AND MUTATES NOTHING. No store, no ledger, no cleanup. The
 * lifecycle recomputes itself from digests on the next read, which is the
 * existing invalidation mechanism, not one added here.
 *
 * Input: a repo-relative path + candidate pids.
 * Output: `RuntimeConsumerEvidence` and `IngestionRecord` — shapes the existing
 * records can carry, never a parallel schema.
 * Dependency ที่อนุญาต: ./process-observer.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามสร้าง store/graph/ledger ที่สอง.
 * - ห้ามเขียนหรือลบอะไรจากไฟล์นี้ — observation layer ไม่ mutate.
 * - ห้ามตัด `liveRepoProcesses()` เดิมทิ้ง — enrich เท่านั้น.
 */

declare const require: any;

import type { MeaningRecord, ObservedRelationship, ProcessObservation } from "./types";
import { listProcesses, observeProcesses } from "./process-observer";

const fs = require("node:fs");

const REPO_ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";

export type RuntimeConsumerState = "IN_USE_NOW" | "NO_CONSUMER_OBSERVED" | "SNAPSHOT_UNAVAILABLE";

export interface RuntimeConsumerEvidence {
  path: string;
  state: RuntimeConsumerState;
  /** The pids that were proven to be using it, with the field that proved it. */
  consumers: readonly { pid: number; how: "HOLDS_OPEN" | "WORKING_DIRECTORY"; evidence: string }[];
  /** Never invented: when lsof could not be read for every candidate, this says so and the state is SNAPSHOT_UNAVAILABLE. */
  unknown: readonly string[];
  observed_at: string;
}

function realPath(candidate: string): string {
  try { return String(fs.realpathSync(candidate)); } catch { return candidate; }
}

/**
 * Answers "is anything actually using this path right now" from descriptors and
 * working directories — not from a command line that happens to mention it.
 *
 * `SNAPSHOT_UNAVAILABLE` is a real answer: if no candidate could be observed at
 * all, "nothing is using it" would be a claim the snapshot cannot support.
 */
export function runtimeConsumerEvidenceFor(repoRelativePath: string, candidatePids?: readonly number[]): RuntimeConsumerEvidence {
  const absolute = realPath(`${REPO_ROOT}/${repoRelativePath}`);
  const pids = candidatePids ?? listProcesses().map((row) => row.pid);
  const observations = observeProcesses(pids);
  const consumers: { pid: number; how: "HOLDS_OPEN" | "WORKING_DIRECTORY"; evidence: string }[] = [];
  const unknown: string[] = [];

  for (const observation of observations) {
    if (observation.unknown.length > 0 && observation.executable === null && observation.cwd === null) {
      unknown.push(`pid ${observation.pid}: not observable (${observation.unknown[0]})`);
      continue;
    }
    const held = observation.open_files.find((file) => {
      const real = realPath(file);
      return real === absolute || real.startsWith(`${absolute}/`);
    });
    if (held) {
      consumers.push({ pid: observation.pid, how: "HOLDS_OPEN", evidence: `lsof -p ${observation.pid} -Fpftn lists ${realPath(held)}` });
      continue;
    }
    const cwd = observation.cwd === null ? null : realPath(observation.cwd);
    if (cwd !== null && cwd !== "/" && (cwd === absolute || cwd.startsWith(`${absolute}/`))) {
      consumers.push({ pid: observation.pid, how: "WORKING_DIRECTORY", evidence: `lsof -p ${observation.pid} -Fpftn (fcwd)=${cwd}` });
    }
  }

  const observable = observations.length - unknown.length;
  const state: RuntimeConsumerState = consumers.length > 0 ? "IN_USE_NOW" : observable === 0 ? "SNAPSHOT_UNAVAILABLE" : "NO_CONSUMER_OBSERVED";
  return { path: repoRelativePath, state, consumers, unknown, observed_at: new Date().toISOString() };
}

/**
 * Candidate pids for this repository, from `ps` argv only. A CANDIDATE step:
 * membership in a runtime-consumer answer is still decided below by the real
 * cwd/descriptor evidence, never by the command line. It exists so a census
 * over 100+ capabilities runs one bounded set of lsof calls instead of one per
 * capability over every pid on the machine.
 */
export function candidatePidsForRepo(repoRoot: string = REPO_ROOT): readonly number[] {
  return listProcesses().filter((row) => row.argv.includes(repoRoot)).map((row) => row.pid);
}

/**
 * One lsof pass, many paths. Answers the runtime-consumer question for a whole
 * census in a single observation, so the answers all describe the same instant
 * rather than drifting across a long scan.
 */
export function runtimeConsumerSnapshot(repoRelativePaths: readonly string[], candidatePids?: readonly number[]): Map<string, RuntimeConsumerEvidence> {
  const pids = candidatePids ?? candidatePidsForRepo();
  const observations = observeProcesses(pids);
  const observedAt = new Date().toISOString();
  const unobservable = observations.filter((observation) => observation.executable === null && observation.cwd === null).length;
  const result = new Map<string, RuntimeConsumerEvidence>();

  for (const repoRelativePath of repoRelativePaths) {
    const absolute = realPath(`${REPO_ROOT}/${repoRelativePath}`);
    const consumers: { pid: number; how: "HOLDS_OPEN" | "WORKING_DIRECTORY"; evidence: string }[] = [];
    for (const observation of observations) {
      // Evidence must point DOWN INTO the capability, not merely contain it.
      // Measured 2026-08-26: comparing the other way made every process sitting
      // at the repository root count as a consumer of all 123 capabilities, so
      // the whole census derived to IN_USE_NOW. A process at the repo root is
      // evidence for the repository, not for any capability inside it.
      const held = observation.open_files.find((file) => {
        const real = realPath(file);
        return real === absolute || real.startsWith(`${absolute}/`);
      });
      if (held) {
        consumers.push({ pid: observation.pid, how: "HOLDS_OPEN", evidence: `lsof -p ${observation.pid} -Fpftn lists ${realPath(held)}` });
        continue;
      }
      const cwd = observation.cwd === null ? null : realPath(observation.cwd);
      if (cwd !== null && cwd !== "/" && (cwd === absolute || cwd.startsWith(`${absolute}/`))) {
        consumers.push({ pid: observation.pid, how: "WORKING_DIRECTORY", evidence: `lsof -p ${observation.pid} -Fpftn (fcwd)=${cwd}` });
      }
    }
    const observable = observations.length - unobservable;
    result.set(repoRelativePath, {
      path: repoRelativePath,
      state: consumers.length > 0 ? "IN_USE_NOW" : observable === 0 ? "SNAPSHOT_UNAVAILABLE" : "NO_CONSUMER_OBSERVED",
      consumers,
      unknown: unobservable > 0 ? [`${unobservable} candidate process(es) could not be observed`] : [],
      observed_at: observedAt,
    });
  }
  return result;
}

/**
 * One ingestion record — every field the Owner required, carried on the shapes
 * the existing records already hold. This is a projection for handoff, not a
 * new persistent store: nothing in this file writes it anywhere.
 */
export interface IngestionRecord {
  event_id: string;
  resource_id: string | null;
  path: string;
  observed_at: string;
  process_evidence: readonly string[];
  relationship_evidence: readonly string[];
  meaning_records: readonly MeaningRecord[];
  source: string;
  derived_by: string;
}

export function buildIngestionRecord(input: {
  eventId: string;
  resourceId: string | null;
  path: string;
  observedAt: string;
  processes: readonly ProcessObservation[];
  relationships: readonly ObservedRelationship[];
  meanings: readonly MeaningRecord[];
}): IngestionRecord {
  return {
    event_id: input.eventId,
    resource_id: input.resourceId,
    path: input.path,
    observed_at: input.observedAt,
    process_evidence: input.processes.flatMap((observation) => [
      `pid=${observation.pid} ppid=${observation.ppid} user=${observation.user}`,
      `executable=${observation.executable ?? "UNKNOWN"}`,
      `cwd=${observation.cwd ?? "UNKNOWN"}`,
    ]),
    relationship_evidence: input.relationships.flatMap((relationship) => relationship.evidence),
    meaning_records: input.meanings,
    source: "control/machine-observation (ps + lsof + fs.watch)",
    derived_by: "control/machine-observation/lifecycle-bridge.ts#buildIngestionRecord",
  };
}
