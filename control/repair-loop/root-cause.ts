/**
 * หน้าที่: decide WHAT a gap actually is, from the records and the source
 * that produced it — never from the fact that it looks red.
 *
 * THE RULE THIS FILE EXISTS FOR: "Do not assume the block is a code defect."
 * A BLOCKED edge in the graph can be an expected policy refusal, a
 * deliberately-terminated by-design path, a genuinely missing connection, a
 * contract defect, an implementation defect, or simply missing evidence.
 * Dispatching a repair agent at the first three would send it to "fix"
 * something that is working exactly as intended — which is how a self-repair
 * loop starts damaging a healthy system.
 *
 * Every classification below is reached by READING: the evidence row's own
 * `source`, the emitting line, and the call site that produced the state.
 * When the source does not settle it, the answer is UNDETERMINED and the gap
 * is NOT dispatched. UNDETERMINED is a safe, useful answer; a confident wrong
 * one is not.
 *
 * Input: a `GapRecord`.
 * Output: `analyzeRootCause` -> `RootCauseFinding`.
 * Dependency ที่อนุญาต: ./types.ts, node:fs (reading real source only).
 * สิ่งที่ห้ามแตะ: never classify from the reason STRING alone — every branch
 * must cite a real file and line it read. Never return a class more specific
 * than the evidence supports.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GapRecord, RepairType, RootCauseClass } from "./types";

const REPO_ROOT = join(__dirname, "..", "..");

export interface RootCauseFinding {
  readonly gap_id: string;
  readonly root_cause_class: RootCauseClass;
  readonly failed_boundary: string;
  readonly emitting_site: string | null;
  readonly call_site: string | null;
  readonly observed_state: string;
  readonly expected_contract: string;
  readonly repair_required: boolean;
  readonly repair_type: RepairType | null;
  readonly reasoning: readonly string[];
  readonly source_evidence: readonly string[];
}

function readRepoFile(relativePath: string): string | null {
  const full = join(REPO_ROOT, relativePath);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

/** Find every line that emits this exact reason string, with its file and line number. */
function findEmittingSites(reason: string, candidateFiles: readonly string[]): { file: string; line: number; text: string }[] {
  const hits: { file: string; line: number; text: string }[] = [];
  for (const file of candidateFiles) {
    const content = readRepoFile(file);
    if (!content) continue;
    content.split("\n").forEach((text, index) => {
      if (text.includes(reason)) hits.push({ file, line: index + 1, text: text.trim() });
    });
  }
  return hits;
}

/**
 * Files that could plausibly emit a gateway reason. Deliberately a short,
 * explicit list rather than a repo-wide scan: the Owner's rule is that an
 * agent must not blindly scan the repository, and the same discipline applies
 * to the analyzer that decides whether to call one.
 */
const GATEWAY_SOURCES: readonly string[] = [
  "control/agent-gateway/gateway.ts",
  "control/agent-gateway/controller.ts",
  "control/external-system-lifecycle/pipeline.ts",
  "connections/n8n/event-router.ts",
];

