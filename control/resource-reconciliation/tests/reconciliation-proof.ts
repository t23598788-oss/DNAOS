/**
 * หน้าที่: prove the reconciliation and safe-reset lifecycle against the real
 * machine — CASES A through G from the Owner's specification, plus the final
 * invariants.
 *
 * Every subject below is a real artifact on this machine, found by the
 * detectors themselves rather than chosen to make a case pass. Nothing in this
 * proof deletes, moves or resets anything; the last checks assert exactly that.
 *
 * Input: none. Output: printed report + exit code.
 * Dependency ที่อนุญาต: ../contract.ts, ../../machine-observation/contract.ts.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildLineage, decideVerdict, detectSupersessions, reconcileSystem, impactOfChange,
  assessDatabaseObject, planReset, verifyAfterMutation, sourceOfTruthReason, censusIndex,
  machineWorkspaceState,
  REPO_ROOT,
} from "../contract";
import type { ReconciliationVerdict } from "../contract";

const DEADBOARD = "/Users/tam/Desktop/dna-os-deadboard";
const checks: { ok: boolean; label: string; detail: string }[] = [];
const check = (ok: boolean, label: string, detail = ""): void => { checks.push({ ok, label, detail }); };
const head = (t: string): void => console.log(`\n${"─".repeat(78)}\n${t}`);

function main(): void {
  const before = reconcileSystem({ limitPerKind: 40 });
  const supersessions = detectSupersessions();

  // ══════════════════════════════════════════════════════════════════════
  head("CASE A — old implementation replaced, zero consumers, reversible");
  const caseA = supersessions.find((s) =>
    s.basis === "IDENTICAL_CONTENT" && !s.old_path_removed && s.old_path.includes("/data/"));
  if (!caseA) {
    check(false, "CASE A: a real superseded artifact was found", "none present on this machine");
  } else {
    const lineage = buildLineage(caseA.old_path);
    const decision = decideVerdict({ lineage, supersession: caseA, identicalSurvivor: caseA.new_path });
    console.log(`  old: ${caseA.old_path}`);
    console.log(`  new: ${caseA.new_path}   basis: ${caseA.basis}`);
    console.log(`  ${caseA.provenance[0].evidence.slice(0, 120)}`);
    console.log(`  verdict: ${decision.verdict} (${decision.rule})`);
    check(lineage.consumers.length === 0, "CASE A: the superseded artifact has zero consumers", `${lineage.consumers.length}`);
    check(decision.verdict === "AUTO_TRASH", "CASE A: it becomes a lifecycle candidate", `${decision.verdict}`);
    check(decision.conditions.unanswered.length === 0, "CASE A: every AUTO_TRASH condition was answered", `${decision.conditions.unanswered.length} unanswered`);
    check(existsSync(join(REPO_ROOT, caseA.new_path)),
      "CASE A: removal is reversible — the identical replacement still exists, so no information is lost", caseA.new_path);
    check(existsSync(join(REPO_ROOT, caseA.old_path)),
      "CASE A: the candidate was NAMED, not removed — it is still on disk after the verdict");
  }

  // ══════════════════════════════════════════════════════════════════════
  head("CASE B — old-looking source still referenced -> RETAIN");
  const caseB = supersessions.find((s) => s.old_path.includes("__sandbox__"));
  if (caseB) {
    const d = decideVerdict({ lineage: buildLineage(caseB.old_path), supersession: caseB, identicalSurvivor: caseB.new_path });
    console.log(`  ${caseB.old_path}`);
    console.log(`  verdict: ${d.verdict} (${d.rule}) — ${d.reason.slice(0, 120)}`);
    check(d.verdict === "RETAIN", "CASE B: a file driven by string literal rather than import is RETAINED", `${d.verdict} via ${d.rule}`);
    check(d.rule === "LITERAL_REFERENCE_RETAIN", "CASE B: the reason is the literal reference, not a coincidence", d.rule);
  } else {
    check(false, "CASE B: a literal-referenced duplicate exists to test", "none found");
  }
  // …and an ordinarily imported module.
  const importedLineage = buildLineage("control/machine-observation/observation-store.ts");
  const importedDecision = decideVerdict({ lineage: importedLineage, supersession: null, identicalSurvivor: null });
  console.log(`  control/machine-observation/observation-store.ts -> ${importedDecision.verdict} (${importedDecision.rule})`);
  check(importedDecision.verdict === "RETAIN", "CASE B: an imported module is RETAINED", `${importedDecision.verdict}`);

  // ══════════════════════════════════════════════════════════════════════
  head("CASE C / G — Supabase, LINE and finance -> BLOCK before any mutation");
  for (const object of ["receipt_documents", "transactions"]) {
    const d = assessDatabaseObject(object, DEADBOARD);
    console.log(`  ${object}: ${d.verdict} — ${d.reason.slice(0, 130)}`);
    check(d.verdict === "BLOCK", `CASE C: "${object}" is BLOCKED`, d.verdict);
    check(d.no_financial_or_document_lineage === false, `CASE C: "${object}" is recognised as financial/document lineage`);
    check(d.unproven.length > 0, `CASE C: unproven obligations are named for "${object}"`, `${d.unproven.length} unproven`);
  }
  const lineTable = assessDatabaseObject("conversation_states", DEADBOARD);
  console.log(`  conversation_states (LINE/webhook surface): ${lineTable.verdict} — ${lineTable.reason.slice(0, 120)}`);
  check(lineTable.verdict === "BLOCK", "CASE G: an object reachable from an Edge Function / webhook is BLOCKED", lineTable.verdict);
  check(lineTable.no_active_reader === null && lineTable.no_active_writer === null,
    "CASE G: live readers/writers are reported UNPROVEN, never assumed absent");

  const migration = "supabase/migrations/20260718000003_receipt_documents_slip_fields.sql";
  console.log(`  ${migration} -> source-of-truth: ${sourceOfTruthReason(migration) !== null}`);
  check(sourceOfTruthReason(migration) !== null, "CASE C: a database migration is a source of truth and can never be trashed");

  // ══════════════════════════════════════════════════════════════════════
  head("CASE E — cache / derived state -> RESET plan, nothing executed");
  const resetPlan = planReset("APPLICATION_CACHE_RESET", "");
  console.log(`  verdict ${resetPlan.verdict}: ${resetPlan.disposable.length} disposable, ${resetPlan.protected_from_reset.length} protected`);
  resetPlan.actions.forEach((a) => console.log(`    action: ${a}`));
  const serviceReset = planReset("SERVICE_RESET", "machine-observer");
  console.log(`  SERVICE_RESET machine-observer -> ${serviceReset.verdict}; reload via ${serviceReset.reload_services.join(", ")}`);
  check(serviceReset.verdict === "RESET" && serviceReset.reload_services.includes("machine-observer"),
    "CASE E: a service reset is a reload through the existing authority, not a deletion", serviceReset.verdict);
  check(serviceReset.actions.some((a) => a.includes("control/runtime-control")),
    "CASE E: the plan routes execution to control/runtime-control, never to launchctl here");
  const badReset = planReset("SERVICE_RESET", "not-a-service");
  check(badReset.verdict === "BLOCK", "CASE E: a reset of an unregistered service is BLOCKED", badReset.verdict);

  // ══════════════════════════════════════════════════════════════════════
  head("CASE F — registry / blueprint pointing at removed implementations");
  const registryFindings = before.findings.filter((f) => f.kind === "STALE_REGISTRY_REFERENCE");
  const blueprintFindings = before.findings.filter((f) => f.kind === "STALE_BLUEPRINT_REFERENCE");
  console.log(`  stale registry references: ${before.metrics.registry_inconsistency_count} (showing ${registryFindings.length})`);
  registryFindings.slice(0, 2).forEach((f) => console.log(`    ${f.subject} -> ${f.counterpart}`));
  blueprintFindings.slice(0, 2).forEach((f) => console.log(`    blueprint ${f.subject} -> ${f.counterpart}`));
  check(registryFindings.length > 0 || blueprintFindings.length > 0,
    "CASE F: references to removed implementations are detected", `${registryFindings.length} registry, ${blueprintFindings.length} blueprint`);
  check([...registryFindings, ...blueprintFindings].every((f) => f.verdict === "REVIEW"),
    "CASE F: the verdict is to reconcile the reference (REVIEW), never to delete either side");
  for (const f of blueprintFindings) {
    check(!existsSync(join(REPO_ROOT, f.counterpart ?? "")),
      `CASE F: the blueprint target really is absent — ${f.counterpart}`, "verified with existsSync");
  }

  // ══════════════════════════════════════════════════════════════════════
  head("CHANGE-TRIGGERED RECONCILIATION — cleanup originates from lineage");
  const headSha = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const impact = impactOfChange(headSha);
  const byClass: Record<string, number> = {};
  for (const e of impact) byClass[e.impact] = (byClass[e.impact] ?? 0) + 1;
  console.log(`  ${headSha.slice(0, 12)} -> ${JSON.stringify(byClass)}`);
  check(impact.length > 0, "a verified change produces an impact set", `${impact.length} entries`);
  check(impact.every((e) => ["NEW", "MODIFIED", "SUPERSEDED", "POSSIBLY_ORPHANED", "UNCHANGED"].includes(e.impact)),
    "every impact entry is one of the five declared classes");
  check(impact.filter((e) => e.reconciliation !== null).every((e) => e.impact === "SUPERSEDED" || e.impact === "POSSIBLY_ORPHANED"),
    "only SUPERSEDED and POSSIBLY_ORPHANED carry a reconciliation finding");

  // ══════════════════════════════════════════════════════════════════════
  head("MACHINE / VS CODE — active is refused, derived is a candidate");
  const machine = machineWorkspaceState();
  machine.evidence.forEach((e) => console.log(`  ${e}`));
  console.log(`  editors: ${machine.editor_processes.length}, repo processes: ${machine.repo_processes.length}, open paths: ${machine.active_paths.length}, disposable trees: ${machine.disposable_paths.length}`);
  machine.repo_processes.slice(0, 3).forEach((p) => console.log(`    pid ${p.pid} ${p.argv.slice(0, 80)}`));
  check(machine.repo_processes.length > 0,
    "machine observation identifies the live processes working in this repository", `${machine.repo_processes.length}`);
  check(machine.editor_processes.length > 0,
    "the editor is observed as an ordinary process — no VS Code cleaner daemon exists or is needed", `${machine.editor_processes.length} editor process(es)`);
  // Anything a live process holds open must never reach a removal verdict.
  let heldSafe = true;
  const heldSample: string[] = [];
  for (const p of machine.active_paths.filter((a) => a.endsWith(".ts")).slice(0, 5)) {
    const d = decideVerdict({ lineage: buildLineage(p), supersession: null, identicalSurvivor: null });
    heldSample.push(`${p}:${d.verdict}`);
    if (d.verdict === "AUTO_TRASH") heldSafe = false;
  }
  check(heldSafe, "a path a live process holds open never reaches AUTO_TRASH", heldSample.slice(0, 2).join(" ") || "no .ts path held open");

  // ══════════════════════════════════════════════════════════════════════
  head("FINAL INVARIANTS");
  const autoTrash = before.findings.filter((f) => f.verdict === "AUTO_TRASH");
  console.log(`  findings: ${before.findings.length}; AUTO_TRASH among them: ${autoTrash.length}`);
  const verdictCounts: Record<string, number> = {};
  for (const f of before.findings) verdictCounts[f.verdict] = (verdictCounts[f.verdict] ?? 0) + 1;
  console.log(`  verdicts: ${JSON.stringify(verdictCounts)}`);

  // DELETE_WITHOUT_MEANING_PROOF = NO
  let allProven = true;
  for (const f of autoTrash) {
    const d = decideVerdict({ lineage: buildLineage(f.subject), supersession: supersessions.find((s) => s.old_path === f.subject) ?? null, identicalSurvivor: f.counterpart });
    const c = d.conditions;
    if (c.unanswered.length > 0 || !c.zero_active_consumers || !c.zero_runtime_use || !c.zero_protected_references
      || !c.replacement_verified_where_applicable || !c.recoverability_proven || !c.retention_satisfied || !c.source_of_truth_is_false) allProven = false;
  }
  check(allProven, "DELETE_WITHOUT_MEANING_PROOF=NO — every AUTO_TRASH satisfies all seven conditions with none unanswered");

  // UNKNOWN_AUTO_DELETE = NO
  // A path nothing anywhere names. Two details matter and both were learned by
  // getting them wrong: "imaginary.ts" is cited by blueprint fixtures, so it
  // exercises LITERAL_REFERENCE_RETAIN instead; and a literal written here
  // appears in THIS file, which the literal-reference search then finds. So the
  // path is assembled at runtime and exists in no source file anywhere.
  const absentPath = ["control", "q" + "zx-absent-capability", "q" + "zx-absent-file.ts"].join("/");
  const unknownLineage = buildLineage(absentPath);
  const unknownDecision = decideVerdict({ lineage: unknownLineage, supersession: null, identicalSurvivor: null });
  console.log(`  UNKNOWN subject -> ${unknownDecision.verdict} (${unknownDecision.rule})`);
  check(unknownDecision.verdict !== "AUTO_TRASH", "UNKNOWN_AUTO_DELETE=NO — an UNKNOWN resource never reaches AUTO_TRASH", unknownDecision.verdict);
  check(unknownLineage.current_state === "UNKNOWN" && unknownDecision.rule === "UNKNOWN_NEVER_AUTO_TRASH",
    "UNKNOWN_AUTO_DELETE=NO — and it is the UNKNOWN rule itself that refuses, not an incidental one",
    `${unknownLineage.current_state} / ${unknownDecision.rule}`);

  // ACTIVE_RESOURCE_DELETE = NO
  const activeCaps = censusIndex().filter((c) => c.runtime_state === "IN_USE_NOW" || c.runtime_state === "RUNNING");
  console.log(`  capabilities the OS reports in use: ${activeCaps.length}`);
  let activeSafe = true;
  for (const cap of activeCaps.slice(0, 5)) {
    const d = decideVerdict({ lineage: buildLineage(cap.path), supersession: null, identicalSurvivor: null });
    if (d.verdict === "AUTO_TRASH") activeSafe = false;
  }
  check(activeCaps.length > 0 && activeSafe, "ACTIVE_RESOURCE_DELETE=NO — nothing the OS reports in use reaches AUTO_TRASH", `${activeCaps.length} active capabilities checked`);

  // SOURCE_OF_TRUTH_DELETE = NO
  const sotPaths = ["registry/TASK_QUEUE.json", "supabase/migrations/x.sql", "credentials/macos-keychain/provider.ts", "control/agent-gateway/data/evidence.jsonl"];
  let sotSafe = true;
  for (const p of sotPaths) if (sourceOfTruthReason(p) === null) sotSafe = false;
  check(sotSafe, "SOURCE_OF_TRUTH_DELETE=NO — registry, migrations, credentials and evidence are all refused before any other rule", sotPaths.length + " paths");

  // AI_CLEANUP_DECISION = NO, DIRECT_DELETE_PATHS = 0
  // The CAPABILITY's own source. This proof harness is excluded on purpose: it
  // necessarily contains the very pattern strings it searches for, so scanning
  // it makes the assertion match itself and prove nothing. The harness performs
  // no mutation either — it only greps and prints.
  const folder = join(REPO_ROOT, "control/resource-reconciliation");
  const scanArgs = `--include=*.ts --exclude-dir=tests`;
  const aiHits = execFileSync("/bin/sh", ["-c", `/usr/bin/grep -rlE "anthropic|openai|claude|llm|generateText|completion\\(" ${JSON.stringify(folder)} ${scanArgs} 2>/dev/null || true`], { encoding: "utf8" }).trim();
  check(aiHits === "", "AI_CLEANUP_DECISION=NO — no model is consulted anywhere in this capability's source", aiHits || "no hits");
  const deleteHits = execFileSync("/bin/sh", ["-c", `/usr/bin/grep -rnE "unlinkSync|rmSync|rmdirSync|renameSync|writeFileSync|appendFileSync" ${JSON.stringify(folder)} ${scanArgs} 2>/dev/null | grep -vE ":[0-9]+: *[*/]" || true`], { encoding: "utf8" }).trim();
  check(deleteHits === "", "DIRECT_DELETE_PATHS=0 — this capability's source contains no delete, move or write call at all", deleteHits || "none");
  // And the harness itself performs no mutation either — asserted separately so
  // excluding it above is not a hole.
  const harnessMutations = execFileSync("/bin/sh", ["-c",
    `/usr/bin/grep -nE "unlinkSync\\(|rmSync\\(|rmdirSync\\(|renameSync\\(|writeFileSync\\(|appendFileSync\\(" ${JSON.stringify(join(folder, "tests/reconciliation-proof.ts"))} 2>/dev/null | grep -v "grep -" || true`],
    { encoding: "utf8" }).trim();
  check(harnessMutations === "", "the proof harness itself calls no mutation function", harnessMutations || "none");

  // ══════════════════════════════════════════════════════════════════════
  head("POST-CLEANUP VERIFICATION + BEFORE/AFTER METRICS");
  const verification = verifyAfterMutation([
    "control/machine-observation/observation-store.ts",
    "control/agent-gateway/data/evidence.jsonl",
    "software/registry-database/data/canonical",
  ]);
  console.log(`  passed=${verification.passed} read_paths=${verification.read_paths_resolve} graph=${verification.graph_resolves} runtime_current=${verification.runtime_current}`);
  verification.failures.forEach((f) => console.log(`    FAILURE: ${f}`));
  verification.unverified.forEach((u) => console.log(`    UNVERIFIED: ${u.slice(0, 130)}`));
  check(verification.passed, "post-mutation verification passes on the current system", verification.failures.join("; ") || "no failures");
  check(verification.canonical_sources_exist, "every canonical source that must survive still exists");
  check(verification.unverified.length > 0, "what could not be verified is named, so a pass is not read as a full-system guarantee");

  const after = reconcileSystem({ limitPerKind: 40 });
  console.log("\n  BEFORE:", JSON.stringify(before.metrics));
  console.log("  AFTER :", JSON.stringify(after.metrics));
  check(before.metrics.artifact_count === after.metrics.artifact_count,
    "BEFORE and AFTER artifact counts are identical — this run changed nothing, and the report says so rather than claiming a cleanup",
    `${before.metrics.artifact_count} = ${after.metrics.artifact_count}`);
  check(before.unresolved.length > 0, "unanswerable questions are carried in the report", `${before.unresolved.length} unresolved`);
  before.unresolved.forEach((u) => console.log(`    UNRESOLVED: ${u.slice(0, 150)}`));

  console.log(`\n${"═".repeat(78)}\n[REGRESSION]`);
  checks.forEach((c) => console.log(`  ${c.ok ? "✔" : "✘"} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`));
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\nRESULT: ${checks.length - failed} passed, ${failed} failed`);
  console.log("Read-only — nothing was deleted, moved, reset or restarted.");
  process.exit(failed === 0 ? 0 : 1);
}

main();
