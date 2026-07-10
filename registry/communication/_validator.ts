/**
 * DNA OS Communication Registry — Validator
 * Validates any registry object against the CommunicationRegistry contract
 */

import type { ValidationResult, ValidationError, ValidationWarning, CommunicationRegistry } from "./_schema";

const REQUIRED_FIELDS: (keyof CommunicationRegistry)[] = [
  "version",
  "schema_version",
  "channel_type",
  "authority",
  "health",
  "depends_on",
  "lifecycle",
  "policy",
  "security",
  "capabilities",
  "topology",
  "monitoring",
  "metadata",
];

const REQUIRED_POLICY_KEYS: (keyof import("./_schema").RuntimePolicy)[] = [
  "allow_ai_reply",
  "allow_auto_reply",
  "allow_broadcast",
  "allow_push",
  "allow_schedule",
  "allow_document",
  "allow_payment",
];

const VALID_HEALTH = ["READY", "CONFIGURING", "DISABLED", "DEPRECATED", "BROKEN", "UNKNOWN"];
const VALID_LIFECYCLE = ["ACTIVE", "DISABLED", "NOT_CONFIGURED", "UNKNOWN"];

const KNOWN_CAPABILITIES = [
  "receive_message",
  "send_message",
  "reply",
  "broadcast",
  "attachment",
  "location",
  "rich_menu",
  "webhook",
  "voice_call",
  "video_call",
  "payment",
  "notification",
];

export function validateRegistry(channel: string, registry: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (registry === null || typeof registry !== "object") {
    errors.push({ field: "root", message: "Registry must be a non-null object", code: "INVALID_TYPE" });
    return { valid: false, channel, errors, warnings };
  }

  const reg = registry as Record<string, unknown>;

  // Check required top-level fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in reg) || reg[field] === undefined || reg[field] === null) {
      errors.push({
        field,
        message: `Required field "${field}" is missing or null`,
        code: "MISSING_REQUIRED_FIELD",
      });
    }
  }

  // Validate health.status
  if (reg.health && typeof reg.health === "object") {
    const health = reg.health as Record<string, unknown>;
    if (!VALID_HEALTH.includes(health.status as string)) {
      errors.push({
        field: "health.status",
        message: `Invalid health status "${health.status}". Must be one of: ${VALID_HEALTH.join(", ")}`,
        code: "INVALID_HEALTH_STATUS",
      });
    }
  }

  // Validate policy fields — each must be boolean
  if (reg.policy && typeof reg.policy === "object") {
    const policy = reg.policy as Record<string, unknown>;
    for (const key of REQUIRED_POLICY_KEYS) {
      if (!(key in policy)) {
        errors.push({
          field: `policy.${key}`,
          message: `Required policy field "${key}" is missing`,
          code: "MISSING_POLICY_FIELD",
        });
      } else if (typeof policy[key] !== "boolean") {
        errors.push({
          field: `policy.${key}`,
          message: `Policy field "${key}" must be boolean, got ${typeof policy[key]}`,
          code: "INVALID_POLICY_TYPE",
        });
      }
    }
  }

  // Validate lifecycle values (warn on unknown, skip keys starting with _)
  if (reg.lifecycle && typeof reg.lifecycle === "object") {
    const lifecycle = reg.lifecycle as Record<string, unknown>;
    for (const [key, value] of Object.entries(lifecycle)) {
      if (key.startsWith("_")) continue;
      if (!VALID_LIFECYCLE.includes(value as string)) {
        warnings.push({
          field: `lifecycle.${key}`,
          message: `Unknown lifecycle value "${value}" for key "${key}". Expected one of: ${VALID_LIFECYCLE.join(", ")}`,
        });
      }
    }
  }

  // Validate capabilities — warn on unknown keys
  if (reg.capabilities && typeof reg.capabilities === "object") {
    const capabilities = reg.capabilities as Record<string, unknown>;
    for (const key of Object.keys(capabilities)) {
      if (!KNOWN_CAPABILITIES.includes(key)) {
        warnings.push({
          field: `capabilities.${key}`,
          message: `Unknown capability "${key}". Not in known capabilities list`,
        });
      }
    }
  }

  // Validate topology.flow nodes exist in topology.nodes
  // Skip if channel lifecycle = NOT_CONFIGURED or health = DISABLED/UNKNOWN
  const healthStatus = (reg.health as Record<string, unknown> | undefined)?.status as string | undefined;
  const lifecycleChannel = (reg.lifecycle as Record<string, unknown> | undefined)?.channel as string | undefined;

  const skipTopologyCheck =
    lifecycleChannel === "NOT_CONFIGURED" ||
    healthStatus === "DISABLED" ||
    healthStatus === "UNKNOWN";

  if (!skipTopologyCheck && reg.topology && typeof reg.topology === "object") {
    const topology = reg.topology as Record<string, unknown>;
    const flow = Array.isArray(topology.flow) ? (topology.flow as string[]) : [];
    const nodes =
      topology.nodes && typeof topology.nodes === "object"
        ? (topology.nodes as Record<string, unknown>)
        : {};

    for (const nodeId of flow) {
      if (!(nodeId in nodes)) {
        errors.push({
          field: `topology.flow`,
          message: `Flow references node "${nodeId}" which does not exist in topology.nodes`,
          code: "MISSING_TOPOLOGY_NODE",
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    channel,
    errors,
    warnings,
  };
}
