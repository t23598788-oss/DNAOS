/**
 * CANONICAL_INFORMATION_LIVE_VERIFICATION — ENVIRONMENT_REQUIRED.
 * May read running DNA OS conversation/canonical state. Not source admission.
 *
 * How to run:
 *   npx tsx control/canonical-information/tests/canonical-information-live.test.ts
 */

import { handleConversationRequest } from "../../conversation-runtime/main";
import { composeOwnerAskHttpBody } from "../../conversation-runtime/owner-ask-response";

declare const process: { env: Record<string, string | undefined>; exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function main(): void {
  const live = handleConversationRequest({
    request_id: "live-canonical-information",
    trace_id: "live-canonical-information",
    owner_identity: { identity_id: "identity-canonical-live", kind: "human" },
    text: "DNA OS มี connection อะไรบ้าง",
    persist: false,
  });
  const http = composeOwnerAskHttpBody(live, "READ_ONLY_LANGUAGE");
  if (live.intent?.intent === "UNRESOLVED_LANGUAGE") {
    console.log("CANONICAL_INFORMATION_LIVE=NOT_AVAILABLE");
    console.log(`NOT_AVAILABLE language processor: ${live.answer}`);
    process.exit(4);
  }
  if (http.FINAL_SEMANTIC_STATE === "ANSWERABLE_READ_ONLY" || http.FINAL_SEMANTIC_STATE === "FACT_NOT_AVAILABLE") {
    console.log("CANONICAL_INFORMATION_LIVE=VERIFIED");
    process.exit(0);
  }
  console.error(`CANONICAL_INFORMATION_LIVE=FAILED state=${String(http.FINAL_SEMANTIC_STATE)}`);
  process.exit(1);
}

void main();
