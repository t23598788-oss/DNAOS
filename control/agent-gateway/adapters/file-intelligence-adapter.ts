/**
 * หน้าที่: one concrete AgentAdapter — wraps the already-proven
 * DNA-LAB-FILE-INTELLIGENCE capability (same real CLI Phase 8/12/19
 * exercised) behind the generic AgentAdapter interface. This file is the
 * ONLY place that knows the real, external path to that repo — the
 * gateway core never does.
 *
 * 2026-08-24 (Owner, "Single Process Creation Gate — Consolidation"):
 * this file used to call `child_process.spawn` directly (a real,
 * unmediated process-creation path independent of any DNA OS gate). It
 * now routes every real exec through
 * `execution/run/contract.ts#requestProcessExecution` (the Process
 * Gate) — `executable_id: "file-intelligence.scan"`, resolved against
 * that gate's own registry (`execution/run/process-registry.ts`), which
 * verifies `allowed_callers` names this exact file, checks argv shape,
 * validates cwd, and executes via `control/agent-host/`'s real
 * sandbox-exec (reused, not a second executor). No raw
 * `child_process.spawn` remains here.
 */
import type { AgentAdapter, ExecutionRequest } from "../types";
import { requestProcessExecution } from "../../../execution/run/contract";

declare const require: (id: string) => unknown;

/**
 * PHASE 23 CLOSE-OUT: no hard-coded path. Resolved from
 * `../config.json`, written by `../bootstrap.mjs`'s real filesystem
 * probe (no Owner-specific string anywhere in this file). If bootstrap
 * was never run, or found nothing, this adapter fails closed with a
 * named reason — never a silent guess at a path.
 */
function resolveFileIntelRoot(): string | null {
  const fs = require("node:fs") as { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
  const path = require("node:path") as { join(...p: string[]): string };
  const nodeProcess = require("node:process") as { cwd(): string };
  // Same convention every other host-runtime.ts in this repo uses: this capability's
  // process always runs with the real repo checkout as process.cwd()'s ancestor.
  const configPath = path.join(nodeProcess.cwd(), "control/agent-gateway/config.json");
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as { file_intelligence_root: string | null };
    return config.file_intelligence_root;
  } catch {
    return null;
  }
}

function newRequestId(): string {
  const nodeCrypto = require("node:crypto") as { randomUUID(): string };
  return `pg-req-${nodeCrypto.randomUUID()}`;
}

async function runViaProcessGate(tsNodePath: string, cliPath: string, targetPath: string, cwd: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await requestProcessExecution({
    request_id: newRequestId(),
    parent_work_order_id: null,
    requester_identity: "control/agent-gateway/adapters/file-intelligence-adapter.ts",
    executable_id: "file-intelligence.scan",
    executable_path: tsNodePath,
    argv: [cliPath, targetPath],
    cwd,
  });
  if (result.status !== "EXECUTED") return { ok: false, error: `${result.status}: ${result.reason ?? "denied by Process Gate"}` };
  if (result.exit_code === 0) return { ok: true };
  return { ok: false, error: `exited with code ${result.exit_code}: ${result.stderr.slice(0, 500)}` };
}

export const fileIntelligenceAdapter: AgentAdapter = {
  adapter_id: "file-intelligence-adapter",
  describe() {
    return { adapter_id: "file-intelligence-adapter", capabilities: ["file_duplicate_or_orphan_detection"] };
  },
  async execute(request: ExecutionRequest) {
    const fileIntelRoot = resolveFileIntelRoot();
    if (!fileIntelRoot) {
      return { ok: false, output: null, error: "UNRESOLVED_EXTERNAL_TOOL — run control/agent-gateway/bootstrap.mjs first; no config.json / no resolvable DNA-LAB-FILE-INTELLIGENCE sibling directory found" };
    }
    const path = require("node:path") as { join(...p: string[]): string };
    const nodeProcess = require("node:process") as { cwd(): string };
    const targetPath = (request.input.target_path as string) ?? nodeProcess.cwd();
    const result = await runViaProcessGate(path.join(fileIntelRoot, "node_modules/.bin/ts-node"), path.join(fileIntelRoot, "src/cli.ts"), targetPath, fileIntelRoot);
    if (!result.ok) return { ok: false, output: null, error: result.error };
    try {
      const fs = require("node:fs") as { readFileSync(p: string, e: string): string };
      const summary = JSON.parse(fs.readFileSync(path.join(fileIntelRoot, "reports/latest-summary.json"), "utf-8"));
      return { ok: true, output: summary };
    } catch (err) {
      return { ok: false, output: null, error: `scan completed but summary unreadable: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
