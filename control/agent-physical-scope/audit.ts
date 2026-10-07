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
    .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/npm_[A-Za-z0-9]{10,}/g, "[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/github_pat_\w+/g, "[redacted]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/(api[_-]?key)\s*[:=]\s*['"]?[\w-]+/gi, "$1=[redacted]")
    .replace(/\btoken\s*=\s*\S+/gi, "token=[redacted]")
    .replace(/\bsecret\s*=\s*\S+/gi, "secret=[redacted]")
    .replace(/\bpassword\s*=\s*\S+/gi, "password=[redacted]");
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
