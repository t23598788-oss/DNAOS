/**
 * DNA OS Contractor — Freebuff PULL adapter (NEW-2, 2026-09-23).
 *
 * Mode: PULL ONLY. Freebuff is an interactive TUI agent (verified: its CLI
 * surface is `login | --continue | --cwd | --trust-agents`; no prompt/print/JSON
 * mode exists), and running it once created `.freebuff/project-id` in the working
 * tree. So DNA OS never launches Freebuff: it PUBLISHES a task offer the agent
 * picks up through the repo's `.agents/` + `mcp.json` discovery, and Freebuff
 * pulls the real task through the DNA OS MCP tools (contractor.task.claim).
 *
 * HARD RULE (proved by negative control in test/freebuffPullAdapter.test.ts):
 *   this module must never spawn a process. It does not import node:child_process,
 *   does not call spawn/exec/fork, and has no way to launch Freebuff — the only
 *   I/O it performs is reading and writing files inside the task-offer directory.
 *
 * ACTIVATION STATUS: PAUSED / INCOMPLETE (Owner 2026-09-23, TASK-082). Runtime
 * activation intentionally deferred until DNA OS Owner Settings / Credential
 * Authorization surface is available. Do not create alternate token/credential path —
 * the agent still needs an Owner-issued DNA_OS_API_TOKEN from that surface to claim work.
 *
 * Why a file offer at all, when the agent could call MCP directly? Because a pull
 * model needs a discoverable, human-inspectable pointer for a TUI agent that is
 * started by a person. Publishing the offer is DNA OS's side of the handshake;
 * the claim itself still goes through the MCP boundary and its authority checks.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Everything the offer carries — canonical fields only, no provider payloads. */
export interface TaskOffer {
  jobContractId: string;
  capabilityRequired: string;
  taskDescription: string;
  acceptanceCriteria: string[];
  permittedReadScope: string[];
  permittedWriteScope: string[];
  forbiddenTools: string[];
  /** Where the agent must claim the task from (the DNA OS MCP tool). */
  claimVia: "contractor.task.claim";
  submitVia: "contractor.evidence.submit";
  publishedAt: string;
}

export interface SubmittedResult {
  jobContractId: string;
  status: string;
  output: string | null;
  error: string | null;
  evidence: string[];
  submittedAt: string;
}

const OFFER_DIR = ".agents/tasks";
const RESULT_DIR = ".agents/results";

const offerPath = (root: string, jobContractId: string): string => join(root, OFFER_DIR, `${jobContractId}.json`);
const resultPath = (root: string, jobContractId: string): string => join(root, RESULT_DIR, `${jobContractId}.json`);

/** Make the offer discoverable by the agent (pure filesystem write, no process). */
export function publishTaskOffer(root: string, offer: Omit<TaskOffer, "claimVia" | "submitVia" | "publishedAt">): { ok: true; path: string } {
  mkdirSync(join(root, OFFER_DIR), { recursive: true });
  const full: TaskOffer = {
    ...offer,
    claimVia: "contractor.task.claim",
    submitVia: "contractor.evidence.submit",
    publishedAt: new Date().toISOString(),
  };
  const path = offerPath(root, offer.jobContractId);
  writeFileSync(path, JSON.stringify(full, null, 2) + "\n", "utf-8");
  return { ok: true, path };
}

export function readTaskOffer(root: string, jobContractId: string): TaskOffer | null {
  const path = offerPath(root, jobContractId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as TaskOffer;
}

export function listOpenOffers(root: string): string[] {
  const dir = join(root, OFFER_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}

export function withdrawTaskOffer(root: string, jobContractId: string): void {
  const path = offerPath(root, jobContractId);
  if (existsSync(path)) rmSync(path);
}

/**
 * Ingest one result the agent left behind. The result is DATA ONLY — this
 * adapter never evaluates it, never applies it and never executes anything
 * based on it; verification belongs to the MCP boundary
 * (contractor.evidence.submit → changeSetRuntime) and applying belongs to the
 * canonical authority.
 */
export function readSubmittedResult(root: string, jobContractId: string): SubmittedResult | null {
  const path = resultPath(root, jobContractId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as SubmittedResult;
}

/** The pull contract, in one place, for the agent (and for tests) to read. */
export const PULL_PROTOCOL = {
  discover: "mcp.json + .agents/tasks/<jobContractId>.json",
  claim: "contractor.task.claim (MCP)",
  submit: "contractor.evidence.submit (MCP)",
  launchedBy: "a human, in a terminal — never by this adapter",
} as const;
