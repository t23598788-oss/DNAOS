import { bindRunObservations, analyzeRun } from "../contract";
import type { RunSources } from "../contract";
import { loadAdmittedConsoleItems, collapseSymptoms, loadPreparedRepairs } from "../../owner-error-lane/contract";
import { loadAllTasks, loadAllEvidence, loadAllHandoffs } from "../../agent-gateway/contract";

const items = loadAdmittedConsoleItems();
const prepared = loadPreparedRepairs();
const collapse = collapseSymptoms(prepared);
const roots = collapse.root_incidents;
const byWork = new Map(items.map((i) => [i.work_id, i]));
console.log(`ADMITTED=${items.length} PREPARED=${prepared.length} ROOT_INCIDENTS=${roots.length} INDEPENDENT=${collapse.independent.length} PROVEN=${collapse.proven_root_cause_count} SUPPRESSED=${collapse.downstream_repair_suppressed_count}`);

const tasks = loadAllTasks(), ev = loadAllEvidence(), ho = loadAllHandoffs();
const evBy = new Map<string, any[]>(); for (const e of ev) { const a = evBy.get(e.task_id) ?? []; a.push(e); evBy.set(e.task_id, a); }
const hoBy = new Map<string, any[]>(); for (const h of ho) { const a = hoBy.get(h.task_id) ?? []; a.push(h); hoBy.set(h.task_id, a); }
const src = (id: string): RunSources => ({ evidence: evBy.get(id) ?? [], handoffs: hoBy.get(id) ?? [], task: tasks.find((t) => t.task_id === id) ?? null });

let symptomTotal = 0, resolved = 0, scoped = 0, unknownAll = 0, obsTotal = 0, provenCount = 0, suppressed = 0;
const lines: string[] = [];
for (const r of roots.slice(0, 40)) {
  const wids: string[] = [...((r as any).symptom_work_ids ?? [])];
  const tid = wids.map((w) => byWork.get(w)?.task_id).find((x) => typeof x === "string") ?? null;
  if (tid === null) continue;
  const obs = bindRunObservations(tid, src(tid));
  const a = analyzeRun(`run:${tid}`, obs);
  resolved += 1;
  obsTotal += a.observed_steps.length;
  if (a.unknown_semantics.length === a.observed_steps.length) unknownAll += 1;
  if (a.implementation_scope.length > 0) scoped += 1;
  if (a.proven_root_cause !== null) provenCount += 1;
  suppressed += ((r as any).suppressed_downstream ?? []).length;
  symptomTotal += wids.length;
  lines.push([
    `ROOT ${(r as any).root_id ?? (r as any).gap_id ?? tid}`,
    `  observed=${a.observed_steps.length}/10 unobserved=${a.unobserved_steps.join(",") || "-"}`,
    `  LAST_PROVEN_TRUTH=${a.last_proven_truth ?? "NONE"}`,
    `  FIRST_TRUTH_DIVERGENCE=${a.first_truth_divergence ?? "NOT_DETECTABLE"}`,
    `  FIRST_BAD_BOUNDARY=${a.first_bad_boundary ?? "NONE"}`,
    `  UPSTREAM=${((r as any).common_upstream ?? []).join(",") || "-"} FIRST_DIVERGENCE_POINT=${(r as any).first_divergence_point ?? "NONE"}`,
    `  MISMATCH_CLASS=${a.boundaries.map((b) => b.mismatch_class).filter((c) => c !== "NO_MISMATCH").join(",") || "NO_MISMATCH"}`,
    `  RESPONSIBILITY=${a.responsibility} CANDIDATE=${a.root_cause_candidate ?? "-"} PROVEN=${a.proven_root_cause}`,
    `  HUMAN: expected=ได้ผลจริง+ตรวจสอบได้ actual=${a.human_outcome.actual_human_outcome} met=${a.human_outcome.human_outcome_met}`,
    `  SCOPE=${a.implementation_scope.join(",") || "NONE"} UNKNOWN_SEMANTICS=${a.unknown_semantics.length}`,
  ].join("\n"));
}
console.log(lines.slice(0, 3).join("\n"));
console.log(`\nSUMMARY roots=${roots.length} resolved_to_run=${resolved} symptoms_in_roots=${symptomTotal} avg_observed=${(obsTotal/Math.max(1,resolved)).toFixed(1)}/10 all_unknown_semantics=${unknownAll} scoped=${scoped} proven_root_causes=${provenCount} suppressed_symptoms=${suppressed}`);
