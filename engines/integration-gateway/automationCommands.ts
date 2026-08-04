/**
 * Integration Gateway — shared Automation command whitelist + exec (owner,
 * 2026-08-05). Single source of truth for both the direct-run Automation
 * tool (app/api/admin/workspace/automation/route.ts) and the Proposal
 * Channel's approve step (app/api/gateway/proposals/[id]/decide/route.ts) —
 * moved here so approval reuses the exact same command list and exec
 * logic instead of a second copy. Every command is copied verbatim from
 * package.json's own scripts; the command key is never concatenated into a
 * shell string.
 */
import { execSync } from "child_process";

export const AUTOMATION_COMMANDS: Record<string, string> = {
  "type-check": "npx tsc --noEmit",
  sync: "npx tsx scripts/sync-registry.ts && npx tsx scripts/build-arch-book.ts && npx tsx scripts/build-system-control-graph.ts",
  "deploy-gate": "npx tsx scripts/deploy-gate.ts",
  "architecture-check": "npx tsx scripts/check-system-control-graph.ts",
  guard: "bash scripts/governance.sh",
  "dead-code": "npx knip --no-progress",
  duplicates: "npx jscpd",
  test: "npx tsx local-runtime/dependency-discovery-acceptance-test.ts && npx tsx local-runtime/workspace-acceptance-test.ts && npx tsx local-runtime/architecture-drift-acceptance-test.ts && npx tsx local-runtime/runtime-registration-test.ts",
};

export const AUTOMATION_NOT_IMPLEMENTED: Record<string, string> = {
  build: "next build routinely exceeds serverless function time limits — trigger via git push to Vercel instead (scripts/deploy-gate.ts runs as the prebuild hook there)",
};

export interface AutomationRunResult {
  command: string;
  exit_code: number;
  output: string;
  duration_ms: number;
}

export function runAutomationCommand(key: string, root: string): AutomationRunResult {
  const startedAt = Date.now();
  try {
    const output = execSync(AUTOMATION_COMMANDS[key], { cwd: root, encoding: "utf8", timeout: 55_000, maxBuffer: 10 * 1024 * 1024 });
    return { command: key, exit_code: 0, output, duration_ms: Date.now() - startedAt };
  } catch (e: any) {
    return {
      command: key,
      exit_code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || e.message,
      duration_ms: Date.now() - startedAt,
    };
  }
}
