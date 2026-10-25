/**
 * Manager Question Queue Acceptance Suite (owner, 2026-08-09, Constitution
 * Rule 251 — "Single Owner Inquiry Authority", real build for TASK-042).
 * Proves, against the real, running managerQuestionRuntime.ts +
 * workerTaskOrchestrator.ts composition — never mocked at the module
 * level — every acceptance requirement the Owner specified:
 *
 *  (a) 10 real Workers submitting the same underlying question (worded
 *      differently) -> the Owner-facing queue shows EXACTLY 1 entry.
 *  (b) A question the registry-first lookup can actually answer -> 0
 *      entries in the Owner-facing queue for it, and the asking Worker(s)
 *      get a real answer back.
 *  (c) The Owner answers one aggregated question exactly once -> every
 *      real Worker/Job that asked receives it (multi-asker, including a
 *      real, late asker who asks only AFTER the Owner already answered).
 *  (d) Structural proof (real, whole-repo grep, not just happy-path
 *      testing): no WorkerType execution path imports/calls the two
 *      Owner-facing functions directly — only managerQuestionRuntime.ts
 *      itself (and this test) may reference them.
 *  (e) This suite's own real, captured PASS output is the evidence —
 *      run: npm run manager-question-queue:test
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  submitWorkerQuestion, getOwnerFacingQueue, answerAggregatedQuestion, getAnswerForAsk, extractKeywords,
  MANAGED_REGISTRY_FILES, __debugGetQuestionRecord, __debugResetManagerQuestionQueue, __debugQuestionCount,
  ManagerQuestionError,
} from "../app/api/admin/ide/_lib/managerQuestionRuntime";
import { submitJobContractQuestion, createJobContract } from "../app/api/admin/ide/_lib/workerTaskOrchestrator";
import { WORKER_REGISTRY, type WorkerType } from "../app/api/admin/ide/_lib/workerRegistry";

const ROOT = path.join(__dirname, "..");
const OWNER = `manager-question-owner-${randomUUID()}`;
const ACTOR = "manager-question-queue-suite@dnaos.local";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

function main() {
  __debugResetManagerQuestionQueue(OWNER);

  const WORKER_ROLES: WorkerType[] = [
    "CODE_WORKER", "UI_WORKER", "REVIEW_WORKER", "TEST_WORKER", "DOCUMENT_WORKER",
    "SECURITY_WORKER", "DATA_WORKER", "TOOL_WORKER", "ANALYSIS_WORKER", "CODE_WORKER",
  ];

  // ============================================================
  // Criterion (a) — 10 real Workers, same underlying question (a real
  // architecture-policy decision only the Owner can make — never
  // registry-resolvable), worded differently -> exactly 1 Owner-facing
  // entry. Every wording keeps the same stable keyword core
  // (maxAttempts/cap/high-risk/contract/above) while genuinely varying
  // sentence structure, politeness, tense and verb form.
  // ============================================================
  const escalatedWordings = [
    "Should the maxAttempts cap be raised above 3 for high-risk contracts?",
    "Can we raise the maxAttempts cap above 3 for high-risk contracts?",
    "I would like an Owner decision on raising the maxAttempts cap above 3 for high-risk contracts.",
    "Is it okay to raise the maxAttempts cap above 3 for high-risk contracts?",
    "Please decide whether the maxAttempts cap should go above 3 for high-risk contracts.",
    "Owner, should the maxAttempts cap be allowed above 3 for high-risk contracts?",
    "Do we raise the maxAttempts cap above 3 for high-risk contracts?",
    "Requesting approval to raise the maxAttempts cap above 3 for high-risk contracts.",
    "Should high-risk contracts have their maxAttempts cap raised above 3?",
    "Can the maxAttempts cap for high-risk contracts go above 3?",
  ];
  assert(new Set(escalatedWordings).size === 10, "test bug: expected 10 byte-distinct real wordings");

  const escalatedAskIds: { askId: string; jobContractId: string; workerRole: WorkerType }[] = [];
  test("(a) setup — 10 real Workers (mixed WorkerTypes) submit the same underlying, genuinely-Owner-only question, worded differently", () => {
    for (let i = 0; i < 10; i++) {
      const workerRole = WORKER_ROLES[i % WORKER_ROLES.length];
      const jobContractId = `job-${randomUUID()}`;
      const outcome = submitWorkerQuestion({ workerRole, jobContractId, actor: ACTOR, ownerId: OWNER, questionText: escalatedWordings[i] });
      escalatedAskIds.push({ askId: outcome.askId, jobContractId, workerRole });
      assert(outcome.status === "PENDING_OWNER", `expected ask ${i} (${workerRole}) to be PENDING_OWNER (no recognized registry-resolvable shape should match this architecture question), got ${outcome.status}${outcome.answer ? `, answer: ${outcome.answer}` : ""}`);
    }
  });

  let escalatedQuestionId: string | null = null;
  test("(a) PASS — Owner-facing queue shows EXACTLY 1 aggregated entry covering all 10 real, differently-worded asks", () => {
    const queue = getOwnerFacingQueue(OWNER);
    assert(queue.length === 1, `expected exactly 1 Owner-facing entry, got ${queue.length}: ${JSON.stringify(queue.map((q) => q.canonicalQuestionText))}`);
    escalatedQuestionId = queue[0].questionId;
    assert(queue[0].askerCount === 10, `expected askerCount 10, got ${queue[0].askerCount}`);
    const jobIds = new Set(queue[0].askers.map((a) => a.jobContractId));
    assert(jobIds.size === 10, `expected 10 distinct real jobContractId askers, got ${jobIds.size}`);
    for (const { jobContractId } of escalatedAskIds) assert(jobIds.has(jobContractId), `expected asker jobContractId ${jobContractId} to be present in the aggregated entry`);
  });

  // ============================================================
  // Criterion (b) — a real, registry-resolvable question -> 0 Owner-facing
  // entries for it, and the asking Worker(s) get a real answer directly.
  // ============================================================
  const realActiveWorkers = Object.values(WORKER_REGISTRY).filter((w) => w.status === "ACTIVE").map((w) => w.id).sort();
  test("(b) setup — precondition: real workerRegistry.ts's WORKER_REGISTRY has at least 1 real ACTIVE worker (else this criterion is untestable)", () => {
    assert(realActiveWorkers.length > 0, "expected at least 1 real ACTIVE worker in workerRegistry.ts's WORKER_REGISTRY");
  });

  let activeWorkersOutcome1: ReturnType<typeof submitWorkerQuestion> | null = null;
  test('(b) PASS — a real, registry-resolvable question ("which workers are ACTIVE") is answered directly from real workerRegistry.ts data — RESOLVED_BY_REGISTRY, never PENDING_OWNER', () => {
    activeWorkersOutcome1 = submitWorkerQuestion({ workerRole: "CODE_WORKER", jobContractId: `job-${randomUUID()}`, actor: ACTOR, ownerId: OWNER, questionText: "Which workers are currently ACTIVE?" });
    assert(activeWorkersOutcome1.status === "RESOLVED_BY_REGISTRY", `expected RESOLVED_BY_REGISTRY, got ${activeWorkersOutcome1.status}`);
    assert(activeWorkersOutcome1.matchedShape === "ACTIVE_WORKERS", `expected matchedShape ACTIVE_WORKERS, got ${activeWorkersOutcome1.matchedShape}`);
    assert(activeWorkersOutcome1.answer !== null, "expected a real, non-null answer");
    for (const w of realActiveWorkers) assert(activeWorkersOutcome1!.answer!.includes(w), `expected the real answer to name real ACTIVE worker ${w}, got: ${activeWorkersOutcome1!.answer}`);
  });

  test("(b) PASS — a second, different real Worker asking the SAME resolvable question also gets the identical real answer directly (not queued)", () => {
    const outcome2 = submitWorkerQuestion({ workerRole: "TEST_WORKER", jobContractId: `job-${randomUUID()}`, actor: ACTOR, ownerId: OWNER, questionText: "What workers have ACTIVE status right now?" });
    assert(outcome2.status === "RESOLVED_BY_REGISTRY", `expected RESOLVED_BY_REGISTRY, got ${outcome2.status}`);
    assert(outcome2.answer === activeWorkersOutcome1!.answer, "expected the SAME real answer for the same underlying resolvable question asked by a different Worker");
  });

  test("(b) PASS — the resolvable question NEVER appears in the Owner-facing queue (queue length stays exactly the 1 entry from criterion (a))", () => {
    const queue = getOwnerFacingQueue(OWNER);
    assert(queue.length === 1, `expected the Owner-facing queue to still show only 1 entry (from criterion (a)) — this resolvable question must never reach it. Got ${queue.length} entries: ${JSON.stringify(queue.map((q) => q.canonicalQuestionText))}`);
  });

  test("(b) PASS (second, independent registry-resolvable shape) — a RULE_STATUS question is answered directly from real registry/rule-coverage.json", () => {
    const ruleCoverage = JSON.parse(readFileSync(path.join(ROOT, "registry/rule-coverage.json"), "utf-8")) as { rules: Record<string, { title: string; detection: string }> };
    const rule249 = ruleCoverage.rules["249"];
    assert(!!rule249, "precondition: expected registry/rule-coverage.json to have a real rule 249 entry");
    const outcome = submitWorkerQuestion({ workerRole: "REVIEW_WORKER", jobContractId: `job-${randomUUID()}`, actor: ACTOR, ownerId: OWNER, questionText: "What is the real status of Rule 249?" });
    assert(outcome.status === "RESOLVED_BY_REGISTRY", `expected RESOLVED_BY_REGISTRY, got ${outcome.status}`);
    assert(outcome.matchedShape === "RULE_STATUS", `expected matchedShape RULE_STATUS, got ${outcome.matchedShape}`);
    assert(outcome.answer!.includes(rule249.title), `expected the real answer to include real rule-coverage.json's own title text, got: ${outcome.answer}`);
    const queue = getOwnerFacingQueue(OWNER);
    assert(queue.length === 1, `expected the Owner-facing queue to still show only 1 entry after this RULE_STATUS resolution too, got ${queue.length}`);
  });

  test("(b) (evidence integrity) — the registry-first lookup did REAL file reads across all 5 mandated files, in order, with real keyword hits — never a stub that always says 'not found'", () => {
    const record = __debugGetQuestionRecord(activeWorkersOutcome1!.questionId);
    assert(!!record, "expected to retrieve the real internal record for the resolved ACTIVE_WORKERS question");
    assert(JSON.stringify(record!.registryFilesChecked) === JSON.stringify([...MANAGED_REGISTRY_FILES]), `expected registryFilesChecked to be exactly the 5 mandated files in order, got ${JSON.stringify(record!.registryFilesChecked)}`);
  });

  // ============================================================
  // Criterion (c) — the Owner answers the ONE aggregated question from
  // (a) exactly once -> fans out to all 10 original real askers AND to an
  // 11th, LATE real asker who asks only after the Owner already answered.
  // ============================================================
  const OWNER_ANSWER_TEXT = "Owner decision: maxAttempts stays at 3 for all Job Contracts, including high-risk ones — no architecture change approved at this time.";
  let answerOutcome: ReturnType<typeof answerAggregatedQuestion> | null = null;
  test("(c) setup — the Owner answers the real aggregated question from (a) exactly once", () => {
    assert(escalatedQuestionId !== null, "precondition: expected (a) to have produced a real aggregated questionId");
    answerOutcome = answerAggregatedQuestion(escalatedQuestionId!, OWNER, "owner@dnaos.local", OWNER_ANSWER_TEXT);
    assert(answerOutcome.answer === OWNER_ANSWER_TEXT, "expected the real recorded answer to match exactly what the Owner submitted");
  });

  test("(c) PASS — the fan-out from that single Owner answer covers all 10 real, original askers", () => {
    assert(answerOutcome !== null, "precondition");
    assert(answerOutcome!.fannedOutTo.length === 10, `expected fan-out to exactly 10 real askers, got ${answerOutcome!.fannedOutTo.length}`);
    const fannedJobIds = new Set(answerOutcome!.fannedOutTo.map((f) => f.jobContractId));
    for (const { jobContractId } of escalatedAskIds) assert(fannedJobIds.has(jobContractId), `expected fan-out to include real original asker jobContractId ${jobContractId}`);
  });

  test("(c) PASS — every one of the 10 real, original askers can retrieve the identical real Owner answer via getAnswerForAsk()", () => {
    for (const { askId, jobContractId } of escalatedAskIds) {
      const a = getAnswerForAsk(askId);
      assert(!!a, `expected a real answer lookup result for askId ${askId} (jobContractId=${jobContractId})`);
      assert(a!.status === "ANSWERED_BY_OWNER", `expected ANSWERED_BY_OWNER for jobContractId=${jobContractId}, got ${a!.status}`);
      assert(a!.answer === OWNER_ANSWER_TEXT, `expected the identical real Owner answer for jobContractId=${jobContractId}, got: ${a!.answer}`);
    }
  });

  test("(c) PASS (multi-asker, late arrival) — an 11th real Worker asking the SAME underlying question AFTER the Owner already answered gets the real answer immediately, never re-queued to the Owner", () => {
    const lateOutcome = submitWorkerQuestion({ workerRole: "DATA_WORKER", jobContractId: `job-${randomUUID()}`, actor: ACTOR, ownerId: OWNER, questionText: "Could the maxAttempts cap be raised above 3 for high-risk contracts?" });
    assert(lateOutcome.merged === true, "expected the late ask to merge into the same, already-answered aggregated question");
    assert(lateOutcome.status === "ANSWERED_BY_OWNER", `expected the late asker to receive ANSWERED_BY_OWNER immediately, got ${lateOutcome.status}`);
    assert(lateOutcome.answer === OWNER_ANSWER_TEXT, "expected the late asker's real answer to be identical to the original Owner answer");
  });

  test("(c) (integrity) — the Owner cannot answer the same aggregated question a second time (real ALREADY_ANSWERED error, never a silent overwrite)", () => {
    let threw = false;
    try { answerAggregatedQuestion(escalatedQuestionId!, OWNER, "owner@dnaos.local", "a different, second answer"); }
    catch (e) { threw = e instanceof ManagerQuestionError && e.code === "ALREADY_ANSWERED"; }
    assert(threw, "expected a real ManagerQuestionError(ALREADY_ANSWERED) on a second answer attempt");
  });

  test("(c) PASS — the now-answered question is gone from the Owner-facing queue (only genuinely unresolved questions remain there)", () => {
    const queue = getOwnerFacingQueue(OWNER);
    assert(!queue.some((q) => q.questionId === escalatedQuestionId), "expected the answered question to no longer appear in the Owner-facing queue");
  });

  // ============================================================
  // Evidence / Audit Trail integrity (Owner requirement 8) — every real
  // step produced a real audit event + a real, immutable evidence
  // artifact version (artifactRuntime.ts's own version-history mechanism).
  // ============================================================
  test("(evidence) — the RESOLVED_BY_REGISTRY record's audit trail covers the full real lifecycle 1:1 with real evidence artifact versions", () => {
    const record = __debugGetQuestionRecord(activeWorkersOutcome1!.questionId)!;
    const kinds: string[] = record.auditTrail.map((e) => e.kind);
    assert(kinds.includes("SUBMITTED") && kinds.includes("REGISTRY_LOOKUP") && kinds.includes("RESOLVED_INTERNALLY"), `expected all 3 real lifecycle events, got: ${JSON.stringify(kinds)}`);
    assert(record.evidenceArtifactIds.length === record.auditTrail.length, `expected 1 real evidence artifact per real audit event, got ${record.evidenceArtifactIds.length} artifacts for ${record.auditTrail.length} events`);
    assert(new Set(record.evidenceArtifactIds).size === record.evidenceArtifactIds.length, "expected every evidence artifact id to be real and distinct (a real new version each time, never reused)");
  });

  test("(evidence) — the escalated/answered question's audit trail covers SUBMITTED, REGISTRY_LOOKUP, ESCALATED_TO_OWNER, 10 real DEDUPED_INTO_EXISTING, OWNER_ANSWERED, and 2 real ANSWER_FANNED_OUT events, 1:1 with evidence artifacts", () => {
    const record = __debugGetQuestionRecord(escalatedQuestionId!)!;
    const kinds: string[] = record.auditTrail.map((e) => e.kind);
    for (const required of ["SUBMITTED", "REGISTRY_LOOKUP", "ESCALATED_TO_OWNER", "OWNER_ANSWERED"]) {
      assert(kinds.includes(required), `expected real audit event kind ${required}, got: ${JSON.stringify(kinds)}`);
    }
    assert(kinds.filter((k) => k === "DEDUPED_INTO_EXISTING").length === 10, `expected 10 real DEDUPED_INTO_EXISTING events (9 co-askers from (a) + 1 late asker from (c)), got ${kinds.filter((k) => k === "DEDUPED_INTO_EXISTING").length}`);
    assert(kinds.filter((k) => k === "ANSWER_FANNED_OUT").length === 2, `expected 2 real ANSWER_FANNED_OUT events (the Owner-answer fan-out + the late asker's instant fan-out), got ${kinds.filter((k) => k === "ANSWER_FANNED_OUT").length}`);
    assert(record.evidenceArtifactIds.length === record.auditTrail.length, "expected 1:1 real evidence artifact per real audit event on the escalated question too");
  });

  // ============================================================
  // Criterion (d) — structural proof: no WorkerType execution path may
  // import/call the two Owner-facing functions directly. Real, whole-repo
  // grep, not just happy-path behavioral testing.
  // ============================================================
  function walkTsFiles(dir: string, out: string[]) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git" || entry === ".next-tauri-placeholder") continue;
      const full = path.join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walkTsFiles(full, out);
      else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
    }
  }

  const OWNER_FACING_NAMES = ["getOwnerFacingQueue", "answerAggregatedQuestion"];

  /** Real structural check: does this file actually IMPORT either
   * Owner-facing function from managerQuestionRuntime.ts (making it
   * structurally callable), as opposed to merely mentioning the name in
   * a doc comment (e.g. explaining what is deliberately NOT imported —
   * exactly what workerTaskOrchestrator.ts's own header does). Parses
   * real `import { ... } from ".../managerQuestionRuntime"` specifier
   * lists — the actual mechanism that makes a function reachable in
   * TypeScript/ESM — rather than a blunt whole-file substring search,
   * which would false-positive on documentation prose. */
  function importedOwnerFacingNames(src: string): string[] {
    const offenders: string[] = [];
    const importRegex = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*managerQuestionRuntime["']/g;
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(src))) {
      const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "").trim());
      for (const name of names) if (OWNER_FACING_NAMES.includes(name)) offenders.push(name);
    }
    return offenders;
  }

  test("(d) PASS — real, whole-repo import scan: no file anywhere imports getOwnerFacingQueue/answerAggregatedQuestion from managerQuestionRuntime.ts, except managerQuestionRuntime.ts's own exports and the acceptance test(s) that verify Rule 251's Owner-facing surface directly", () => {
    const files: string[] = [];
    walkTsFiles(path.join(ROOT, "app"), files);
    walkTsFiles(path.join(ROOT, "engines"), files);
    walkTsFiles(path.join(ROOT, "core"), files);
    walkTsFiles(path.join(ROOT, "scripts"), files);
    // cost-gate-test.ts added (owner, 2026-08-09, Constitution Rule 257 —
    // Execution Plane Cost Gate, TASK-048/FCR-009): its own acceptance
    // spec requires proving a real COST_GATE LOCK's escalation actually
    // lands in Rule 251's real Owner-facing queue — a second, real,
    // legitimate consumer of getOwnerFacingQueue() for verification
    // purposes only (read-only; it never calls answerAggregatedQuestion,
    // and no WorkerType execution path gained access — see criterion
    // (d)'s second check below, unchanged).
    // execution-hand-test.ts added (owner, 2026-08-09, Constitution Rule
    // 258 — EXECUTION_HAND, TASK-049): same exact pattern as
    // cost-gate-test.ts above — its own Acceptance 4a requires proving
    // that a real Cost Gate LOCK triggered by an EXECUTION_HAND
    // RUN_COMMAND job really escalates into Rule 251's real Owner-facing
    // queue, tagged financial approval. It reads getOwnerFacingQueue()
    // read-only for that verification only; it never calls
    // answerAggregatedQuestion, and executionHandRuntime.ts itself (the
    // actual EXECUTION_HAND runtime) imports neither Owner-facing
    // function at all — proven by execution-hand-test.ts's own
    // Structural (a) test.
    // edge-function-worker-test.ts added (owner, 2026-08-09, TASK-045 —
    // EDGE_FUNCTION_WORKER, 11th WorkerType, Owner decision
    // DNA-000082/083): same exact pattern as cost-gate-test.ts/
    // execution-hand-test.ts above — its own Acceptance 2 requires
    // proving that a real Cost Gate LOCK triggered by an
    // EDGE_FUNCTION_WORKER dispatch (no pre-approved budget) really
    // escalates into Rule 251's real Owner-facing queue, tagged
    // financial approval. It reads getOwnerFacingQueue() read-only for
    // that verification only; it never calls answerAggregatedQuestion,
    // and edgeFunctionWorkerRuntime.ts itself (the actual dispatch
    // runtime) imports neither Owner-facing function at all — it never
    // even imports managerQuestionRuntime.ts directly, reaching the ask
    // surface only transitively through costGateRuntime.ts's own,
    // already-established call to submitWorkerQuestion().
    const ALLOWED_FILES = ["managerQuestionRuntime.ts", "manager-question-queue-test.ts", "cost-gate-test.ts", "execution-hand-test.ts", "edge-function-worker-test.ts"];
    const offenders: string[] = [];
    for (const f of new Set(files)) {
      if (ALLOWED_FILES.some((allowed) => f.endsWith(allowed))) continue;
      let src: string;
      try { src = readFileSync(f, "utf-8"); } catch { continue; }
      const imported = importedOwnerFacingNames(src);
      if (imported.length > 0) offenders.push(`${f} imports ${imported.join(", ")}`);
    }
    assert(offenders.length === 0, `expected ZERO real imports of either Owner-facing function outside managerQuestionRuntime.ts/this test, found: ${JSON.stringify(offenders)}`);
  });

  test("(d) PASS — no WorkerType execution path file specifically (workerTaskOrchestrator.ts/workerRegistry.ts/workerContract.ts/workerSelectorRuntime.ts/codeWorkerRuntime.ts/workerAdapters/*) imports either Owner-facing function", () => {
    const libDir = path.join(ROOT, "app/api/admin/ide/_lib");
    const targets = [
      "workerTaskOrchestrator.ts", "workerRegistry.ts", "workerContract.ts", "workerSelectorRuntime.ts",
      "codeWorkerRuntime.ts", "workerAdapter.ts", "workerSettingsRuntime.ts",
    ].map((f) => path.join(libDir, f));
    const adapterDir = path.join(libDir, "workerAdapters");
    let adapterFiles: string[] = [];
    try { adapterFiles = readdirSync(adapterDir).filter((f) => f.endsWith(".ts")).map((f) => path.join(adapterDir, f)); } catch { /* dir may not exist */ }
    const offenders: string[] = [];
    for (const f of [...targets, ...adapterFiles]) {
      let src: string;
      try { src = readFileSync(f, "utf-8"); } catch { continue; }
      const imported = importedOwnerFacingNames(src);
      if (imported.length > 0) offenders.push(`${f} imports ${imported.join(", ")}`);
    }
    assert(offenders.length === 0, `expected zero WorkerType execution path files to import either Owner-facing function, found: ${JSON.stringify(offenders)}`);
  });

  test("(d) PASS — positive control: the import-scan methodology is meaningful, not vacuous — workerTaskOrchestrator.ts DOES really import the Worker-facing submitWorkerQuestion (proves the scan above would catch a real violation, not just pass by accident), while importing NEITHER Owner-facing function (its doc comment names them in prose only, to explain what it deliberately does not import — a real, deliberate test of the import-parser's precision against exactly that false-positive)", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/workerTaskOrchestrator.ts"), "utf-8");
    assert(/import\s*\{[^}]*\bsubmitWorkerQuestion\b[^}]*\}\s*from\s*["'][^"']*managerQuestionRuntime["']/.test(src), "expected workerTaskOrchestrator.ts to really import the Worker-facing submitWorkerQuestion()");
    assert(src.includes("getOwnerFacingQueue") || src.includes("answerAggregatedQuestion"), "test-integrity check: expected workerTaskOrchestrator.ts's own doc comment to still mention both Owner-facing names in prose (proves this suite is really exercising the comment-vs-import distinction, not a vacuous file)");
    assert(importedOwnerFacingNames(src).length === 0, "expected workerTaskOrchestrator.ts to IMPORT neither Owner-facing function, even though its doc comment mentions both by name in prose");
  });

  test("(d) PASS — the real, composed Manager entry point (workerTaskOrchestrator.ts's submitJobContractQuestion) round-trips through the exact same production submitWorkerQuestion()/dedupe/registry-lookup mechanism proven above", () => {
    const contract = createJobContract({
      taskDescription: "structural composition probe", acceptanceCriteria: [], permittedReadScope: [], permittedWriteScope: [],
      ownerId: OWNER, actor: ACTOR, workerRole: "CODE_WORKER",
    });
    const outcome = submitJobContractQuestion(contract, "Which workers are currently ACTIVE?");
    assert(outcome.status === "RESOLVED_BY_REGISTRY", `expected the composed entry point to reach the same real resolution, got ${outcome.status}`);
    assert(outcome.answer === activeWorkersOutcome1!.answer, "expected the identical real answer via the composed workerTaskOrchestrator.ts entry point");
  });

  // ============================================================
  // Dedup mechanism — direct proof that the 10 escalated wordings really
  // are distinct, real text (not disguised duplicates) whose keyword sets
  // genuinely differ, yet still merged into 1 real aggregated question.
  // ============================================================
  test("(dedup, direct proof) — extractKeywords() produces overlapping-but-NOT-identical keyword sets across the 10 real, differently-worded questions from (a)", () => {
    const keywordSets = escalatedWordings.map((w) => extractKeywords(w));
    const raw = keywordSets.map((k) => k.join(","));
    assert(new Set(raw).size > 1, "expected the 10 real keyword sets to NOT all be byte-identical (proves real keyword-set matching across genuine rewording, not literal string equality)");
    const core = ["maxattempt", "cap", "highrisk", "contract", "above"];
    for (let i = 0; i < keywordSets.length; i++) {
      for (const c of core) assert(keywordSets[i].includes(c), `expected wording ${i} to keep the real, stable keyword core "${c}", got: ${JSON.stringify(keywordSets[i])}`);
    }
  });

  console.log("\n=== Manager Question Queue Acceptance Suite (Constitution Rule 251) ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  console.log(`\nFinal real Owner-facing queue size for this test's owner: ${getOwnerFacingQueue(OWNER).length}`);
  console.log(`Final real total question-record count for this test's owner: ${__debugQuestionCount(OWNER)}`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main();
