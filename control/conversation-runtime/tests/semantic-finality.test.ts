/**
 * SEMANTIC_RESOLUTION_FINALITY_V1 proofs A–K.
 *
 * How to run:
 *   npx tsx control/conversation-runtime/tests/semantic-finality.test.ts
 */

import { composeOwnerAskHttpBody } from "../owner-ask-response";
import { applySemanticFinality, canonicalizeConnectionStatus, HUMAN_CONNECTION_STATUS_TH, loadConnectionSummaries, queryConnectionBoundary } from "../contract";
import { answerSelfKnowledgeQuery } from "../self-knowledge-reader";
import { productionBoundaryProjection } from "../../work-production-pipeline/contract";
import { validateSelfQuestionModelOutput } from "../self-question-classifier";
import { handleConversationRequest } from "../main";
import { resetOwnerResponseStore } from "../owner-response-projection";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OWNER_RESPONSE_STORE = join(tmpdir(), `owner-response-finality-${Date.now()}.json`);

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const facts = answerSelfKnowledgeQuery("CONNECTIONS");

  await check("A. Resolved read-only fact cannot fall back to semantic blocked", () => {
    const finality = applySemanticFinality({
      answer: facts.answer,
      status: "ANSWERED",
      evidence_refs: facts.source_records,
      semantic_outcome: { ok: false, unresolved: "stale parser snapshot" },
      intent: "SELF_KNOWLEDGE_QUERY",
      subject_resolved: true,
      fact_owner_selected: true,
      facts_nonempty: true,
      assembly_succeeded: true,
      parser_ok: false,
    });
    assert(finality.FINAL_SEMANTIC_STATE === "ANSWERABLE_READ_ONLY", finality.FINAL_SEMANTIC_STATE);
    assert(finality.READ_ONLY_LANGUAGE_BLOCKED === false, "must not block");
    const http = composeOwnerAskHttpBody({
      request_id: "req-a",
      trace_id: "tr-a",
      answer: facts.answer,
      intent: { request_id: "req-a", intent: "SELF_KNOWLEDGE_QUERY" },
      status: "ANSWERED",
      evidence_refs: facts.source_records,
      semantic_outcome: { ok: false, unresolved: "stale parser snapshot" },
    }, "READ_ONLY_LANGUAGE");
    assert(http.status === "TRANSLATED", String(http.status));
    assert(http.READ_ONLY_LANGUAGE_BLOCKED === false, "HTTP must not use stale semantic.ok");
    assert(http.EXECUTION_STARTED === false, "no execution");
  });

  await check("B. Missing fact remains FACT_NOT_AVAILABLE", () => {
    const finality = applySemanticFinality({
      answer: "ไม่ทราบ (UNKNOWN — ไม่มีหลักฐานในทะเบียน)",
      status: "UNRESOLVED",
      evidence_refs: [],
      semantic_outcome: { ok: true },
      intent: "SELF_KNOWLEDGE_QUERY",
      subject_resolved: true,
      fact_owner_selected: true,
      facts_nonempty: false,
      assembly_succeeded: false,
    });
    assert(finality.FINAL_SEMANTIC_STATE === "FACT_NOT_AVAILABLE", finality.FINAL_SEMANTIC_STATE);
  });

  await check("C. Read-only answer never starts execution", () => {
    const finality = applySemanticFinality({
      answer: facts.answer,
      status: "ANSWERED",
      evidence_refs: facts.source_records,
      semantic_outcome: { ok: true, self_knowledge: facts },
      intent: "SELF_KNOWLEDGE_QUERY",
      subject_resolved: true,
      fact_owner_selected: true,
      facts_nonempty: true,
      assembly_succeeded: true,
    });
    assert(finality.EXECUTION_STARTED === false, "execution");
  });

  await check("D. Action request without authority remains ACTION_BLOCKED", () => {
    const finality = applySemanticFinality({
      answer: "ไม่มี capability คำนวณ",
      status: "DENIED",
      evidence_refs: [],
      semantic_outcome: { ok: false, unsupported: "CALCULATION" },
      intent: "UNSUPPORTED_CAPABILITY",
      action_request: true,
      execution_authorized: false,
      subject_resolved: true,
      facts_nonempty: false,
      assembly_succeeded: true,
    });
    assert(finality.FINAL_SEMANTIC_STATE === "ACTION_BLOCKED", finality.FINAL_SEMANTIC_STATE);
    assert(finality.EXECUTION_STARTED === false, "no start");
  });

  await check("E. Earlier parser state cannot override later verified resolution", () => {
    const finality = applySemanticFinality({
      answer: facts.answer,
      status: "UNRESOLVED",
      evidence_refs: facts.source_records,
      semantic_outcome: { ok: false, stage: "CONTRACT", reasons: ["ambiguous"] },
      intent: "SELF_KNOWLEDGE_QUERY",
      parser_ok: false,
      subject_resolved: true,
      fact_owner_selected: true,
      facts_nonempty: true,
      assembly_succeeded: true,
    });
    assert(finality.FINAL_SEMANTIC_STATE === "ANSWERABLE_READ_ONLY", finality.FINAL_SEMANTIC_STATE);
    assert(finality.STALE_SEMANTIC_STATE_OVERRIDE === false, "stale");
  });

  await check("F. Empty factual projection can still block truthfully", () => {
    const finality = applySemanticFinality({
      answer: null,
      status: "UNRESOLVED",
      evidence_refs: [],
      semantic_outcome: { ok: false },
      intent: null,
      parser_ok: false,
      subject_resolved: false,
      facts_nonempty: false,
      assembly_succeeded: false,
    });
    assert(finality.FINAL_SEMANTIC_STATE === "SEMANTIC_UNRESOLVED", finality.FINAL_SEMANTIC_STATE);
    assert(finality.READ_ONLY_LANGUAGE_BLOCKED === true, "true block only when no facts");
  });

  await check("G. Machine enums remain canonical English identifiers", () => {
    const { summaries } = loadConnectionSummaries();
    assert(summaries.length > 0, "index present");
    for (const row of summaries) {
      assert(["VERIFIED", "CONNECTED", "NOT_VERIFIED", "BLOCKED", "NOT_WIRED", "DENIED_BY_ARCHITECTURE"].includes(row.status), row.status);
      assert(String(row.status) !== "เชื่อมต่อแล้ว" && String(row.status) !== "ตรวจสอบแล้ว", row.status);
    }
    assert(canonicalizeConnectionStatus("เชื่อมต่อแล้ว") === "NOT_VERIFIED", "thai is not passed through");
  });

  await check("H. Human presentation may localize independently", () => {
    assert(HUMAN_CONNECTION_STATUS_TH.VERIFIED === "ตรวจสอบแล้ว", HUMAN_CONNECTION_STATUS_TH.VERIFIED);
    assert(HUMAN_CONNECTION_STATUS_TH.CONNECTED === "เชื่อมต่อแล้ว", HUMAN_CONNECTION_STATUS_TH.CONNECTED);
  });

  await check("I. Large connection documents summarize without losing evidence refs", () => {
    assert(!facts.answer.includes("canonical_path"), "must not dump full documents");
    assert(facts.source_records.some((ref) => ref.includes("connection-document.json") || ref.includes("connection-index")), JSON.stringify(facts.source_records.slice(0, 5)));
    assert(facts.answer.includes("next_missing_boundary="), facts.answer.slice(0, 200));
  });

  await check("J. Production pipeline can query GITHUB_PUBLISH → DEPLOYMENT_AUTHORITY", () => {
    const { summaries } = loadConnectionSummaries();
    const gap = queryConnectionBoundary(summaries, "GITHUB_PUBLISH", "DEPLOYMENT_AUTHORITY");
    assert(gap === "NOT_WIRED", String(gap));
    const proj = productionBoundaryProjection();
    assert(proj.GITHUB_PUBLISH_TO_DEPLOYMENT_AUTHORITY === "NOT_WIRED", String(proj.GITHUB_PUBLISH_TO_DEPLOYMENT_AUTHORITY));
  });

  await check("K. Railway mutation remains NOT_WIRED", () => {
    const proj = productionBoundaryProjection();
    assert(proj.RAILWAY_DEPLOYMENT_MUTATION === "NOT_WIRED", String(proj.RAILWAY_DEPLOYMENT_MUTATION));
  });

  await check("G-raw. raw_text may be echoed on self-question classification", () => {
    const owner = "DNA OS มี connection อะไรบ้าง";
    const ok = validateSelfQuestionModelOutput(JSON.stringify({
      raw_text: owner,
      subject_candidate: "SELF",
      question_type_candidate: "CONNECTIONS",
      confidence: 0.9,
    }), owner);
    assert(ok.ok === true, ok.ok === false ? ok.reason : "ok");
    const mutation = validateSelfQuestionModelOutput(JSON.stringify({
      raw_text: "deploy railway now",
      subject_candidate: "SELF",
      question_type_candidate: "WORK_STATUS",
      confidence: 0.5,
    }), "deploy railway now");
    assert(mutation.ok === true, "mutation still classifies");
    const relation = validateSelfQuestionModelOutput(JSON.stringify({
      raw_text: "github ต่อกับ railway อย่างไร",
      subject_candidate: null,
      question_type_candidate: "CONNECTIONS",
      confidence: 0.7,
    }), "github ต่อกับ railway อย่างไร");
    assert(relation.ok === true, "relationship question");
    const bad = validateSelfQuestionModelOutput(JSON.stringify({
      raw_text: "other",
      subject_candidate: "SELF",
      question_type_candidate: "CONNECTIONS",
      confidence: 0.9,
    }), owner);
    assert(bad.ok === false, "must reject rewritten raw_text");
    const system = validateSelfQuestionModelOutput(JSON.stringify({
      subject_candidate: "SELF",
      question_type_candidate: "WHAT_AM_I",
      confidence: 0.95,
    }), "ฉันคืออะไร");
    assert(system.ok === true, "exact/system question without raw_text remains valid");
  });

  if (process.env.DNA_OS_HERMETIC_SOURCE !== "1") {
  await check("LIVE. Read-only self-knowledge is ANSWERABLE_READ_ONLY", () => {
    const live = handleConversationRequest({
      request_id: "live-self-knowledge",
      trace_id: "live-self-knowledge",
      owner_identity: { identity_id: "identity-owner-finality", kind: "human" },
      text: "DNA OS มี connection อะไรบ้าง",
      persist: false,
    });
    const http = composeOwnerAskHttpBody(live, "READ_ONLY_LANGUAGE");
    console.log(`LIVE_STATUS=${String(http.FINAL_SEMANTIC_STATE)} HTTP=${String(http.status)} BLOCKED=${String(http.READ_ONLY_LANGUAGE_BLOCKED)} EXEC=${String(http.EXECUTION_STARTED)}`);
    if (live.intent?.intent === "UNRESOLVED_LANGUAGE") {
      throw new Error(`language processor unresolved: ${live.answer}`);
    }
    assert(http.FINAL_SEMANTIC_STATE === "ANSWERABLE_READ_ONLY" || http.FINAL_SEMANTIC_STATE === "FACT_NOT_AVAILABLE", String(http.FINAL_SEMANTIC_STATE));
    assert(http.READ_ONLY_LANGUAGE_BLOCKED === false, "must not end READ_ONLY_LANGUAGE_BLOCKED");
    assert(http.EXECUTION_STARTED === false, "execution");
    assert(http.status === "TRANSLATED", String(http.status));
    assert(typeof http.answer === "string" && String(http.answer).length > 0, "answer");
    const state = http.owner_response_state as { answer_state?: string } | undefined;
    assert(state?.answer_state === "ANSWERABLE_READ_ONLY" || state?.answer_state === "FACT_NOT_AVAILABLE", String(state?.answer_state));
  });
  }

  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED = ${failed === 0}`);
  resetOwnerResponseStore();
  process.exit(failed === 0 ? 0 : 1);
}

void main();
