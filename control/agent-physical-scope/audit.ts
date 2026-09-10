/**
 * Durable denial evidence. Never logs secrets.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { AGENT_SCOPE_STORE_ENV, type PhysicalMutationAudit } from "./types";

function storeDir(): string {
  const fromEnv = process.env[AGENT_SCOPE_STORE_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim();
  return join(process.cwd(), "control/agent-physical-scope/data");
}

export function auditFilePath(): string {
  return join(storeDir(), "denials.jsonl");
}

function redact(resource: string): string {
  return resource
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/github_pat_\w+/g, "[redacted]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted]");
}

export function recordDeniedMutation(entry: PhysicalMutationAudit): PhysicalMutationAudit {
  const safe: PhysicalMutationAudit = {
    ...entry,
    requested_resource: redact(entry.requested_resource),
  };
  const file = auditFilePath();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(safe)}\n`, { encoding: "utf8", mode: 0o600 });
  return safe;
}

export function auditExists(): boolean {
  return existsSync(auditFilePath());
}
