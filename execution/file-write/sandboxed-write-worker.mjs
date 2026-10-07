// หน้าที่: the ONE real filesystem-touching program `../../control/agent-host/`
// ever launches for a sandboxed write — the actual `fs.mkdirSync`/`fs.writeFileSync`
// call that a real macOS Seatbelt profile (`../../control/agent-host/host-runtime.ts`'s
// `buildSandboxProfile`) confines to exactly one `allowedWorkspaceDir`. Deliberately
// plain JavaScript, zero imports beyond Node's own `fs`/`path` — the sandbox profile
// only allows exec of this exact interpreter with this exact argv, so this file
// must be self-contained and cannot `require()` anything outside Node's core.
//
// Input (argv[2], one JSON string): { operation: "CREATE"|"MODIFY", resolvedPath: string, content: string }.
// Output (stdout, one JSON line): { ok: true, bytesWritten } | { ok: false, reason }.
// Never throws uncaught — every path prints exactly one JSON line and exits 0
// (a kernel EPERM/ENOENT from the sandbox surfaces as a caught error here,
// reported as { ok: false, reason: "FS_ERROR: <message>" }, not a crash) so
// ../sandboxed-executor.ts can always parse a real result from stdout.

import { mkdirSync, writeFileSync, statSync, existsSync } from "node:fs";
import { dirname } from "node:path";

function main() {
  let instruction;
  try {
    instruction = JSON.parse(process.argv[2]);
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, reason: `INVALID_INSTRUCTION: ${error.message}` }) + "\n");
    return;
  }

  const { operation, resolvedPath, content } = instruction;
  try {
    if (operation === "CREATE" && existsSync(resolvedPath)) {
      process.stdout.write(JSON.stringify({ ok: false, reason: "FS_ERROR" }) + "\n");
      return;
    }
    mkdirSync(dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, content, "utf-8");
    const bytesWritten = statSync(resolvedPath).size;
    process.stdout.write(JSON.stringify({ ok: true, bytesWritten }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, reason: `FS_ERROR: ${error && error.message ? error.message : String(error)}` }) + "\n");
  }
}

main();
