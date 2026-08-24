/** Durable, sanitized execution-audit sink used by the existing execution path. */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ExecutionAuditEvent, ExecutionAuditSink } from "../../execution/run/audit";

const DEFAULT_PATH = resolve(process.cwd(), "audit/command-audit/execution-audit.jsonl");

export function createFileAuditSink(filePath = DEFAULT_PATH): ExecutionAuditSink {
  const path = resolve(filePath);
  mkdirSync(dirname(path), { recursive: true });
  return {
    record(event) {
      try {
        appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
      } catch {
        // Audit failure must never crash an execution already completed.
      }
    },
    list() {
      if (!existsSync(path)) return [];
      try {
        return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
          try { return [JSON.parse(line) as ExecutionAuditEvent]; } catch { return []; }
        });
      } catch { return []; }
    },
  };
}
