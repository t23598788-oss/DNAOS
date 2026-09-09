/**
 * หน้าที่: the IPC message shapes crossing the Owner Conversation Layer's
 * process boundary (Owner UNLOCK 2026-09-06, PHASE 2C/2D of
 * ISOLATE_OWNER_CONVERSATION_RUNTIME). Both `./main.ts` (inside the child
 * process) and `./client.ts` (inside the parent/transport process) import
 * only this file to agree on shape — neither imports the other directly.
 *
 * `StructuredIntent` is deliberately narrow. None of these fields may ever
 * be added: `executable`, `executable_path`, `shell_command`, `argv`,
 * `credential`, `adapter_module`, or any endpoint capable of mutation. A
 * field like that would let a "structured intent" carry the same authority
 * as a real execution request, defeating the entire boundary this folder
 * exists to draw. The conversation runtime NEVER executes an intent itself
 * — it only reports one, or reports why it could not.
 */

import type { FinalSemanticState, ResolutionPhase } from "./semantic-finality";

export interface ConversationOwnerIdentity {
  readonly identity_id: string;
  readonly kind: string;
}

export interface ConversationRequest {
  readonly request_id: string;
  readonly trace_id: string;
  readonly owner_identity: ConversationOwnerIdentity;
  readonly text: string;
  readonly conversation_context_refs?: readonly string[];
  /**
   * Mirrors `SemanticDeps.persist` on `control/owner-command-semantics/contract.ts`
   * exactly — `false` for a read-only inspection that must not append to
   * `semantic-history.jsonl` (e.g. `transport/owner-command-http/server.ts`'s
   * `GET /owner/language`). Defaults to `true` (durable production intake)
   * when omitted.
   */
  readonly persist?: boolean;
}

export interface StructuredIntent {
  readonly request_id: string;
  readonly intent: string;
  readonly capability_id?: string;
  readonly target_id?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly confidence?: number;
  readonly unresolved_reason?: string;
}

export type ConversationStatus = "ANSWERED" | "UNRESOLVED" | "DENIED";

export interface ConversationResult {
  readonly request_id: string;
  readonly trace_id: string;
  readonly answer: string | null;
  readonly intent: StructuredIntent | null;
  readonly status: ConversationStatus;
  readonly evidence_refs: readonly string[];
  /**
   * The exact `SemanticOutcome` (`{ok:true, context: StructuredOwnerContext}`
   * or `{ok:false, stage, reasons}`) that
   * `translateOwnerMessage`/`resolveOwnerCommandSemantics` produced,
   * serialized as plain JSON — added (Owner UNLOCK 2026-09-06,
   * FLIP_PRODUCTION_OWNER_CONVERSATION_TO_ISOLATED_RUNTIME) so
   * `transport/owner-command-http/server.ts` can render byte-identical
   * response bodies to its pre-flip shape. It is data only: every field on
   * `StructuredOwnerContext` is already plain strings/arrays/objects (see
   * `control/owner-command-semantics/types.ts`) — nothing function-valued
   * or class-instance-valued ever lived on it, so nothing is lost by
   * crossing this JSON boundary.
   */
  readonly semantic_outcome: unknown;
  readonly final_semantic_state?: FinalSemanticState;
  readonly resolution_phase?: ResolutionPhase;
  readonly execution_started?: false;
  readonly read_only_language_blocked?: boolean;
}

export interface ConversationStageMessage {
  readonly message_type: "stage";
  readonly request_id: string;
  readonly event: Readonly<Record<string, unknown>>;
}

/** Field names a `ConversationRequest` must never carry. Checked on every line read from stdin before any processing — see `./main.ts`. */
export const FORBIDDEN_REQUEST_FIELDS: readonly string[] = [
  "executable",
  "executable_path",
  "shell_command",
  "argv",
  "credential",
  "adapter_module",
  "deployment_target_secret",
  "endpoint",
];

export function isWellFormedConversationRequest(value: unknown): value is ConversationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.request_id !== "string" || candidate.request_id.length === 0) return false;
  if (typeof candidate.text !== "string") return false;
  const identity = candidate.owner_identity;
  if (!identity || typeof identity !== "object") return false;
  const id = identity as Record<string, unknown>;
  if (typeof id.identity_id !== "string" || typeof id.kind !== "string") return false;
  for (const forbidden of FORBIDDEN_REQUEST_FIELDS) {
    if (forbidden in candidate) return false;
  }
  return true;
}
