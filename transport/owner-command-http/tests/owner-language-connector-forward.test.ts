/**
 * Proves GET /owner/language shares the existing /chat connector-forward gate.
 * How to run: npx tsx transport/owner-command-http/tests/owner-language-connector-forward.test.ts
 */

import { classifyCommand } from "../../../control/command-router/contract";
import { canonicalExecutionFieldsFromMcp, shouldForwardStructuredIntentToExistingMcp } from "../server";
import type { ConversationResult } from "../../../control/conversation-runtime/protocol";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function ok(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function swallowedKnowledge(): ConversationResult {
  return {
    request_id: "lang-forward",
    trace_id: "lang-forward",
    answer: "connection-index swallowed this as self-knowledge",
    intent: { request_id: "lang-forward", intent: "SELF_KNOWLEDGE_QUERY" },
    status: "ANSWERED",
    evidence_refs: ["connection-index"],
    semantic_outcome: {
      ok: true,
      context: { resolved_state: "RESOLVED", read_only_knowledge: { owner_reply_th: "ความรู้ระบบ" } },
    },
    final_semantic_state: "ANSWERABLE_READ_ONLY",
  };
}

function main(): void {
  const gmail = "list gmail messages";
  const calendar = "google calendar events";
  const drive = "google drive files";
  const sheets = "read spreadsheet Unique Budget";
  const conversation = "ระบบนี้ทำงานอย่างไร";

  const gmailClass = classifyCommand(gmail);
  const calendarClass = classifyCommand(calendar);
  const driveClass = classifyCommand(drive);
  const sheetsClass = classifyCommand(sheets);
  const conversationClass = classifyCommand(conversation);

  ok("gmail matches google-workspace connector", gmailClass.status === "MATCHED" && gmailClass.status === "MATCHED" && gmailClass.capability.capability_id === "google-workspace" && gmailClass.capability.endpoint.kind === "connector");
  ok("calendar matches google-workspace connector", calendarClass.status === "MATCHED" && calendarClass.capability.capability_id === "google-workspace");
  ok("drive matches google-workspace connector", driveClass.status === "MATCHED" && driveClass.capability.capability_id === "google-workspace");
  ok("sheets matches google-workspace connector", sheetsClass.status === "MATCHED" && sheetsClass.capability.capability_id === "google-workspace");
  ok("plain conversation does not match a connector", conversationClass.status !== "MATCHED");

  ok("gmail still forwards after conversation self-knowledge", shouldForwardStructuredIntentToExistingMcp(swallowedKnowledge(), null, gmail) === true);
  ok("calendar still forwards after conversation self-knowledge", shouldForwardStructuredIntentToExistingMcp(swallowedKnowledge(), null, calendar) === true);
  ok("drive still forwards after conversation self-knowledge", shouldForwardStructuredIntentToExistingMcp(swallowedKnowledge(), null, drive) === true);
  ok("sheets still forwards after conversation self-knowledge", shouldForwardStructuredIntentToExistingMcp(swallowedKnowledge(), null, sheets) === true);
  ok("plain conversation stays on language path", shouldForwardStructuredIntentToExistingMcp(swallowedKnowledge(), null, conversation) === false);

  const lifted = canonicalExecutionFieldsFromMcp({
    dna_os_command_id: "cmd_blocked",
    dna_os_work_id: "work_blocked",
    dna_os_task_id: "task_blocked",
    dna_os_result_status: "BLOCKED",
    evidence: ["credential://google/workspace/oauth"],
    result: { status: "BLOCKED", capability_id: "google-workspace", intent: "google.gmail.messages.search" },
  });
  ok("blocked execution still has real command_id", lifted.command_id === "cmd_blocked" && lifted.execution_started === true && lifted.status === "BLOCKED");
  ok("conversation helper does not invent command_id", canonicalExecutionFieldsFromMcp(null).command_id === null);

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
