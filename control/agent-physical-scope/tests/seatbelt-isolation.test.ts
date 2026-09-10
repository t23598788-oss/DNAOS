/**
 * Kernel isolation proof via existing control/agent-host launchAgent.
 * How to run: npx tsx control/agent-physical-scope/tests/seatbelt-isolation.test.ts
 */

import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchAgent } from "../../agent-host/contract";

declare const process: { platform: string; execPath: string; exitCode?: number };
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
    console.log("SKIP: seatbelt isolation requires macOS sandbox-exec");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "dna-os-seatbelt-scope-"));
  const assigned = join(root, "assigned");
  const other = join(root, "other-worktree");
  const desktop = join(root, "Desktop-DNA-OS");
  mkdirSync(assigned, { recursive: true });
  mkdirSync(other, { recursive: true });
  mkdirSync(desktop, { recursive: true });
  writeFileSync(join(assigned, "mine.txt"), "assigned\n");
  writeFileSync(join(other, "theirs.txt"), "other\n");
  writeFileSync(join(desktop, "owner.txt"), "desktop\n");
  const probeAssigned = join(assigned, "wrote.txt");
  const probeOther = join(other, "pwn.txt");
  const script = join(assigned, "probe.mjs");
  writeFileSync(script, `
import { writeFileSync, readFileSync } from "node:fs";
const results = {};
try { results.assigned_read = readFileSync(${JSON.stringify(join(assigned, "mine.txt"))}, "utf8").trim(); } catch (e) { results.assigned_read_error = e.code || String(e); }
try { writeFileSync(${JSON.stringify(probeAssigned)}, "ok"); results.assigned_write = true; } catch (e) { results.assigned_write = false; results.assigned_write_error = e.code || String(e); }
try { results.other_read = readFileSync(${JSON.stringify(join(other, "theirs.txt"))}, "utf8"); } catch (e) { results.other_read_error = e.code || String(e); }
try { writeFileSync(${JSON.stringify(probeOther)}, "pwn"); results.other_write = true; } catch (e) { results.other_write = false; results.other_write_error = e.code || String(e); }
try { results.desktop_read = readFileSync(${JSON.stringify(join(desktop, "owner.txt"))}, "utf8"); } catch (e) { results.desktop_read_error = e.code || String(e); }
process.stdout.write(JSON.stringify(results));
`);

  const result = await launchAgent(
    {
      allowedWorkspaceDir: assigned,
      agentExecutable: process.execPath,
      agentArgv: [script],
      timeoutMs: 8000,
      repositoryReadPaths: [assigned],
    },
    { PATH: "/usr/bin:/bin", TMPDIR: tmpdir() },
    [other, desktop],
  );

  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(result.stdout) as Record<string, unknown>; } catch { parsed = { raw: result.stdout, stderr: result.stderr }; }

  ok("assigned repo visible", parsed.assigned_read === "assigned", JSON.stringify(parsed));
  ok("assigned write succeeded", parsed.assigned_write === true && existsSync(probeAssigned));
  ok("other worktree read denied at kernel", parsed.other_read === undefined && typeof parsed.other_read_error === "string");
  ok("other worktree write denied at kernel", parsed.other_write === false && !existsSync(probeOther));
  ok("absolute Desktop DNA OS path denied", parsed.desktop_read === undefined && typeof parsed.desktop_read_error === "string");

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
