/**
 * หน้าที่: model-visible projection of the EXISTING command-router
 * capability registry. This folder does not own capability truth — it
 * only reads `listCapabilities` / `getCapability` from
 * `control/command-router/contract.ts` (the same boundary
 * `./capability-gate.ts` already uses) and strips fields a model must
 * never see.
 *
 * Input: a registry id, or none for the full list.
 * Output: `ModelVisibleCapability` — id/name, description, input schema,
 * permission_requirement (risk/effect stand-in the registry actually
 * carries), health/availability. Never endpoint modules, contract paths,
 * Keychain refs, credentials, or tokens (those fields are not on the
 * registry row today; this projector still refuses to copy unknown keys).
 * Dependency ที่อนุญาต: ../../control/command-router/contract.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never write the registry; never invent a parallel catalog;
 * never pass through `endpoint` or `contract`.
 */

import { getCapability, listCapabilities } from "../../control/command-router/contract";
import type { CapabilityRegistration } from "../../control/command-router/contract";

export interface ModelVisibleCapability {
  id: string;
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: { commandText: { type: "string"; description: string } };
    additionalProperties: false;
  };
  permission_requirement: CapabilityRegistration["permission_requirement"];
  health_status: CapabilityRegistration["health_status"];
  available: boolean;
  supported_commands: readonly string[];
}

const SECRETISH = /secret|keychain|credential|token|password|private[_-]?key/i;

function projectOne(entry: CapabilityRegistration): ModelVisibleCapability {
  const commands = entry.supported_commands;
  const commandNote = commands.length > 0 ? commands.join(", ") : "(none registered)";
  return {
    id: entry.capability_id,
    name: entry.capability_id,
    description: `DNA OS capability ${entry.capability_id}. Supported commands: ${commandNote}.`,
    inputSchema: {
      type: "object",
      properties: {
        commandText: {
          type: "string",
          description: "Owner command text. DNA OS classifies and routes it; this projection never executes.",
        },
      },
      additionalProperties: false,
    },
    permission_requirement: entry.permission_requirement,
    health_status: entry.health_status,
    available: entry.health_status === "CONNECTED" && entry.endpoint.kind !== "not_yet_built",
    supported_commands: commands,
  };
}

function assertSanitized(projected: ModelVisibleCapability): void {
  const blob = JSON.stringify(projected);
  if (SECRETISH.test(blob)) {
    throw new Error(`capability projection leaked a secret-bearing field for ${projected.id}`);
  }
}

export function projectCapability(capabilityId: string): ModelVisibleCapability | null {
  const entry = getCapability(capabilityId);
  if (!entry) return null;
  const projected = projectOne(entry);
  assertSanitized(projected);
  return projected;
}

export function projectCapabilityList(): readonly ModelVisibleCapability[] {
  return listCapabilities().map((entry) => {
    const projected = projectOne(entry);
    assertSanitized(projected);
    return projected;
  });
}
