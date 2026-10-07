/**
 * Cursor-class confined execution: the existing control/agent-host launchAgent
 * path. Not a second sandbox.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchAgent } from "../agent-host/contract";
import { AGENT_EXECUTION_ID_ENV, AGENT_TASK_ID_ENV } from "./types";

export interface CursorClassProbeResult {
  readonly assigned_read?: string;
  readonly assigned_write?: boolean;
  readonly other_read_error?: string;
  readonly other_write?: boolean;
  readonly desktop_read_error?: string;
  readonly owner_state_read_error?: string;
  readonly abs_read_error?: string;
  readonly symlink_write?: boolean;
  readonly listen_5181_error?: string;
  readonly listen_8791_error?: string;
  readonly git_exec_blocked?: boolean;
  readonly github_token_present?: boolean;
  readonly kill_owner_error?: string;
}

export async function launchCursorClassKernelProbe(input: {
  readonly assigned: string;
  readonly other: string;
  readonly desktop: string;
  readonly ownerState: string;
  readonly absArbitrary: string;
  readonly symlinkTarget: string;
  readonly ownerPid: number;
  readonly taskId: string;
  readonly executionId: string;
}): Promise<{ readonly parsed: CursorClassProbeResult; readonly stdout: string; readonly stderr: string; readonly envPassed: Readonly<Record<string, string>> }> {
  const script = join(input.assigned, "cursor-class-probe.mjs");
  writeFileSync(script, `
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
const assigned = ${JSON.stringify(input.assigned)};
const other = ${JSON.stringify(input.other)};
const desktop = ${JSON.stringify(input.desktop)};
const ownerState = ${JSON.stringify(input.ownerState)};
const absArbitrary = ${JSON.stringify(input.absArbitrary)};
const symlinkTarget = ${JSON.stringify(input.symlinkTarget)};
const ownerPid = ${JSON.stringify(input.ownerPid)};
const results = {};
try { results.assigned_read = readFileSync(assigned + "/mine.txt", "utf8").trim(); } catch (e) { results.assigned_read_error = e.code || String(e); }
try { writeFileSync(assigned + "/wrote.txt", "ok"); results.assigned_write = true; } catch (e) { results.assigned_write = false; }
try { results.other_read = readFileSync(other + "/theirs.txt", "utf8"); } catch (e) { results.other_read_error = e.code || String(e); }
try { writeFileSync(other + "/pwn.txt", "pwn"); results.other_write = true; } catch (e) { results.other_write = false; }
try { results.desktop_read = readFileSync(desktop + "/owner.txt", "utf8"); } catch (e) { results.desktop_read_error = e.code || String(e); }
try { results.owner_state_read = readFileSync(ownerState + "/runtime.json", "utf8"); } catch (e) { results.owner_state_read_error = e.code || String(e); }
try { results.abs_read = readFileSync(absArbitrary, "utf8"); } catch (e) { results.abs_read_error = e.code || String(e); }
try { writeFileSync(symlinkTarget, "escape"); results.symlink_write = true; } catch (e) { results.symlink_write = false; }
function listen(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.on("error", (e) => resolve(e.code || e.message));
    try {
      server.listen(port, "127.0.0.1", () => {
        server.close();
        resolve(null);
      });
    } catch (e) {
      resolve(e.code || String(e));
    }
  });
}
results.listen_5181_error = await listen(5181);
results.listen_8791_error = await listen(8791);
results.github_token_present = Object.prototype.hasOwnProperty.call(process.env, "GITHUB_TOKEN");
try {
  process.kill(ownerPid, "SIGTERM");
  results.kill_owner_error = "SIGNAL_DELIVERED";
} catch (e) {
  results.kill_owner_error = e.code || String(e);
}
await new Promise((resolve) => {
  try {
    const child = spawn("/usr/bin/git", ["push", "https://github.com/example/foreign.git", "HEAD"], { stdio: "ignore" });
    child.on("error", (err) => { results.git_exec_blocked = true; results.git_exec_error = err.code || err.message; resolve(null); });
    child.on("exit", (code) => { results.git_exec_blocked = code !== 0; results.git_exit = code; resolve(null); });
  } catch (e) {
    results.git_exec_blocked = true;
    resolve(null);
  }
});
process.stdout.write(JSON.stringify(results));
`);

  const launched = await launchAgent(
    {
      allowedWorkspaceDir: input.assigned,
      agentExecutable: process.execPath,
      agentArgv: [script],
      timeoutMs: 12000,
      repositoryReadPaths: [input.assigned],
      task_id: input.taskId,
    },
    {
      PATH: "/usr/bin:/bin",
      TMPDIR: process.env.TMPDIR,
      [AGENT_EXECUTION_ID_ENV]: input.executionId,
      [AGENT_TASK_ID_ENV]: input.taskId,
      GITHUB_TOKEN: "must-not-leak",
    },
    [input.other, input.desktop, input.ownerState],
  );

  let parsed: CursorClassProbeResult = {};
  try {
    parsed = JSON.parse(launched.stdout) as CursorClassProbeResult;
  } catch {
    parsed = {};
  }
  return { parsed, stdout: launched.stdout, stderr: launched.stderr, envPassed: launched.envPassed };
}
