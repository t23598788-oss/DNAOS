/**
 * หน้าที่: Owner, 2026-08-19: "ห้าม claim ว่า External AI ถูกบังคับผ่าน
 * Gate แล้ว จนกว่าจะพิสูจน์ได้ว่า filesystem write path ของ coding agent
 * ถูกปิดหรือถูก intercept จริง...ถ้า Claude Code/Codex ยังสามารถเขียน
 * repository โดยตรงได้ ให้สถานะ enforcement เป็น: BYPASS_STILL_EXISTS".
 *
 * This test does NOT call ../executor.ts or ../../../permissions/write-gate/
 * at all — it proves the opposite: that a real Node process running inside
 * this checkout can write a real file using nothing but a bare `fs`
 * import, with ZERO WriteIntent, ZERO WriteGateDecision, and ZERO
 * involvement of execution/file-write/ whatsoever. If this test passes,
 * the bypass genuinely still exists today, and no report produced this
 * round may claim ENFORCED/PROTECTED.
 *
 * How to run: npx tsx execution/file-write/tests/bypass-detection.test.ts
 */

export {}; // makes this file a module, not a script — keeps its ambient declarations local, same fix needed by any test file with zero import statements

declare const require: (id: string) => unknown;
declare const process: { exitCode?: number; cwd(): string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

interface NodeFsModule {
  writeFileSync(path: string, content: string, encoding: string): void;
  readFileSync(path: string, encoding: string): string;
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  unlinkSync(path: string): void;
}
interface NodePathModule {
  join(...parts: string[]): string;
}

const fs = require("fs") as NodeFsModule;
const path = require("path") as NodePathModule;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function run(): void {
  console.log("=== execution/file-write/tests/bypass-detection.test.ts ===");
  console.log("This test intentionally bypasses control/ai-write-control/, permissions/write-gate/, and execution/file-write/executor.ts entirely.");

  const sandboxDir = path.join(process.cwd(), "execution/file-write/tests/__sandbox__");
  const target = path.join(sandboxDir, "bypass-detection-proof.txt");
  const content = `direct fs.writeFileSync, no WriteIntent, no WriteGateDecision, no executor — written at ${new Date().toISOString()}`;

  fs.mkdirSync(sandboxDir, { recursive: true });
  fs.writeFileSync(target, content, "utf-8");

  const exists = fs.existsSync(target);
  const onDisk = exists ? fs.readFileSync(target, "utf-8") : null;
  assert(exists && onDisk === content, "a real file was written directly to this repository with zero Gate involvement");

  fs.unlinkSync(target); // clean up the proof artifact — the finding itself is what matters, not the leftover file

  console.log("RESULT: BYPASS_STILL_EXISTS");
  console.log("Any process with Node/filesystem tool access inside this checkout (including the coding agent editing this very repo) can write files completely outside control/ai-write-control/ -> permissions/write-gate/ -> execution/file-write/.");
  console.log("No report produced by this implementation round may claim ENFORCED or PROTECTED for the External AI write path — only the in-repo call chain (WriteIntent -> Write Gate -> file-write executor) is real and gated; raw filesystem access by whatever agent is attached to this checkout is not intercepted by anything built this round.");
  console.log("=== bypass-detection.test.ts CASE PASSED (finding confirmed real) ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
