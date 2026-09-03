/**
 * หน้าที่: write SUPERSEDING classification evidence for historical
 * `AI_WRITE_ADAPTER_NOT_REGISTERED` records, so a deliberately-terminated
 * path stops reading as a failure — without touching one byte of history.
 *
 * APPEND-ONLY, ALWAYS. Not a single existing row is edited or deleted. Each
 * historical record keeps saying exactly what it said; a NEW row is appended
 * against the same `task_id` saying what that record MEANT. Rewriting an
 * evidence store to make a graph look better is the one thing an evidence
 * store must never permit, and a supersede that edits is not a supersede.
 *
 * CLASSIFIED ONLY WHERE IT IS PROVABLE. The rule is checked per row against
 * the real task:
 *   SELF_EXECUTED          the intent names the external-system-lifecycle
 *                          orchestrator, which runs its own stages and needs
 *                          the task only for identity — the empty adapter
 *                          array is deliberate and documented at the call site
 *   INTENTIONAL_NO_ADAPTER the caller is a test or probe harness, which
 *                          constructs its adapter list explicitly, so an empty
 *                          one there is a choice rather than an accident
 *   (unclassified)         anything else. Left exactly as it is, and counted,
 *                          because a guess here would be indistinguishable
 *                          from the mislabelling this repair exists to fix.
 *
 * Input: none. Output: a summary; rows are appended through the existing
 * `saveEvidence`.
 * Dependency ที่อนุญาต: ../agent-gateway/contract.ts.
 * สิ่งที่ห้ามแตะ: never classify a row whose task cannot be read — an
 * orphaned record is unproven, not by-design. Never re-run blindly: a row
 * already carrying a classification is skipped.
 *
 * Usage: npx tsx control/repair-loop/supersede-classification.ts [--apply]
 */

import { loadAllEvidence, loadAllTasks, saveEvidence } from "../agent-gateway/contract";

const TARGET_REASON = "AI_WRITE_ADAPTER_NOT_REGISTERED";
const APPLY = process.argv.includes("--apply");

type TaskRow = { task_id: string; intent_text: string; submitted_by_client: string; work_order?: unknown };
type EvidenceRow = { evidence_id: string; task_id: string; kind: string; source: string; recorded_at: string; payload: Record<string, unknown> | null };

function classify(task: TaskRow | undefined): { classification: string; detail: string } | null {
  if (!task) return null;
  if (task.work_order) return null; // a work_order path is a different, real dispatch — not this case
  const intent = (task.intent_text ?? "").toLowerCase();
  if (intent.includes("external system lifecycle")) {
    return {
      classification: "SELF_EXECUTED",
      detail: "control/external-system-lifecycle/ calls submitTask with an empty adapter array on purpose: it executes the lifecycle stages itself and needs the task only as identity for Policy and Admission. The gateway's record is truthful; it was simply never paired with the reason.",
    };
  }
  // INTENTIONAL_NO_ADAPTER is claimed ONLY for callers that are demonstrably
  // harnesses. The first version of this rule accepted any client that was
  // not an agent, which classified 67 rows on no evidence at all — "not an
  // agent" says nothing about intent, and a caller that passed the WRONG
  // adapter list is a real defect that must not be relabelled as deliberate.
  // A test or probe harness constructs its adapter list explicitly, so an
  // empty one there is a choice; anywhere else it is unproven.
  const client = task.submitted_by_client ?? "";
  if (/(^|\/|-)tests?(\/|-|$)|test-client|probe/i.test(client)) {
    return {
      classification: "INTENTIONAL_NO_ADAPTER",
      detail: `${client} is a test/probe harness that constructs its own adapter list; the empty list is deliberate, and the gateway correctly reported that it had nothing to execute with`,
    };
  }
  return null;
}

const tasks = new Map<string, TaskRow>();
for (const task of loadAllTasks() as unknown as TaskRow[]) tasks.set(task.task_id, task);

const evidence = loadAllEvidence() as unknown as EvidenceRow[];
const alreadyClassified = new Set(
  evidence.filter((e) => e.payload && typeof e.payload.classification === "string").map((e) => e.task_id));

const candidates = evidence.filter((e) =>
  e.kind === "verification"
  && e.payload?.reason === TARGET_REASON
  && !e.payload?.classification
  && !alreadyClassified.has(e.task_id));

const buckets = new Map<string, EvidenceRow[]>();
const unprovable: EvidenceRow[] = [];
for (const row of candidates) {
  const verdict = classify(tasks.get(row.task_id));
  if (!verdict) { unprovable.push(row); continue; }
  if (!buckets.has(verdict.classification)) buckets.set(verdict.classification, []);
  buckets.get(verdict.classification)!.push(row);
}

console.log("=".repeat(96));
console.log(`SUPERSEDING CLASSIFICATION — ${APPLY ? "APPLY" : "DRY RUN (pass --apply to write)"}`);
console.log("=".repeat(96));
console.log(`  historical rows with reason=${TARGET_REASON} and no classification : ${candidates.length}`);
for (const [classification, rows] of buckets) console.log(`    ${classification.padEnd(24)} ${rows.length}`);
console.log(`    ${"(left unclassified)".padEnd(24)} ${unprovable.length}`);

if (APPLY) {
  let written = 0;
  const seenTasks = new Set<string>();
  for (const [classification, rows] of buckets) {
    for (const row of rows) {
      // One superseding row per TASK, not per evidence row: the classification
      // is a fact about the task's termination, and repeating it per record
      // would inflate the store without adding information.
      if (seenTasks.has(row.task_id)) continue;
      seenTasks.add(row.task_id);
      const verdict = classify(tasks.get(row.task_id))!;
      saveEvidence({
        evidence_id: `supersede-${row.task_id}`,
        task_id: row.task_id,
        kind: "verification",
        source: "control/repair-loop/supersede-classification.ts",
        recorded_at: new Date().toISOString(),
        payload: {
          reason: TARGET_REASON,
          classification,
          supersedes_evidence_id: row.evidence_id,
          detail: verdict.detail,
          note: "SUPERSEDING CLASSIFICATION. The record named in supersedes_evidence_id is unchanged and remains valid — it states what the gateway did. This row states what that meant.",
        },
      } as never);
      written += 1;
    }
  }
  console.log(`\n  superseding rows appended : ${written} (one per task)`);
  console.log("  historical rows edited     : 0");
  console.log("  historical rows deleted    : 0");
} else {
  console.log("\n  nothing written — dry run");
}

if (unprovable.length > 0) {
  const clients = new Map<string, number>();
  for (const row of unprovable) {
    const client = tasks.get(row.task_id)?.submitted_by_client ?? "(task row not found)";
    clients.set(client, (clients.get(client) ?? 0) + 1);
  }
  console.log("\n  LEFT UNCLASSIFIED (no provable rule applies):");
  for (const [client, count] of clients) console.log(`    ${String(count).padStart(4)}  ${client}`);
}
