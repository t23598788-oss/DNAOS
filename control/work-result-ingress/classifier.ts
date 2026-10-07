/**
 * หน้าที่: classifies a Work Result's contents and splits them into
 * individual Registration Candidates — a handoff carrying 3 changed
 * files + 1 test result + 1 new capability becomes 5 separate
 * candidates, never one resource standing in for the whole handoff.
 * Pure, no I/O, no registration decision made here — that's
 * ./ingress.ts's job via the real Registration Pipeline.
 *
 * Splitting rule (deterministic, no guessing):
 *   files_changed[]           -> one SOURCE_REFERENCE candidate each
 *   tests_run[]                -> one TEST_RESULT candidate each
 *   capabilities_introduced[]  -> one CAPABILITY candidate each (only
 *                                 ever registered when the agent
 *                                 explicitly names it — never inferred
 *                                 from files_changed)
 *
 * Input: `WorkResultInput`.
 * Output: `splitWorkResultIntoCandidates` -> `RegistrationCandidate[]`.
 * Dependency ที่อนุญาต: ./types.ts, ../event-pipeline/contract.ts (types only), node:crypto.
 * สิ่งที่ห้ามแตะ: never let a generated candidate's evidence_refs differ
 * from the submitting agent's own declared evidence_refs — no candidate
 * gets evidence this file invents itself.
 */

import { randomUUID } from "node:crypto";
import type { RegistrationCandidate } from "../event-pipeline/contract";
import type { WorkResultInput } from "./types";

export function splitWorkResultIntoCandidates(input: WorkResultInput): RegistrationCandidate[] {
  const base = {
    owner: input.agent_id,
    version: "1.0.0",
    evidence_refs: input.evidence_refs,
    dependencies: [] as readonly string[],
    side_effects: [] as readonly string[],
    input: [] as readonly string[],
    output: [] as readonly string[],
    domain: "SOFTWARE_CONTROL_PLANE" as const,
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: "work_result_ingress",
  };

  const candidates: RegistrationCandidate[] = [];

  for (const file of input.files_changed) {
    candidates.push({
      ...base,
      candidate_id: `work-result-${input.task_id}-file-${randomUUID()}`,
      name: file,
      kind: "resource",
      source_location: file,
      behavior: `file changed by task_id=${input.task_id} agent_id=${input.agent_id} role=${input.role}`,
      resource_type: "SOURCE_REFERENCE",
    });
  }

  for (const test of input.tests_run) {
    candidates.push({
      ...base,
      candidate_id: `work-result-${input.task_id}-test-${randomUUID()}`,
      name: test,
      kind: "resource",
      source_location: test,
      behavior: `test run by task_id=${input.task_id} agent_id=${input.agent_id} role=${input.role}`,
      domain: "ENGINEERING_EVIDENCE",
      resource_type: "TEST_RESULT",
    });
  }

  for (const capability of input.capabilities_introduced ?? []) {
    candidates.push({
      ...base,
      candidate_id: `work-result-${input.task_id}-capability-${randomUUID()}`,
      name: capability.name,
      kind: "capability",
      source_location: capability.source_location,
      behavior: capability.purpose,
      resource_type: "CAPABILITY",
    });
  }

  return candidates;
}
