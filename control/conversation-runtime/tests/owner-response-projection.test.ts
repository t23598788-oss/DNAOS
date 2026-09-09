/**
 * OWNER_RESPONSE_PROJECTION_V1 proofs.
 *
 * How to run:
 *   npx tsx control/conversation-runtime/tests/owner-response-projection.test.ts
 */

import { composeOwnerAskHttpBody } from "../owner-ask-response";
import { applySemanticFinality } from "../semantic-finality";
import { handleConversationRequest } from "../main";
import { ownerWorkSurfaceSnapshot } from "../../owner-work-surface/contract";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import {
  buildOwnerResponseState,
  commitOwnerResponse,
  illegalAnswerReadyBlocked,
  mcpOwnerFactResult,
  presentOwnerResponse,
  resetOwnerResponseStore,
} from "../owner-response-projection";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OWNER_RESPONSE_STORE = join(tmpdir(), `owner-response-${Date.now()}.json`);

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): asserts condition {
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
  resetOwnerResponseStore();

  await check("stale blocked v1 cannot overwrite resolved v2", () => {
    resetOwnerResponseStore();
    const blockedFinality = applySemanticFinality({
      answer: "ยังตีความข้อความนี้ไม่ได้ — parser snapshot",
      status: "UNRESOLVED",
      evidence_refs: [],
      semantic_outcome: { ok: false },
      intent: null,
      parser_ok: false,
      subject_resolved: false,
      facts_nonempty: false,
      assembly_succeeded: false,
    });
    const v1 = buildOwnerResponseState({
      request_id: "stale-ui",
      finality: blockedFinality,
      evidence_refs: [],
      response_version: 1,
      facts_version: 1,
      presentation_version: 1,
    });
    const answeredFinality = applySemanticFinality({
      answer: "Connection Index สรุป 8 รายการ",
      status: "ANSWERED",
      evidence_refs: ["connections/connection-index/index.json"],
      semantic_outcome: { ok: false },
      intent: "SELF_KNOWLEDGE_QUERY",
      subject_resolved: true,
      fact_owner_selected: true,
      facts_nonempty: true,
      assembly_succeeded: true,
      parser_ok: false,
    });
    const v2 = buildOwnerResponseState({
      request_id: "stale-ui",
      finality: answeredFinality,
      evidence_refs: ["connections/connection-index/index.json"],
      response_version: 2,
      facts_version: 2,
      presentation_version: 2,
    });
    const first = commitOwnerResponse(v2);
    const second = commitOwnerResponse(v1);
    assert(first.accepted.response_version === 2, "v2 first");
    assert(second.discarded?.response_version === 1, "v1 discarded");
    assert(second.accepted.response_version === 2, String(second.accepted.response_version));
    assert(second.accepted.answer_state === "ANSWERABLE_READ_ONLY", second.accepted.answer_state);
    assert(second.STALE_RESPONSE_OVERRIDE === false, "stale override");
    const screen = presentOwnerResponse(second.accepted);
    assert(screen.response_version === 2, String(screen.response_version));
    assert(screen.answer_state === "ANSWERABLE_READ_ONLY", screen.answer_state);
    assert(screen.visible_text.includes("Connection Index"), screen.visible_text);
  });

  await check("presentation cannot change ANSWERABLE_READ_ONLY to BLOCKED", () => {
    const finality = applySemanticFinality({
      answer: "verified fact",
      status: "ANSWERED",
      evidence_refs: ["e1"],
      semantic_outcome: { ok: false },
      intent: "SELF_KNOWLEDGE_QUERY",
      subject_resolved: true,
      fact_owner_selected: true,
      facts_nonempty: true,
      assembly_succeeded: true,
    });
    const state = buildOwnerResponseState({
      request_id: "present-1",
      finality,
      evidence_refs: ["e1"],
      response_version: 1,
      facts_version: 1,
      presentation_version: 9,
    });
    const th = presentOwnerResponse(state, "th");
    const en = presentOwnerResponse(state, "en");
    assert(th.answer_state === state.answer_state && en.answer_state === state.answer_state, "locale cannot change answer_state");
    assert(th.fact_state === "VERIFIED" && en.fact_state === "VERIFIED", "fact_state");
    assert(th.PRESENTATION_CAN_CHANGE_SEMANTIC_STATE === false, "flag");
  });

  await check("OWNER_ANSWER_READY cannot be SEMANTIC_UNRESOLVED after verified assembly", () => {
    const finality = applySemanticFinality({
      answer: "facts",
      status: "ANSWERED",
      evidence_refs: ["e"],
      semantic_outcome: { ok: false },
      intent: "SELF_KNOWLEDGE_QUERY",
      subject_resolved: true,
      fact_owner_selected: true,
      facts_nonempty: true,
      assembly_succeeded: true,
    });
    const state = buildOwnerResponseState({
      request_id: "inv-1",
      finality,
      evidence_refs: ["e"],
      response_version: 1,
      facts_version: 1,
      presentation_version: 1,
    });
    const illegal = illegalAnswerReadyBlocked([
      { stage: "ANSWER_ASSEMBLY_COMPLETED", status: "COMPLETED" },
      { stage: "HUMAN_PRESENTATION_COMPLETED", status: "COMPLETED" },
      { stage: "OWNER_ANSWER_READY", status: "COMPLETED", decision: "SEMANTIC_UNRESOLVED" },
    ], state);
    assert(illegal === true, "sequence is illegal");
    assert(state.answer_state !== "SEMANTIC_UNRESOLVED", state.answer_state);
  });

  await check("MCP structured fact result is not an error", () => {
    const finality = applySemanticFinality({
      answer: "facts",
      status: "ANSWERED",
      evidence_refs: ["e"],
      semantic_outcome: { ok: true },
      intent: "SELF_KNOWLEDGE_QUERY",
      subject_resolved: true,
      fact_owner_selected: true,
      facts_nonempty: true,
      assembly_succeeded: true,
    });
    const state = buildOwnerResponseState({
      request_id: "mcp-1",
      finality,
      evidence_refs: ["e"],
      response_version: 1,
      facts_version: 1,
      presentation_version: 1,
    });
    const mcp = mcpOwnerFactResult(state);
    assert(mcp.isError === false, "not protocol error");
    assert(mcp.execution_started === false, "no execution");
    assert(mcp.facts_verified === true, "verified");
    assert(mcp.answer_state === "ANSWERABLE_READ_ONLY", mcp.answer_state);
    assert(DNA_OS_MCP_TOOLS.some((tool) => tool.metadata.name === "dna_os.get_owner_response"), "tool registered");
  });

  if (process.env.DNA_OS_HERMETIC_SOURCE !== "1") {
  await check("LIVE. self-knowledge reaches Owner screen as ANSWERABLE_READ_ONLY", () => {
    resetOwnerResponseStore();
    const live = handleConversationRequest({
      request_id: "live-owner-screen",
      trace_id: "live-owner-screen",
      owner_identity: { identity_id: "identity-owner-projection", kind: "human" },
      text: "DNA OS มี connection อะไรบ้าง",
      persist: false,
    });
    const http = composeOwnerAskHttpBody(live, "READ_ONLY_LANGUAGE");
    const state = http.owner_response_state as { answer_state?: string; facts_verified?: boolean; execution_started?: boolean; block_reason?: string | null; structured_answer?: { non_empty?: boolean } };
    const screen = http.owner_screen as { visible_text?: string; answer_state?: string; response_version?: number };
    console.log(`LIVE_SELF_KNOWLEDGE_RESPONSE=${String(state.answer_state)} BLOCK=${String(http.BLOCK_REASON)} HTTP_BLOCKED=${String(http.READ_ONLY_LANGUAGE_BLOCKED)}`);
    assert(live.intent?.intent !== "UNRESOLVED_LANGUAGE", String(live.answer));
    assert(state.answer_state === "ANSWERABLE_READ_ONLY", String(state.answer_state));
    assert(state.facts_verified === true, "facts");
    assert(state.execution_started === false, "exec");
    assert(state.block_reason === null, String(state.block_reason));
    assert(http.READ_ONLY_LANGUAGE_BLOCKED === false, "must not end READ_ONLY_LANGUAGE_BLOCKED");
    assert(typeof screen.visible_text === "string" && screen.visible_text.length > 20, "visible");
    assert(!screen.visible_text.includes("ยังตีความข้อความนี้ไม่ได้"), screen.visible_text.slice(0, 80));
    const snap = ownerWorkSurfaceSnapshot("ai://owner-projection", "session-owner-projection");
    const slice = snap.owner_response as { owner_screen?: { visible_text?: string; answer_state?: string }; owner_response_state?: { answer_state?: string }; render_from?: string };
    assert(slice.render_from === "owner_response_state", "single source");
    assert(slice.owner_response_state?.answer_state === "ANSWERABLE_READ_ONLY", String(slice.owner_response_state?.answer_state));
    assert(typeof slice.owner_screen?.visible_text === "string" && slice.owner_screen.visible_text.includes("connection"), slice.owner_screen?.visible_text?.slice(0, 80) ?? "");
  });
  }

  console.log(`NEW_REGRESSION_TESTS_PASSED = ${failed === 0}`);
  resetOwnerResponseStore();
  process.exit(failed === 0 ? 0 : 1);
}

void main();