export function analyzeRootCause(gap: GapRecord): RootCauseFinding {
  const reasoning: string[] = [];
  const sourceEvidence: string[] = [];

  // ---- registry-derived states settle themselves -------------------------
  if (gap.state === "DECLARED_ONLY") {
    return {
      gap_id: gap.gap_id, root_cause_class: "EXPECTED_BY_DESIGN",
      failed_boundary: `${gap.capability_id}#endpoint`, emitting_site: gap.registry_refs[0] ?? null, call_site: null,
      observed_state: gap.reason,
      expected_contract: "a capability whose endpoint.kind is not_yet_built has no callable surface by declaration",
      repair_required: false, repair_type: "MISSING_IMPLEMENTATION",
      reasoning: ["the registry itself declares no endpoint; this is a stated absence, not a failure"],
      source_evidence: gap.registry_refs,
    };
  }

  if (gap.state === "MISSING_CONNECTION") {
    return {
      gap_id: gap.gap_id, root_cause_class: "MISSING_CONNECTION",
      failed_boundary: `${gap.capability_id}#contract`, emitting_site: gap.source_path, call_site: null,
      observed_state: gap.reason,
      expected_contract: `the file named by the registry entry must exist and export a callable surface`,
      repair_required: true, repair_type: "MISSING_CONNECTION",
      reasoning: ["the registry names a contract path and the file is absent from this checkout"],
      source_evidence: gap.registry_refs,
    };
  }

  if (gap.state === "CONNECTED_UNVERIFIED") {
    return {
      gap_id: gap.gap_id, root_cause_class: "MISSING_EVIDENCE",
      failed_boundary: `${gap.capability_id}#verification`, emitting_site: null, call_site: null,
      observed_state: gap.reason,
      expected_contract: "a CONNECTED capability should have at least one verification record naming its capability_id",
      // Not a code defect: the capability may be perfectly healthy. What is
      // missing is proof, and manufacturing proof would be the worst possible
      // repair.
      repair_required: false, repair_type: "EVIDENCE_MISSING",
      reasoning: ["no verification record links to this capability_id; absence of proof is not proof of a defect"],
      source_evidence: gap.registry_refs,
    };
  }

  // ---- an observed BLOCKED reason: read the code that emitted it ---------
  const reason = gap.gap_id.replace(/^gap-evidence-/, "");
  const sites = findEmittingSites(`"${reason}"`, GATEWAY_SOURCES);
  for (const site of sites) sourceEvidence.push(`${site.file}:${site.line}`);
  reasoning.push(sites.length
    ? `reason "${reason}" is emitted at ${sites.map((s) => `${s.file}:${s.line}`).join(", ")}`
    : `reason "${reason}" was not found in any of the known emitting sources`);

  if (sites.length === 0) {
    return {
      gap_id: gap.gap_id, root_cause_class: "UNDETERMINED",
      failed_boundary: gap.capability_id, emitting_site: null, call_site: null,
      observed_state: gap.reason,
      expected_contract: "unknown — the emitting site could not be located in the known sources",
      repair_required: false, repair_type: null,
      reasoning: [...reasoning, "not dispatched: an undetermined cause must not be handed to a repair agent"],
      source_evidence: sourceEvidence,
    };
  }

  // Is the state reached because a CALLER deliberately supplied nothing to
  // execute with? That is a by-design terminal path, not a defect. The check
  // is concrete: find a submitTask call passing an empty adapter array, in a
  // file whose own comment says the terminal state is intended.
  const callerFiles = GATEWAY_SOURCES.filter((f) => f !== "control/agent-gateway/gateway.ts");
  let byDesignCaller: string | null = null;
  for (const file of callerFiles) {
    const content = readRepoFile(file);
    if (!content) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const isEmptyAdapterSubmit = /submitTask\(/.test(lines[i]) && /,\s*\[\]\s*\)/.test(lines[i]);
      if (!isEmptyAdapterSubmit) continue;
      const context = lines.slice(Math.max(0, i - 25), i + 3).join("\n");
      const documented = context.includes(reason) && /by design|is its own executor|not touch/i.test(context);
      reasoning.push(`${file}:${i + 1} calls submitTask with an empty adapter array; caller comment documents the terminal state: ${documented}`);
      sourceEvidence.push(`${file}:${i + 1}`);
      if (documented) byDesignCaller = `${file}:${i + 1}`;
    }
  }

  if (byDesignCaller) {
    return {
      gap_id: gap.gap_id,
      // The block itself is intended. What is NOT intended is that it is
      // recorded as an unlabelled verification failure, indistinguishable
      // from a real one — 280 of them now sit at the top of the gap queue.
      root_cause_class: "MISLEADING_EVIDENCE",
      failed_boundary: sites[0] ? `${sites[0].file}:${sites[0].line}` : gap.capability_id,
      emitting_site: sites[0] ? `${sites[0].file}:${sites[0].line}` : null,
      call_site: byDesignCaller,
      observed_state: `${gap.occurrences} verification-failure records for a path the caller terminates deliberately`,
      expected_contract:
        "a deliberately-terminated path must be recorded as such, so the gap queue and the Workspace can tell an intended stop from a real failure",
      repair_required: true,
      repair_type: "EVIDENCE_MISSING",
      reasoning: [...reasoning,
        "the BLOCKED state is correct and needs no code change",
        "the DEFECT is that the by-design termination is recorded with no classification, so every consumer reads it as a failure"],
      source_evidence: sourceEvidence,
    };
  }

  return {
    gap_id: gap.gap_id, root_cause_class: "UNDETERMINED",
    failed_boundary: sites[0] ? `${sites[0].file}:${sites[0].line}` : gap.capability_id,
    emitting_site: sites[0] ? `${sites[0].file}:${sites[0].line}` : null, call_site: null,
    observed_state: gap.reason,
    expected_contract: "unknown — no caller was found that explains this terminal state as intended",
    repair_required: false, repair_type: gap.repair_type,
    reasoning: [...reasoning, "not dispatched: the cause is real but not yet determined, and a guess would be worse than a pause"],
    source_evidence: sourceEvidence,
  };
}
