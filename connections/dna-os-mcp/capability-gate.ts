/**
 * หน้าที่: the MCP Tool Resolver — every MCP tool call passes through here
 * before its handler ever runs. This is the ONLY new decision this
 * capability folder makes, and it is a narrow one: does the real,
 * existing `control/command-router/capability-registry.ts` say this
 * tool's underlying capability is REGISTERED + VERIFIED + AVAILABLE. No
 * new registry, decision engine, or dispatcher is created here — this
 * file only reads `getCapability()`/`listCapabilities()`, both already
 * exported from that real registry.
 *
 * REGISTERED  = an entry exists in CAPABILITY_REGISTRY for this id.
 * VERIFIED    = that entry's health_status === "CONNECTED" — per that
 *               registry's own docstring, CONNECTED means "a real,
 *               verified, callable contract/adapter file exists in this
 *               repo today", never assumed.
 * AVAILABLE   = that entry's endpoint.kind !== "not_yet_built" — there is
 *               an actually invocable module/entry, not just a reserved
 *               capability_id.
 *
 * A subset of MCP tools (submit_command, list_capabilities, lookup_capability, get_resource,
 * get_task, get_system_status) are core DNA OS ingress/lookup primitives,
 * not optional routed capabilities in that registry's sense — routing
 * capability resolution for submit_command happens INSIDE DNA OS's own
 * owner-command/command-router pipeline on every call (already proven —
 * see control/command-router/tests/router.test.ts's NOT_CONNECTED case),
 * so gating the MCP tool itself a second time here would just be a
 * decorative duplicate check, not a real one. Those tools carry
 * `dna_os_capability_id: null` and are reported NOT_GATED_CORE_PRIMITIVE
 * — never silently treated as REGISTERED_VERIFIED_AVAILABLE without
 * saying so.
 *
 * Input: `dna_os_capability_id: string | null`.
 * Output: `resolveCapabilityForTool` -> `CapabilityGateResult`.
 * Dependency ที่อนุญาต: ../../control/command-router/contract.ts (the
 * folder's own public boundary — never reach past it into
 * capability-registry.ts directly), ./types.ts.
 * สิ่งที่ห้ามแตะ: never write to CAPABILITY_REGISTRY from here — read-only.
 * Never invoke a tool handler before this function returns
 * REGISTERED_VERIFIED_AVAILABLE or NOT_GATED_CORE_PRIMITIVE.
 */

import { getCapability } from "../../control/command-router/contract";
import type { CapabilityGateResult } from "./types";

export function resolveCapabilityForTool(dna_os_capability_id: string | null): CapabilityGateResult {
  if (dna_os_capability_id === null) {
    return { status: "NOT_GATED_CORE_PRIMITIVE", capability_id: null, reason: "core DNA OS ingress/lookup primitive — not an optional routed capability" };
  }

  const entry = getCapability(dna_os_capability_id);
  if (!entry) {
    return { status: "CAPABILITY_NOT_AVAILABLE", capability_id: dna_os_capability_id, reason: "NOT_REGISTERED" };
  }
  if (entry.health_status !== "CONNECTED") {
    return { status: "CAPABILITY_NOT_AVAILABLE", capability_id: dna_os_capability_id, reason: "NOT_VERIFIED" };
  }
  if (entry.endpoint.kind === "not_yet_built") {
    return { status: "CAPABILITY_NOT_AVAILABLE", capability_id: dna_os_capability_id, reason: "NOT_AVAILABLE" };
  }
  return { status: "REGISTERED_VERIFIED_AVAILABLE", capability_id: dna_os_capability_id, reason: "REGISTERED_VERIFIED_AVAILABLE" };
}
