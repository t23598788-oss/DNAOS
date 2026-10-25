#!/usr/bin/env npx tsx
/** Safe local proof for the Dev Loop problem-report trigger. */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildDevLoopProblemReport,
  persistDevLoopProblemReport,
  resolvePersistedDevLoopProblem,
} from "../../engines/workspace/problemReport";

class FakeDb {
  readonly writes: Array<Record<string, unknown>> = [];
  from() {
    return {
      upsert: async (row: Record<string, unknown>) => {
        this.writes.push(row);
        return { error: null };
      },
    };
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const artifactPath = join("/private/tmp", `dna-os-problem-report-${process.pid}.json`);
  const db = new FakeDb();
  try {
    const forcedFailure = buildDevLoopProblemReport({
      source: "problem-report-trigger.test.ts",
      severity: "critical",
      checkName: "forced failure",
      cause: "forced test failure",
      evidenceRefs: ["test:evidence-1"],
      affectedFiles: ["fixture.ts"],
      recommendedOwnerAction: "review the evidence",
      now: "2026-08-05T00:00:00.000Z",
    });
    const first = await persistDevLoopProblemReport(forcedFailure, { db, artifactPath });
    assert(first.written && !first.deduplicated, "forced failure did not create a report");
    assert(first.report.owner_alert.spoken_summary.includes("forced failure"), "owner alert payload is not spoken-friendly");
    assert(db.writes.length === 1 && (db.writes[0].status as string) === "degraded", "health alert was not emitted");

    const duplicate = await persistDevLoopProblemReport({ ...forcedFailure, occurred_at: "2026-08-05T00:01:00.000Z" }, { db, artifactPath });
    assert(duplicate.deduplicated && !duplicate.written, "identical failure was not deduplicated");
    assert(db.writes.length === 1, "deduplicated failure emitted a second health alert");

    const resolved = await resolvePersistedDevLoopProblem({ db, artifactPath });
    assert(resolved?.status === "resolved", "passing/resolution path did not close the report");
    assert(Number(db.writes.length) === 2 && (db.writes[1].status as string) === "healthy", "resolved health state was not emitted");
    assert(JSON.parse(readFileSync(artifactPath, "utf8")).status === "resolved", "durable artifact was not resolved");

    const passing = await resolvePersistedDevLoopProblem({ db, artifactPath });
    assert(passing?.status === "resolved" && Number(db.writes.length) === 2, "passing run created a new report");
    console.log(JSON.stringify({ ok: true, forced_failure_reported: true, duplicate_suppressed: true, passing_run_resolved: true, deploy_executed: false, registry_written: false, ai_called: false }, null, 2));
  } finally {
    if (existsSync(artifactPath)) rmSync(artifactPath, { force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), deploy_executed: false, registry_written: false, ai_called: false }, null, 2));
  process.exitCode = 1;
});
