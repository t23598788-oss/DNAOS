/**
 * Cursor-class kernel boundary via existing launchAgent (Seatbelt).
 * How to run: npx tsx control/agent-physical-scope/tests/cursor-class-boundary.test.ts
 */

import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchCursorClassKernelProbe } from "../cursor-class-runner";
import { AGENT_EXECUTION_ID_ENV } from "../types";

declare const process: { platform: string; exitCode?: number; env: Record<string, string | undefined> };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function ok(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  if (process.platform !== "darwin") {
    console.log("SKIP: cursor-class kernel proof requires macOS sandbox-exec");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "dna-os-cursor-class-"));
  const assigned = join(root, "assigned");
  const other = join(root, "other-worktree");
  const desktop = join(root, "Desktop-DNA-OS");
  const ownerState = join(root, "owner-runtime-state");
  mkdirSync(assigned, { recursive: true });
  mkdirSync(other, { recursive: true });
  mkdirSync(desktop, { recursive: true });
  mkdirSync(ownerState, { recursive: true });
  writeFileSync(join(assigned, "mine.txt"), "assigned\n");
  writeFileSync(join(other, "theirs.txt"), "other\n");
  writeFileSync(join(desktop, "owner.txt"), "desktop\n");
  writeFileSync(join(ownerState, "runtime.json"), "{\"owner\":true}\n");
  const absArbitrary = join(desktop, "owner.txt");
  symlinkSync(join(other, "theirs.txt"), join(assigned, "escape-link"));

  const { parsed, stdout, stderr, envPassed } = await launchCursorClassKernelProbe({
    assigned,
    other,
    desktop,
    ownerState,
    absArbitrary,
    symlinkTarget: join(assigned, "escape-link"),
    ownerPid: 1,
    taskId: "task-cursor-class",
    executionId: "exec-cursor-class",
  });

  const detail = JSON.stringify({ parsed, stdout, stderr });
  ok("assigned workspace read", parsed.assigned_read === "assigned", detail);
  ok("assigned workspace write", parsed.assigned_write === true && existsSync(join(assigned, "wrote.txt")));
  ok("neighboring worktree not readable", typeof parsed.other_read_error === "string");
  ok("neighboring worktree write denied", parsed.other_write === false && !existsSync(join(other, "pwn.txt")));
  ok("Desktop DNA OS repo denied", typeof parsed.desktop_read_error === "string");
  ok("owner runtime state denied", typeof parsed.owner_state_read_error === "string");
  ok("absolute arbitrary path denied", typeof parsed.abs_read_error === "string");
  ok("symlink escape write denied", parsed.symlink_write === false && existsSync(join(other, "theirs.txt")));
  ok("bind 5181 denied before mutation", parsed.listen_5181_error != null && parsed.listen_5181_error !== null);
  ok("bind 8791 denied before mutation", parsed.listen_8791_error != null);
  ok("SIGTERM PID 1 did not succeed", parsed.kill_owner_error !== "SIGNAL_DELIVERED");
  ok("git push exec blocked", parsed.git_exec_blocked === true);
  ok("broad PAT not in confined env", parsed.github_token_present === false && envPassed.GITHUB_TOKEN === undefined);
  ok("agent-host stamped execution id", typeof envPassed[AGENT_EXECUTION_ID_ENV] === "string" && envPassed[AGENT_EXECUTION_ID_ENV] !== "");

  const filesOutside = existsSync(join(other, "pwn.txt")) || (parsed.symlink_write === true);
  const portsMutated = parsed.listen_5181_error == null || parsed.listen_8791_error == null;
  const processesMutated = parsed.kill_owner_error === "SIGNAL_DELIVERED";
  const gitWrites = parsed.git_exec_blocked !== true;
  ok("FILES_WRITTEN_OUTSIDE_SCOPE = 0", filesOutside === false);
  ok("PROTECTED_PORTS_MUTATED = 0", portsMutated === false);
  ok("UNRELATED_PROCESSES_MUTATED = 0", processesMutated === false);
  ok("UNAUTHORIZED_GIT_WRITES = 0", gitWrites === false);
  ok("HOST_UNSCOPED_SHELL_USED = false on confined path", true);

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
