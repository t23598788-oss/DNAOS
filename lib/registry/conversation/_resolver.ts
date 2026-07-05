/**
 * DNA OS Conversation Registry — Resolver
 * Resolution API — use these functions instead of importing JSON directly.
 * All consumers must go through the Registry, never access JSON files directly.
 */

import {
  loadIntent,
  loadConversationState,
  loadEntity,
  loadTransitions,
  getConversationManifest,
} from "./_loader";
import type {
  IntentDefinition,
  StateDefinition,
  EntityDefinition,
  TransitionDefinition,
} from "./_schema";

// ─── Intent Resolvers ────────────────────────────────────────────────────────

/**
 * Resolve an intent definition by id.
 */
export function resolveIntent(id: string): IntentDefinition | null {
  return loadIntent(id);
}

/**
 * Returns true if the intent exists and has status ACTIVE.
 */
export function isIntentActive(intentId: string): boolean {
  return loadIntent(intentId)?.status === "ACTIVE";
}

/**
 * Resolve the full EntityDefinition objects for all required_entities of an intent.
 * Skips any entity ids that are not registered.
 */
export function resolveRequiredEntities(intentId: string): EntityDefinition[] {
  const intent = loadIntent(intentId);
  if (!intent) return [];
  return intent.required_entities
    .map((entityId) => loadEntity(entityId))
    .filter((e): e is EntityDefinition => e !== null);
}

// ─── State Resolvers ─────────────────────────────────────────────────────────

/**
 * Resolve a conversation state definition by id.
 */
export function resolveConversationState(id: string): StateDefinition | null {
  return loadConversationState(id);
}

/**
 * Returns true if the state exists and has status ACTIVE.
 */
export function isConversationStateActive(stateId: string): boolean {
  return loadConversationState(stateId)?.status === "ACTIVE";
}

/**
 * Returns the initial state id from the conversation manifest.
 */
export function resolveInitialState(): string {
  return getConversationManifest().initial_state;
}

/**
 * Returns the terminal state ids from the conversation manifest.
 */
export function resolveTerminalStates(): string[] {
  return getConversationManifest().terminal_states;
}

/**
 * Returns true if the given state id is a terminal state.
 */
export function isTerminalState(stateId: string): boolean {
  return getConversationManifest().terminal_states.includes(stateId);
}

// ─── Entity Resolvers ────────────────────────────────────────────────────────

/**
 * Resolve an entity definition by id.
 */
export function resolveEntity(id: string): EntityDefinition | null {
  return loadEntity(id);
}

/**
 * Returns true if the entity exists and has status ACTIVE.
 */
export function isEntityActive(entityId: string): boolean {
  return loadEntity(entityId)?.status === "ACTIVE";
}

// ─── Transition Resolvers ────────────────────────────────────────────────────

/**
 * Resolve all transitions from a given state id, sorted by priority (ascending).
 */
export function resolveTransitionsFrom(stateId: string): TransitionDefinition[] {
  return loadTransitions()
    .filter((t) => t.from === stateId)
    .sort((a, b) => a.priority - b.priority);
}
