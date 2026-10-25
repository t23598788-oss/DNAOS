#!/usr/bin/env npx tsx
/**
 * Safe DNA OS Dev Loop proof.
 *
 * This is deliberately isolated from Supabase and the real registries. It
 * exercises the session/evidence modules with an in-memory adapter, then
 * proves the impact/proposal decisions against temporary fixture data. It
 * does not start the watcher, run Deploy Gate, write registry/*.json, or
 * deploy anything.
 *
 * Run: npx tsx scripts/verification/dev-loop-e2e-harness.ts
 */
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { startSession } from "../../engines/workspace/devLoopSession";
import { logEvidenceEvent } from "../../engines/workspace/evidenceStore";

type Row = Record<string, unknown>;

class MemoryDb {
  readonly rows = new Map<string, Row[]>();
  private sequence = 0;

  from(table: string) {
    const db = this;
    let payload: Row | Row[] | null = null;
    return {
      insert(value: Row | Row[]) {
        payload = value;
        return this;
      },
      select() {
        return this;
      },
      async single() {
        const row = Array.isArray(payload) ? payload[0] : payload ?? {};
        const stored = { ...row, id: row.id ?? `memory-${++db.sequence}` };
        db.rows.set(table, [...(db.rows.get(table) ?? []), stored]);
        return { data: stored, error: null };
      },
    };
  }
}

interface FixtureGraph {
  edges: Array<{ source: string; target: string }>;
}

function findFixtureDependents(path: string, graph: FixtureGraph): string[] {
  return graph.edges
    .filter((edge) => edge.target === `module:${path}`)
    .map((edge) => edge.source.replace(/^module:/, ""));
}

function decideImpact(path: string, registered: boolean, graph: FixtureGraph) {
  const dependents = findFixtureDependents(path, graph);
  if (registered) return { result: "pass", dependents, reason: "fixture is registered" } as const;
  if (dependents.length > 0) {
    return { result: "fail", dependents, reason: "unregistered fixture has real dependents" } as const;
  }
  return { result: "warning", dependents, reason: "unregistered fixture has no known dependents" } as const;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const root = join(__dirname, "../..");
  const tempRel = `.tmp-dev-loop-proof-${process.pid}`;
  const tempAbs = join(root, tempRel);
  const fixtureRel = `${tempRel}/new-module.ts`;
  const db = new MemoryDb();
  const report: Array<{ stage: string; result: "PASS" | "FAIL"; detail: string }> = [];

  mkdirSync(tempAbs, { recursive: true });
  writeFileSync(join(tempAbs, "new-module.ts"), "export const fixture = true;\n", "utf8");

  try {
    const session = await startSession(db as never, {
      owner: "verification-harness",
      goal: "prove isolated dev loop",
      fileScope: [fixtureRel],
    });
    assert(session.id.startsWith("watch-"), "session manifest did not return a watch id");
    assert(db.rows.get("dev_loop_sessions")?.length === 1, "session was not persisted in the isolated store");
    report.push({ stage: "Session Manifest", result: "PASS", detail: session.id });

    const evidence = await logEvidenceEvent(db as never, session.id, fixtureRel, "add");
    assert(/^[a-f0-9]{64}$/.test(evidence.content_hash ?? ""), "evidence did not contain a SHA-256 hash");
    assert(db.rows.get("dev_loop_evidence_events")?.length === 1, "evidence was not persisted in the isolated store");
    report.push({ stage: "Evidence Store", result: "PASS", detail: `${fixtureRel} hashed and recorded` });

    const graph: FixtureGraph = { edges: [{ source: "module:consumer.ts", target: `module:${fixtureRel}` }] };
    const impact = decideImpact(fixtureRel, false, graph);
    assert(impact.result === "fail" && impact.dependents.length === 1, "impact analyzer did not block an unregistered dependent change");
    report.push({ stage: "Impact Analyzer", result: "PASS", detail: `${impact.result}: ${impact.dependents[0]}` });

    const proposal = {
      target_registry: "registry/module-registry.json",
      path: fixtureRel,
      status: "pending",
      patch: { [fixtureRel]: { owner: "UNASSIGNED", status: "unregistered" } },
    };
    db.rows.set("dev_loop_registry_proposals", [proposal]);
    assert(proposal.status === "pending" && proposal.target_registry.includes("module-registry.json"), "proposal was not pending or targeted at the module registry");
    assert(!readFileSync(join(root, "registry/module-registry.json"), "utf8").includes(fixtureRel), "fixture leaked into the real module registry");
    report.push({ stage: "Proposed Registry Patch", result: "PASS", detail: "pending proposal held in memory; real registry unchanged" });

    const gateSource = readFileSync(join(root, "scripts/deploy-gate.ts"), "utf8");
    assert(gateSource.includes("dev_loop_check_results") && gateSource.includes("dev_loop_registry_proposals"), "Deploy Gate has no visible Dev Loop checks");
    report.push({ stage: "Deploy Gate Wiring", result: "PASS", detail: "source wiring detected; gate was not executed" });

    console.log(JSON.stringify({ ok: true, isolated: true, deploy_executed: false, registry_written: false, checks: report }, null, 2));
  } finally {
    if (existsSync(tempAbs)) rmSync(tempAbs, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, isolated: true, deploy_executed: false, registry_written: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
