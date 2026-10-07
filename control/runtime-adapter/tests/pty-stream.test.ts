/**
 * หน้าที่: Phase 4 step 7 verification — proves `../pty.ts` gives a REAL
 * pseudo-terminal and REAL incremental streaming, both under real
 * sandbox-exec confinement. The two properties that distinguish this
 * from the existing buffered executors are asserted directly:
 *   - `wasTty` is true (the child sees a tty, not a pipe)
 *   - at least one chunk is observed strictly BEFORE the process exits
 *
 * How to run: npx tsx control/runtime-adapter/tests/pty-stream.test.ts
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import { runPtySession, ptyRequiredExecPaths, type ConfinementSpec } from "../contract";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const NODE = process.execPath;
const ROOT = join(tmpdir(), `dna-os-pty-${Date.now()}`);
mkdirSync(ROOT, { recursive: true });

function spec(): ConfinementSpec {
  return {
    allowWritePaths: [ROOT],
    denyWriteWithinAllowed: [],
    denyReadPaths: [],
    allowReadWithinDenied: [],
    // BOTH the helper interpreter and the target — a PTY session needs two.
    execAllowPaths: [...ptyRequiredExecPaths(), NODE],
    network: { mode: "DENY_ALL" },
  };
}

async function main(): Promise<void> {
  if (platform() !== "darwin") {
    console.log("SKIP — macOS-only capability");
    return;
  }

  await check("A. the child observes a REAL tty on stdout", async () => {
    const result = await runPtySession({
      executable: NODE,
      argv: ["-e", "console.log('ISTTY=' + Boolean(process.stdout.isTTY))"],
      cwd: ROOT,
      timeoutMs: 20_000,
      confinement: spec(),
      env: { PATH: "/usr/bin:/bin" },
    });
    assert(result.wasTty, "helper must report a pty was allocated");
    assert(
      result.output.includes("ISTTY=true"),
      `child must see a tty; got output: ${JSON.stringify(result.output)}`,
    );
    assert(result.exitCode === 0, `expected exit 0, got ${String(result.exitCode)}`);
  });

  await check("B. output STREAMS — a chunk arrives before the process exits", async () => {
    let firstChunkAt = 0;
    const result = await runPtySession(
      {
        executable: NODE,
        argv: [
          "-e",
          // Emit immediately, then stay alive well past that emission.
          "process.stdout.write('EARLY\\n'); setTimeout(() => console.log('LATE'), 2500);",
        ],
        cwd: ROOT,
        timeoutMs: 20_000,
        confinement: spec(),
        env: { PATH: "/usr/bin:/bin" },
      },
      (chunk) => {
        if (firstChunkAt === 0 && chunk.data.includes("EARLY")) firstChunkAt = Date.now();
      },
    );
    const completedAt = new Date(result.completedAt).getTime();
    assert(firstChunkAt > 0, "expected an EARLY chunk to be streamed");
    assert(
      completedAt - firstChunkAt > 1500,
      `chunk must arrive well before exit (buffered would be ~0ms); gap was ${completedAt - firstChunkAt}ms`,
    );
    assert(result.output.includes("LATE"), "final output must still contain everything");
  });

  await check("C. confinement still applies inside the PTY — egress refused", async () => {
    const result = await runPtySession({
      executable: NODE,
      argv: [
        "-e",
        `const net=require('node:net');const s=net.connect({host:'140.82.121.5',port:443});
         s.on('connect',()=>{console.log('NET:ALLOWED');process.exit(0)});
         s.on('error',e=>{console.log('NET:BLOCKED '+e.code);process.exit(0)});
         setTimeout(()=>{console.log('NET:TIMEOUT');process.exit(0)},5000);`,
      ],
      cwd: ROOT,
      timeoutMs: 20_000,
      confinement: spec(),
      env: { PATH: "/usr/bin:/bin" },
    });
    assert(
      result.output.includes("NET:BLOCKED"),
      `PTY session must not escape network confinement; got: ${JSON.stringify(result.output)}`,
    );
  });

  await check("D. a hung child is really killed by the timeout", async () => {
    const result = await runPtySession({
      executable: NODE,
      argv: ["-e", "setInterval(() => {}, 1000)"],
      cwd: ROOT,
      timeoutMs: 3_000,
      confinement: spec(),
      env: { PATH: "/usr/bin:/bin" },
    });
    assert(result.timedOut, "expected timedOut=true for a never-exiting child");
    assert(result.durationMs < 15_000, `expected a bounded run, took ${result.durationMs}ms`);
  });
}

main()
  .catch((error) => {
    failed++;
    console.error(`FAIL harness: ${error instanceof Error ? error.message : String(error)}`);
  })
  .finally(() => {
    rmSync(ROOT, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });
