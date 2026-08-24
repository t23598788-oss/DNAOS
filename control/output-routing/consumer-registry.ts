/**
 * หน้าที่: the ONE real list of who is registered to receive DNA OS
 * output — mirrors ../command-router/capability-registry.ts's own
 * discipline (REGISTERED means a real, checked relationship exists
 * TODAY, never assumed) and ../agent-gateway/workers.ts's own stated
 * failure mode: "two independent entry points... with two DIFFERENT
 * worker lists... is exactly the duplicate wiring, not one circuit,
 * failure." This file is that ONE list for OUTPUT — nothing else in this
 * repo may declare its own separate "where does this output go" mapping.
 *
 * WORK_ITEM consumers are never hand-listed here — they are derived
 * directly from ../agent-gateway/workers.ts's DEFAULT_AGENT_WORKERS,
 * the same single real Worker registration `submitTask` itself dispatches
 * to. Adding a Worker there registers it here automatically; nothing can
 * drift out of sync because there is only one list to edit.
 *
 * SYSTEM_STATE consumers are hand-listed, but ONLY entries whose
 * relationship is independently verifiable in this repo's own source —
 * each carries an `evidence_ref` naming exactly where. A capability_id
 * with no entry here has no registered consumer — resolveOutputConsumers()
 * (./output-router.ts) reports NO_REGISTERED_CONSUMER for it, never a
 * guessed destination.
 *
 * Input: none (module-level constant).
 * Output: `OUTPUT_CONSUMER_REGISTRY`.
 * Dependency ที่อนุญาต: ./types.ts, ../agent-gateway/contract.ts (DEFAULT_AGENT_WORKERS only).
 * สิ่งที่ห้ามแตะ: never add a SYSTEM_STATE entry without a real
 * `evidence_ref` pointing at the file/docstring that actually establishes
 * the relationship. Never hand-list a WORK_ITEM/WORKER_CAPABILITY entry —
 * derive it from DEFAULT_AGENT_WORKERS only.
 */

import { DEFAULT_AGENT_WORKERS } from "../agent-gateway/contract";
import type { OutputConsumerRegistration } from "./types";

const SYSTEM_STATE_CONSUMERS: readonly OutputConsumerRegistration[] = [
  {
    consumer_id: "dna-os-deadboard",
    consumer_type: "UI_SURFACE",
    output_lane: "SYSTEM_STATE",
    capability_id: "*",
    status: "REGISTERED",
    evidence_ref: "transport/owner-command-http/server.ts (header docstring): \"a local, loopback-only HTTP server so an external process (the Dead Board Next.js app, a separate repo/process) can drive the real OWNER -> owner-command -> command-router -> policy pipeline over the network\"",
    description: "The Dead Board Next.js app — DNA OS's own documented UI consumer of every SYSTEM_STATE output via POST /command's real HTTP response.",
  },
  {
    consumer_id: "connections/dna-os-mcp",
    consumer_type: "SUBSYSTEM",
    output_lane: "SYSTEM_STATE",
    capability_id: "*",
    status: "REGISTERED",
    evidence_ref: "connections/dna-os-mcp/tool-registry.ts's get_system_status/get_task/lookup_capability/get_resource tools — plain HTTP reads of DNA OS's real output, no AI mediation",
    description: "The DNA OS MCP server's own read-only tools — a registered external-agent-facing consumer of SYSTEM_STATE output.",
  },
];

/** Derived, never hand-listed — see this file's own header. */
const WORK_ITEM_CONSUMERS: readonly OutputConsumerRegistration[] = DEFAULT_AGENT_WORKERS.map((worker) => {
  const described = worker.describe();
  return {
    consumer_id: described.adapter_id,
    consumer_type: "WORKER_CAPABILITY",
    output_lane: "WORK_ITEM",
    capability_id: "dispatcher",
    status: "REGISTERED",
    evidence_ref: "control/agent-gateway/workers.ts's DEFAULT_AGENT_WORKERS — the one real Worker list submitTask/dispatchTask actually dispatches to",
    description: `Real registered AgentAdapter — handles: ${described.capabilities.join(", ") || "(no declared capabilities)"}`,
  };
});

export const OUTPUT_CONSUMER_REGISTRY: readonly OutputConsumerRegistration[] = [...SYSTEM_STATE_CONSUMERS, ...WORK_ITEM_CONSUMERS];

export function listOutputConsumers(): readonly OutputConsumerRegistration[] {
  return OUTPUT_CONSUMER_REGISTRY;
}
