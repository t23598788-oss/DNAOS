/**
 * DNA OS Conversation Registry — Loader
 * Static imports — works in all Next.js environments (SSR, SSG, Edge)
 * All JSON files are imported at build time; no dynamic file system reads.
 */

import type {
  IntentDefinition,
  StateDefinition,
  EntityDefinition,
  MemoryConfig,
  TransitionDefinition,
  ConversationManifest,
  ValidationResult,
} from "./_schema";
import { validateConversationRegistry } from "./_validator";

import manifestRaw from "./_index.registry.json";
import intentRaw from "./intent.registry.json";
import stateRaw from "./state.registry.json";
import entityRaw from "./entity.registry.json";
import memoryRaw from "./memory.registry.json";
import transitionRaw from "./transition.registry.json";

// ─── Internal Maps ───────────────────────────────────────────────────────────

const INTENT_MAP: Record<string, IntentDefinition> = intentRaw.intents as unknown as Record<string, IntentDefinition>;
const STATE_MAP: Record<string, StateDefinition> = stateRaw.states as unknown as Record<string, StateDefinition>;
const ENTITY_MAP: Record<string, EntityDefinition> = entityRaw.entities as unknown as Record<string, EntityDefinition>;
const MEMORY_MAP: Record<string, MemoryConfig> = memoryRaw.memory_configs as unknown as Record<string, MemoryConfig>;
const TRANSITIONS: TransitionDefinition[] = transitionRaw.transitions as unknown as TransitionDefinition[];

// ─── Intent Loaders ──────────────────────────────────────────────────────────

/**
 * Load an intent definition by id.
 */
export function loadIntent(id: string): IntentDefinition | null {
  return INTENT_MAP[id] ?? null;
}

/**
 * List all registered intent ids.
 */
export function listIntents(): string[] {
  return Object.keys(INTENT_MAP);
}

// ─── State Loaders ───────────────────────────────────────────────────────────

/**
 * Load a conversation state definition by id.
 */
export function loadConversationState(id: string): StateDefinition | null {
  return STATE_MAP[id] ?? null;
}

/**
 * List all registered conversation state ids.
 */
export function listConversationStates(): string[] {
  return Object.keys(STATE_MAP);
}

// ─── Entity Loaders ──────────────────────────────────────────────────────────

/**
 * Load an entity definition by id.
 */
export function loadEntity(id: string): EntityDefinition | null {
  return ENTITY_MAP[id] ?? null;
}

/**
 * List all registered entity ids.
 */
export function listEntities(): string[] {
  return Object.keys(ENTITY_MAP);
}

// ─── Memory Config Loader ────────────────────────────────────────────────────

/**
 * Load a memory config by scope key (e.g. "session_memory", "persistent_memory").
 */
export function loadMemoryConfig(scope: string): MemoryConfig | null {
  return MEMORY_MAP[scope] ?? null;
}

// ─── Transition Loader ───────────────────────────────────────────────────────

/**
 * Load all state transitions.
 */
export function loadTransitions(): TransitionDefinition[] {
  return TRANSITIONS;
}

// ─── Manifest ────────────────────────────────────────────────────────────────

/**
 * Return the conversation manifest (_index.registry.json).
 */
export function getConversationManifest(): ConversationManifest {
  return manifestRaw as unknown as ConversationManifest;
}

// ─── Validate All ────────────────────────────────────────────────────────────

/**
 * Validate all loaded conversation registries and return results.
 */
export function validateAllConversation(): ValidationResult[] {
  return [
    validateConversationRegistry("intent", intentRaw),
    validateConversationRegistry("state", stateRaw),
    validateConversationRegistry("entity", entityRaw),
    validateConversationRegistry("memory", memoryRaw),
    validateConversationRegistry("transition", transitionRaw),
  ];
}
