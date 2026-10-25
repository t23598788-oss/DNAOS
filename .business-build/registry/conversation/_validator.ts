/**
 * DNA OS Conversation Registry — Validator
 * Validates any conversation registry object against the schema contracts
 */

import type { ValidationResult } from "./_schema";

export function validateConversationRegistry(name: string, data: unknown): ValidationResult {
  const errors: Array<{ field: string; message: string; code: string }> = [];
  const warnings: Array<{ field: string; message: string }> = [];

  if (data === null || typeof data !== "object") {
    errors.push({ field: "root", message: "Registry must be a non-null object", code: "INVALID_TYPE" });
    return { valid: false, name, errors, warnings };
  }

  const rec = data as Record<string, unknown>;

  if ("intents" in rec) {
    // Intent registry validation
    const intents = rec.intents as Record<string, unknown>;
    for (const [intentId, intent] of Object.entries(intents)) {
      if (!intent || typeof intent !== "object") {
        errors.push({ field: `intents.${intentId}`, message: "Intent must be an object", code: "INVALID_TYPE" });
        continue;
      }
      const i = intent as Record<string, unknown>;
      for (const required of ["id", "label", "examples_th", "required_entities", "status", "confidence_threshold"]) {
        if (!(required in i) || i[required] === undefined || i[required] === null) {
          errors.push({
            field: `intents.${intentId}.${required}`,
            message: `Required field "${required}" is missing`,
            code: "MISSING_REQUIRED_FIELD",
          });
        }
      }
      if (typeof i.confidence_threshold === "number") {
        if (i.confidence_threshold < 0 || i.confidence_threshold > 1) {
          errors.push({
            field: `intents.${intentId}.confidence_threshold`,
            message: "confidence_threshold must be between 0.0 and 1.0",
            code: "INVALID_VALUE",
          });
        }
      }
    }
  } else if ("states" in rec) {
    // State registry validation
    const states = rec.states as Record<string, unknown>;
    for (const [stateId, state] of Object.entries(states)) {
      if (!state || typeof state !== "object") {
        errors.push({ field: `states.${stateId}`, message: "State must be an object", code: "INVALID_TYPE" });
        continue;
      }
      const s = state as Record<string, unknown>;
      for (const required of ["id", "label", "description", "collecting", "terminal", "status"]) {
        if (!(required in s) || s[required] === undefined || s[required] === null) {
          errors.push({
            field: `states.${stateId}.${required}`,
            message: `Required field "${required}" is missing`,
            code: "MISSING_REQUIRED_FIELD",
          });
        }
      }
    }
  } else if ("entities" in rec) {
    // Entity registry validation
    const entities = rec.entities as Record<string, unknown>;
    for (const [entityId, entity] of Object.entries(entities)) {
      if (!entity || typeof entity !== "object") {
        errors.push({ field: `entities.${entityId}`, message: "Entity must be an object", code: "INVALID_TYPE" });
        continue;
      }
      const e = entity as Record<string, unknown>;
      for (const required of ["id", "label", "type", "required", "extraction_model", "status"]) {
        if (!(required in e) || e[required] === undefined || e[required] === null) {
          errors.push({
            field: `entities.${entityId}.${required}`,
            message: `Required field "${required}" is missing`,
            code: "MISSING_REQUIRED_FIELD",
          });
        }
      }
    }
  } else if ("transitions" in rec) {
    // Transition registry validation
    const transitions = rec.transitions;
    if (!Array.isArray(transitions)) {
      errors.push({ field: "transitions", message: "transitions must be an array", code: "INVALID_TYPE" });
    } else {
      for (const transition of transitions as unknown[]) {
        if (!transition || typeof transition !== "object") continue;
        const t = transition as Record<string, unknown>;
        for (const required of ["id", "from", "to", "trigger", "priority"]) {
          if (!(required in t) || t[required] === undefined || t[required] === null) {
            errors.push({
              field: `transitions[${t.id ?? "?"}].${required}`,
              message: `Required transition field "${required}" is missing`,
              code: "MISSING_REQUIRED_FIELD",
            });
          }
        }
      }
    }
  } else if ("memory_configs" in rec) {
    // Memory config validation — no strict required field check beyond existence
    warnings.push({ field: "root", message: "Memory config validation is informational only" });
  } else {
    warnings.push({ field: "root", message: "Could not detect conversation registry type" });
  }

  return { valid: errors.length === 0, name, errors, warnings };
}
