/**
 * หน้าที่: the ONLY module outside this folder is allowed to import from —
 * the public contract of `control/conversation-runtime/`. `./main.ts` is
 * not importable — it is a standalone process entrypoint, launched by
 * `./client.ts`'s `spawnConversationRuntime()`, never `require`'d into
 * another process's module graph (doing so would defeat the whole point:
 * a shared module graph is a shared OS process).
 *
 * Input: re-exports only.
 * Output: `spawnConversationRuntime`, `type ConversationRuntimeHandle`,
 * plus every `./protocol.ts` type a transport needs to build a request or
 * read a result.
 * Dependency ที่อนุญาต: ./client.ts, ./protocol.ts.
 * สิ่งที่ห้ามแตะ: never re-export `./main.ts` here.
 */

export { spawnConversationRuntime, type ConversationRuntimeHandle } from "./client";
export { applySemanticFinality, attachFinalityToConversation, ownerAskHttpStatus } from "./semantic-finality";
export { composeOwnerAskHttpBody, finalizeConversationResult } from "./owner-ask-response";
export {
  buildOwnerResponseState,
  commitOwnerResponse,
  composeFromConversation,
  latestOwnerResponse,
  mcpOwnerFactResult,
  ownerWorkSurfaceResponseSlice,
  peekOwnerResponse,
  presentOwnerResponse,
  resetOwnerResponseStore,
} from "./owner-response-projection";
export type { OwnerResponseState, OwnerScreenProjection, McpOwnerFactResult } from "./owner-response-projection";
export { loadConnectionSummaries, canonicalizeConnectionStatus, HUMAN_CONNECTION_STATUS_TH, queryConnectionBoundary } from "./connection-summary";
export type {
  ConversationOwnerIdentity,
  ConversationRequest,
  ConversationResult,
  ConversationStatus,
  StructuredIntent,
} from "./protocol";
