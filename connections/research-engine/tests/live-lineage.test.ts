/**
 * Live proof for Owner-requested canonical lineage closure.
 *
 * This test intentionally uses the real local services and real stores:
 * - #internal owner-command HTTP on 8791
 * - Research Monitor API on 8787
 * - cross-system JSONL store
 * - agent-gateway evidence JSONL
 *
 * It does not mock, does not create a database, and does not hardcode the
 * canonical application/capability/execution identifiers. The bridge derives
 * them from the stores and Research API response.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchResearchEngineLatestResult } from "../research-engine-adapter";
import { registerResearchEngineLineage, readResearchEngineLineage } from "../lineage-bridge";
import { resolveRouteFromDisk } from "../../../control/capability-route/host-runtime";
import type { ExtendedRelationshipKind } from "../../../software/registry-database/cross-system-types";

declare const process: { cwd(): string; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function evidenceFileContains(evidenceId: string): boolean {
  const file = join(process.cwd(), "control/agent-gateway/data/evidence.jsonl");
  return existsSync(file) && readFileSync(file, "utf8").includes(`"evidence_id":"${evidenceId}"`);
}

async function main(): Promise<void> {
  const route = resolveRouteFromDisk("research-engine");
  check("/capability/route/research-engine resolves", route.outcome === "ROUTE_RESOLVED", route.reason ?? route.outcome);
  check("route is not ambiguous", route.outcome !== "RUNTIME_BINDING_AMBIGUOUS");
  check("route points at the real Research API", route.route?.address === "http://127.0.0.1:8787", route.route?.address ?? "no route");

  const adapter = await fetchResearchEngineLatestResult();
  const notes = adapter.evidenceEntries.map((e) => e.note).join("\n");
  check("adapter completed against real Research Monitor", adapter.status === "COMPLETED", adapter.summary);
  check("adapter preserves research execution id", /research_execution_id=exec-/.test(notes), notes);
  check("adapter preserves work id", /work_id=work-/.test(notes), notes);
  check("adapter preserves cost block", /cost=/.test(notes) && /cost_source/.test(notes), notes);
  check("adapter preserves process evidence", /process=/.test(notes) && /process_id/.test(notes), notes);
  check("adapter preserves metric signal", /latency=/.test(notes) && /cold_start_latency_ms/.test(notes), notes);
  check("adapter preserves decision truthfully", /research_decision=/.test(notes), notes);

  const report = await registerResearchEngineLineage();
  const lineage = readResearchEngineLineage(report.evidence_id);
  const kinds = new Set(lineage.relationships.map((r) => r.relationship_kind));
  const requiredKinds: readonly ExtendedRelationshipKind[] = [
    "APPLICATION_USES_CAPABILITY",
    "WORK_TARGETS_CAPABILITY",
    "EXECUTION_OF_WORK",
    "EXECUTION_RUNS_PROCESS",
    "EXECUTION_HAS_RESEARCH_RUN",
    "RESEARCH_RUN_HAS_METRIC",
    "RESEARCH_RUN_HAS_COST",
    "RESEARCH_RUN_HAS_DECISION",
    "METRIC_HAS_EVIDENCE",
    "COST_HAS_EVIDENCE",
    "DECISION_HAS_EVIDENCE",
    "PROCESS_HAS_EVIDENCE",
  ];
  for (const required of requiredKinds) {
    check(`lineage has ${required}`, kinds.has(required), [...kinds].join(","));
  }
  check("canonical entities were registered", lineage.entities.length >= 8, String(lineage.entities.length));
  check("evidence row exists in agent-gateway store", evidenceFileContains(report.evidence_id), report.evidence_id);
  check("PID is not used as process entity identity", !new RegExp("^process://research-engine/[0-9]+$").test(report.process_entity_id), report.process_entity_id);

  const bridgeSource = readFileSync(join(process.cwd(), "connections/research-engine/lineage-bridge.ts"), "utf8");
  check("bridge source does not hardcode UUID-like capability ids", !/capability-[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(bridgeSource));
  check("bridge source does not hardcode research execution ids", !/exec-[0-9a-f]{12}/i.test(bridgeSource));
  check("bridge source does not hardcode work ids", !/work-[0-9a-f]{12}/i.test(bridgeSource));

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
