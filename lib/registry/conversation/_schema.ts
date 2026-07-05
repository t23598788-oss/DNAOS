/**
 * DNA OS Conversation Registry — TypeScript Contract
 * Schema interfaces for intent, state, entity, memory, and transition registries
 */

export type IntentId = string;
export type StateId = string;
export type EntityId = string;
export type MemoryScope = "session" | "persistent" | "none";

export interface IntentDefinition {
  id: IntentId;
  label: string;
  description: string;
  examples_th: string[];   // Thai example phrases
  required_entities: EntityId[];
  optional_entities: EntityId[];
  triggers_state?: StateId;
  confidence_threshold: number;  // 0.0-1.0
  status: "ACTIVE" | "DISABLED";
}

export interface StateDefinition {
  id: StateId;
  label: string;
  description: string;
  collecting: EntityId[];    // entities being collected in this state
  terminal: boolean;
  timeout_ms?: number;
  on_timeout?: StateId;
  status: "ACTIVE" | "DISABLED";
}

export interface EntityDefinition {
  id: EntityId;
  label: string;
  type: "string" | "number" | "location" | "enum" | "date" | "boolean";
  required: boolean;
  enum_values?: string[];       // for type=enum
  examples_th: string[];
  extraction_model: string;     // which engine extracts this entity
  db_column?: string;           // corresponding DB column
  status: "ACTIVE" | "DISABLED";
}

export interface MemoryConfig {
  scope: MemoryScope;
  storage_table: string | null;
  ttl_seconds: number | null;
  fields: EntityId[];
  note: string;
}

export interface TransitionDefinition {
  id: string;
  from: StateId;
  to: StateId;
  trigger: string;          // "intent:PRICE_QUERY" or "entity:material_type_received" etc.
  condition?: string;       // optional condition expression
  priority: number;         // lower = higher priority
}

export interface ConversationManifest {
  version: number;
  last_updated: string;
  registries: Record<string, { file: string; status: string; description: string }>;
  initial_state: StateId;
  terminal_states: StateId[];
}

export interface ValidationResult {
  valid: boolean;
  name: string;
  errors: Array<{ field: string; message: string; code: string }>;
  warnings: Array<{ field: string; message: string }>;
}
