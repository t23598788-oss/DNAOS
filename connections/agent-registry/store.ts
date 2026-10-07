/**
 * หน้าที่: durable agent registry — same flat-file JSONL append-only
 * convention as control/agent-gateway/memory-store.ts (append + read
 * latest-by-key, same as tasks.jsonl's "latest record per task_id"
 * pattern — never a second database engine). Duplicate prevention =
 * reading the LATEST record per agent_id, never appending a second
 * "current" row without history.
 *
 * Input: AgentRegistration.
 * Output: upsertAgent, listAgents, getAgent.
 * Dependency ที่อนุญาต: ./contract.ts (types only), node:fs, node:path.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRegistration } from "./contract";

const DATA_DIR_RELATIVE = "connections/agent-registry/data";

function dataDir(): string {
  return join(process.cwd(), DATA_DIR_RELATIVE);
}
function registryFile(): string {
  return join(dataDir(), "agents.jsonl");
}
function ensureFile(): void {
  mkdirSync(dataDir(), { recursive: true });
  if (!existsSync(registryFile())) writeFileSync(registryFile(), "", "utf-8");
}
function readAll(): AgentRegistration[] {
  ensureFile();
  return readFileSync(registryFile(), "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as AgentRegistration);
}

/** Appends a new record for this agent_id — reading is always "latest wins" (see listAgents/getAgent), so this is an upsert in effect, never a true duplicate "current" entry. */
export function upsertAgent(registration: AgentRegistration): void {
  ensureFile();
  appendFileSync(registryFile(), `${JSON.stringify(registration)}\n`, "utf-8");
}

/** Duplicate prevention: exactly one entry per agent_id, always the most recently appended — reads fresh from disk, survives a restart by construction. */
export function listAgents(): AgentRegistration[] {
  const all = readAll();
  const latestByAgentId = new Map<string, AgentRegistration>();
  for (const record of all) latestByAgentId.set(record.agent_id, record);
  return [...latestByAgentId.values()];
}

export function getAgent(agentId: string): AgentRegistration | null {
  return listAgents().find((a) => a.agent_id === agentId) ?? null;
}
