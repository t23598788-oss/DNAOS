/**
 * หน้าที่: replay historical BLOCKED records through the CURRENT resolver and
 * gateway matching, and classify each one against what the system does today.
 *
 * WHY REPLAY RATHER THAN RE-RUN. Re-submitting these tasks would create new
 * work, new side effects and new evidence for questions that are purely about
 * classification. What is needed is the answer to "would today's system still
 * block this?", and that is exactly what `resolveCapability` answers — it is
 * the whole of the current matching decision, it is pure, and it reads the
 * same registries the gateway reads. Nothing is dispatched, nothing executes.
 *
 * HISTORY IS NEVER EDITED. Every original row keeps saying what it said. A new
 * row is appended per task, naming the record it supersedes and carrying the
 * replay verdict. An evidence store that can be rewritten to improve a graph
 * is not evidence.
 *
 * CLASSIFICATION IS FROM THE REPLAY, NOT FROM THE AGE OF THE ROW:
 *   HISTORICAL_STALE       today's resolver finds an owner it could not find then
 *   NOT_DISPATCH_REQUIRED  an owner resolves, and the gateway correctly declines
 *                          to execute on that capability's behalf
 *   STILL_BLOCKED_VALID    nothing resolves, and the reason is one the system
 *                          is right to refuse on
 *   REAL_DEFECT            nothing resolves AND the record shows the system
 *                          should have been able to — the only class allowed
 *                          into the repair loop
 *   EVIDENCE_LINK_MISSING  the task row is gone, so nothing can be replayed
 *
 * Input: none. Output: a summary; superseding rows appended with --apply.
 * Dependency ที่อนุญาต: ../agent-gateway/contract.ts,
 * ../agent-gateway/capability-resolver.ts, node:fs.
 * สิ่งที่ห้ามแตะ: never mark REAL_DEFECT without naming the boundary and the
 * reason today's system gives — REAL_DEFECT is the only class that spends
 * agent time, and an unproven one wastes it on something that works.
 *
 * Usage: npx tsx control/repair-loop/replay-history.ts [--apply]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAllEvidence, loadAllTasks, saveEvidence } from "../agent-gateway/contract";
import { resolveCapability } from "../agent-gateway/capability-resolver";
import type { GatewayCapabilityEntry } from "../agent-gateway/capability-resolver";

const APPLY = process.argv.includes("--apply");
const REPO = process.cwd();
const INDEX: GatewayCapabilityEntry[] = JSON.parse(
  readFileSync(join(REPO, "reports/phase16-world-evidence/capability_index.json"), "utf-8"));

const TARGET_REASONS = ["NO_EXISTING_CAPABILITY matched", "CAPABILITY_RESOLVED_NOT_GATEWAY_EXECUTABLE"];

type TaskRow = {
  task_id: string; intent_text: string; submitted_by_client: string;
  work_order?: unknown; route_context?: Record<string, unknown>;
};
type EvidenceRow = { evidence_id: string; task_id: string; kind: string; source: string; recorded_at: string; payload: Record<string, unknown> | null };

type Verdict =
  | "HISTORICAL_STALE" | "STILL_BLOCKED_VALID" | "REAL_DEFECT"
  | "EXPECTED_POLICY_BLOCK" | "NOT_DISPATCH_REQUIRED" | "EVIDENCE_LINK_MISSING";

interface ReplayResult {
  readonly task_id: string;
  readonly original_reason: string;
  readonly original_evidence_id: string;
  readonly verdict: Verdict;
  readonly MATCH_METHOD: string;
  readonly MATCHED_CAPABILITY_ID: string | null;
  readonly REGISTRY_REF: string | null;
  readonly NEXT_BOUNDARY: string | null;
  readonly current_verdict: string;
}

const tasks = new Map<string, TaskRow>();
for (const task of loadAllTasks() as unknown as TaskRow[]) tasks.set(task.task_id, task);

const evidence = loadAllEvidence() as unknown as EvidenceRow[];
// A task is skipped only when its replay row is COMPLETE — a verdict AND,
// where the verdict is a determined one, the classification the gap scanner
// reads. The first apply wrote 204 STILL_BLOCKED_VALID rows with no
// classification, which left every one of them in the active queue; skipping
// them on that basis would have made the omission permanent. A corrected row
// is appended instead, and nothing is edited.
const alreadyReplayed = new Set(
  evidence
    .filter((e) => {
      const p = e.payload as { replay_verdict?: string; classification?: string } | null;
      if (!p || typeof p.replay_verdict !== "string") return false;
      // REAL_DEFECT is deliberately left open, so it counts as complete.
      return p.replay_verdict === "REAL_DEFECT" || p.replay_verdict === "EVIDENCE_LINK_MISSING"
        || typeof p.classification === "string";
    })
    .map((e) => e.task_id));

// One record per TASK: the same reason is logged once per task, and replaying
// the same task twice would say the same thing twice.
const seen = new Set<string>();
const candidates: EvidenceRow[] = [];
for (const row of evidence) {
  if (row.kind !== "verification") continue;
  const reason = row.payload?.reason;
  if (typeof reason !== "string" || !TARGET_REASONS.includes(reason)) continue;
  if (alreadyReplayed.has(row.task_id) || seen.has(row.task_id)) continue;
  seen.add(row.task_id);
  candidates.push(row);
}

function replay(row: EvidenceRow): ReplayResult {
  const task = tasks.get(row.task_id);
  const originalReason = String(row.payload?.reason);

  if (!task) {
    return {
      task_id: row.task_id, original_reason: originalReason, original_evidence_id: row.evidence_id,
      verdict: "EVIDENCE_LINK_MISSING", MATCH_METHOD: "NOT_REPLAYABLE",
      MATCHED_CAPABILITY_ID: null, REGISTRY_REF: null, NEXT_BOUNDARY: null,
      current_verdict: "the task row this evidence points at no longer exists, so the original context cannot be restored",
    };
  }

  // Restore whatever context the record actually carries. A historical row
  // written before route_context existed simply has none, and is replayed on
  // its intent alone — which is exactly the situation it was decided in.
  const context = task.route_context ?? {};
  const match = resolveCapability(
    {
      intent_text: task.intent_text ?? "",
      route_group: (context.route_group ?? null) as never,
      target_capability_id: (context.target_capability_id as string) ?? null,
      target_capability_name: (context.target_capability_name as string) ?? null,
      event_type: (context.event_type as string) ?? null,
      error_code: (context.error_code as string) ?? null,
      work_id: (context.work_id as string) ?? null,
      trace_id: (context.trace_id as string) ?? null,
      evidence_ref: row.evidence_id,
    },
    INDEX,
  );

  const base = {
    task_id: row.task_id, original_reason: originalReason, original_evidence_id: row.evidence_id,
    MATCH_METHOD: match.MATCH_METHOD, MATCHED_CAPABILITY_ID: match.MATCHED_CAPABILITY_ID,
    REGISTRY_REF: match.REGISTRY_REF,
  };

  if (match.MATCH_METHOD === "NO_EXISTING_CAPABILITY") {
    // Still unresolvable. Whether that is a defect depends on whether the
    // record gave the system anything to resolve WITH. A task carrying no
    // route context and an intent no registry describes is not a defect — the
    // system is right to refuse it. A task that DID name a capability and
    // still fails is a real defect.
    const named = Boolean(context.target_capability_id || context.target_capability_name || context.route_group);
    return {
      ...base,
      verdict: named ? "REAL_DEFECT" : "STILL_BLOCKED_VALID",
      NEXT_BOUNDARY: null,
      current_verdict: named
        ? `the record names ${String(context.target_capability_id ?? context.target_capability_name ?? context.route_group)} and today's resolver still finds nothing for it — a genuine gap`
        : `no capability id, canonical name or route group was ever supplied, and the intent matches no registry entry; refusing is correct`,
    };
  }

  if (match.entry === null) {
    // An owner resolves, but the resolving registry carries no execution
    // method. The gateway naming the owner and declining to act for it is the
    // intended behaviour, not a failure.
    return {
      ...base, verdict: "NOT_DISPATCH_REQUIRED", NEXT_BOUNDARY: match.MATCHED_CAPABILITY_ID,
      current_verdict: `${match.MATCH_METHOD} resolved ${match.MATCHED_CAPABILITY_ID}; the resolving registry carries no execution_method, so dispatch belongs to that capability's own boundary`,
    };
  }

  return {
    ...base, verdict: "HISTORICAL_STALE", NEXT_BOUNDARY: match.MATCHED_CAPABILITY_ID,
    current_verdict: `today's resolver matches ${match.MATCHED_CAPABILITY_ID} via ${match.MATCH_METHOD}; the original block reflects a matcher that no longer exists`,
  };
}

const results = candidates.map(replay);

const counts = new Map<Verdict, number>();
for (const r of results) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);

console.log("=".repeat(100));
console.log(`HISTORICAL REPLAY — ${APPLY ? "APPLY" : "DRY RUN (pass --apply to append superseding evidence)"}`);
console.log("=".repeat(100));
console.log(`  distinct tasks replayed : ${results.length}`);
for (const [verdict, count] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${verdict.padEnd(24)} ${count}`);
}

const byReason = new Map<string, Map<Verdict, number>>();
for (const r of results) {
  if (!byReason.has(r.original_reason)) byReason.set(r.original_reason, new Map());
  const inner = byReason.get(r.original_reason)!;
  inner.set(r.verdict, (inner.get(r.verdict) ?? 0) + 1);
}
console.log("\n  BY ORIGINAL REASON:");
for (const [reason, inner] of byReason) {
  console.log(`    ${reason}`);
  for (const [verdict, count] of inner) console.log(`      ${verdict.padEnd(24)} ${count}`);
}

const defects = results.filter((r) => r.verdict === "REAL_DEFECT");
if (defects.length > 0) {
  console.log("\n  REAL_DEFECT (the only class allowed into the repair loop):");
  for (const d of defects.slice(0, 10)) console.log(`    ${d.task_id}  ${d.current_verdict}`);
}

const sample = results.filter((r) => r.verdict === "HISTORICAL_STALE")[0];
if (sample) {
  console.log("\n  SAMPLE HISTORICAL_STALE:");
  console.log(`    task         : ${sample.task_id}`);
  console.log(`    was          : ${sample.original_reason}`);
  console.log(`    MATCH_METHOD : ${sample.MATCH_METHOD}`);
  console.log(`    MATCHED      : ${sample.MATCHED_CAPABILITY_ID}`);
  console.log(`    REGISTRY_REF : ${sample.REGISTRY_REF}`);
}

if (APPLY) {
  let written = 0;
  for (const r of results) {
    saveEvidence({
      // A corrected replay row must not collide with the first one. The id
      // carries the verdict so an amended classification is a NEW row, and
      // both remain readable in order.
      evidence_id: `replay-${r.task_id}-${r.verdict.toLowerCase()}`,
      task_id: r.task_id,
      kind: "verification",
      source: "control/repair-loop/replay-history.ts",
      recorded_at: new Date().toISOString(),
      payload: {
        reason: r.original_reason,
        replay_verdict: r.verdict,
        // The same field name the gap scanner already reads, so a replayed
        // record that is not a defect leaves the active queue immediately.
        // Every determined verdict carries a classification. Leaving
        // STILL_BLOCKED_VALID unclassified kept 204 correctly-refused test
        // intents sitting in the active repair queue as if they were
        // unresolved work — a determination that nothing can read is the same
        // as no determination. Only REAL_DEFECT stays open, because only it
        // is actionable.
        classification:
          r.verdict === "HISTORICAL_STALE" || r.verdict === "NOT_DISPATCH_REQUIRED" ? "NOT_DISPATCH_REQUIRED"
          : r.verdict === "STILL_BLOCKED_VALID" ? "EXPECTED_POLICY_BLOCK"
          : undefined,
        supersedes_evidence_id: r.original_evidence_id,
        MATCH_METHOD: r.MATCH_METHOD,
        MATCHED_CAPABILITY_ID: r.MATCHED_CAPABILITY_ID,
        REGISTRY_REF: r.REGISTRY_REF,
        NEXT_BOUNDARY: r.NEXT_BOUNDARY,
        current_verdict: r.current_verdict,
        note: "REPLAY THROUGH CURRENT BEHAVIOUR. The record named in supersedes_evidence_id is unchanged and remains true about what happened then; this row states what the same input does now.",
      },
    } as never);
    written += 1;
  }
  console.log(`\n  superseding rows appended : ${written}`);
  console.log("  historical rows edited     : 0");
  console.log("  historical rows deleted    : 0");
} else {
  console.log("\n  nothing written — dry run");
}
