/**
 * Types + pure helpers for the console's per-session state. The actual
 * storage is a React useState in page.tsx (in-memory only, cleared on
 * reload by construction — nothing here persists anywhere). This file only
 * holds:
 *  - a pending intent waiting on entity resolution or clarification
 *  - clarification options (id + label only)
 *  - resolved entities (id + label only)
 * Never a full business-data payload — that lives only in ChatMessageList's
 * transient message history, not in this state.
 */
import type { EntityType } from "./commandCorpus"

export interface ResolvedEntity {
  type: EntityType
  id: string
  label: string
}

export interface PendingClarifyCommand {
  kind: "clarify_command"
  candidates: { command: string; label: string }[]
  originalText: string
}

export interface PendingAwaitEntityKeyword {
  kind: "await_entity_keyword"
  command: string
  entityType: EntityType
  argKey: string
}

export interface PendingClarifyEntity {
  kind: "clarify_entity"
  command: string
  entityType: EntityType
  argKey: string
  options: { id: string; label: string }[]
}

export interface PendingAwaitKeyword {
  kind: "await_keyword"
  command: string
  argKey: string
}

export type PendingState =
  | PendingClarifyCommand
  | PendingAwaitEntityKeyword
  | PendingClarifyEntity
  | PendingAwaitKeyword
  | null

export interface ChatMessage {
  id: string
  sender: "user" | "system"
  kind: "text" | "result" | "clarify" | "write-preview" | "error"
  text: string
  // Only for kind "clarify": the human-readable options, never raw IDs shown.
  options?: string[]
}
