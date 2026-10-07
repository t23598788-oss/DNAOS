/**
 * หน้าที่: OS-LEVEL ENFORCEMENT PROOF. Every case spawns a REAL child
 * process under a REAL `sandbox-exec` profile derived from a REAL persisted
 * ResolvedWorkContext, and asserts on what the KERNEL did — never on what a
 * library returned.
 *
 * This is the test that separates "the library says no" from "the machine
 * says no". Each escape below deliberately bypasses every DNA OS library:
 * the child calls `fs.writeFileSync` directly, runs a shell redirect, and
 * writes through a symlink. If any of those succeed outside
 * `allowed_write_scope`, OS-level enforcement is not real.
 *
 * How to run (macOS, Node >=18):
 *   npx tsx control/work-resolution/tests/os-enforcement-proof.test.ts
 */

import { mkdirSync, rmSync, existsSync, writeFileSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveWriteIntent, persistResolution } from "../contract";
import { buildConfinementForWork, launchAgentForWork } from "../sandbox-bridge";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); if (detail !== undefined) console.error("      " + JSON.stringify(detail).slice(0, 300)); }
}

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NODE = process.execPath;
const SCRATCH = join(tmpdir(), `dna-os-osproof-${Date.now()}`);
const SCOPE_ABS = join(SCRATCH, "approved-scope");
const OUTSIDE_ABS = join(SCRATCH, "outside");

/** Runs a node one-liner inside the sandbox and returns its combined output. */
async function runInSandbox(workId: string, code: string, extraExec: readonly string[] = []): Promise<string> {
  const outcome = await launchAgentForWork(workId, NODE, ["-e", code], { timeoutMs: 30_000, extraExecPaths: extraExec });
  if (!outcome.launched) return `LAUNCH_REFUSED:${outcome.refusal_code}:${outcome.detail}`;
  return `${outcome.result?.stdout ?? ""}${outcome.result?.stderr ?? ""}`;
}

async function main(): Promise<void> {
  if (platform() !== "darwin") { console.log("SKIP — macOS-only (sandbox-exec)"); return; }

  mkdirSync(SCOPE_ABS, { recursive: true });
  mkdirSync(OUTSIDE_ABS, { recursive: true });

  // A resolution whose approved scope is a real, disposable directory.
  const store = createPersistentFileStore();
  const workId = `work-osproof-${Date.now()}`;
  const base = resolveWriteIntent(
    { requested_function: "gmail reader", requested_change: "the approved missing piece", target_domain: "connections/email-alert-source", owner_intent: "os enforcement proof", current_work_id: workId },
    store,
  );
  // Point the scope at the scratch dir so the proof never writes into the repo.
  const ctx = { ...base, allowed_write_scope: [SCOPE_ABS], forbidden_write_scope: base.forbidden_write_scope };
  persistResolution(ctx);

  const built = buildConfinementForWork(workId, NODE);
  check("0a. confinement derived from PERSISTED state, not from the caller", built.ok && built.confinement?.allowWritePaths[0] === SCOPE_ABS, built.detail);
  check("0b. network denied by default in the derived profile", built.confinement?.network.mode === "DENY_ALL");

  // ===== 1/6. APPROVED WRITE INSIDE SCOPE =====
  const approvedFile = join(SCOPE_ABS, "raw-fetch.ts");
  const okOut = await runInSandbox(workId, `require('fs').writeFileSync(${JSON.stringify(approvedFile)}, 'ok'); console.log('WROTE_OK')`);
  check("1. APPROVED_WRITE = ALLOWED (inside allowed_write_scope)", okOut.includes("WROTE_OK") && existsSync(approvedFile), okOut.slice(0, 200));

  // ===== 3. DIRECT NODE WRITE OUTSIDE SCOPE =====
  const outsideFile = join(OUTSIDE_ABS, "escape.txt");
  const nodeOut = await runInSandbox(workId, `try{require('fs').writeFileSync(${JSON.stringify(outsideFile)},'x');console.log('ESCAPED')}catch(e){console.log('DENIED:'+e.code)}`);
  check("2. DIRECT_NODE_WRITE_OUTSIDE_SCOPE = DENIED", nodeOut.includes("DENIED:EPERM") && !existsSync(outsideFile), nodeOut.slice(0, 200));

  // ===== 3b. DIRECT BASH WRITE OUTSIDE SCOPE =====
  // POSITIVE CONTROL FIRST. Without it this case passes for the wrong
  // reason: /bin/sh on macOS re-execs /bin/bash as a "variant", so an
  // exec allowlist naming only /bin/sh stops the shell from ever running
  // and NO write is attempted at all — which looks identical to a write
  // denial. Both shells are allowed here, and the in-scope write must
  // SUCCEED, proving the shell really runs and that the out-of-scope
  // denial below is a WRITE boundary, not an exec one.
  const SHELLS = ["/bin/sh", "/bin/bash"];
  const shellInside = join(SCOPE_ABS, "shell-wrote.txt");
  const shellOkOut = await runInSandbox(
    workId,
    `const{execFileSync}=require('child_process');try{execFileSync('/bin/sh',['-c','echo x > ${shellInside}']);console.log('SHELL_WROTE')}catch(e){console.log('SHELL_ERR:'+String(e.stderr||e.message).slice(0,80))}`,
    SHELLS,
  );
  check("3a. POSITIVE CONTROL — the shell really runs and writes INSIDE scope", existsSync(shellInside), { out: shellOkOut.slice(0, 160) });

  const bashTarget = join(OUTSIDE_ABS, "bash-escape.txt");
  const bashOut = await runInSandbox(
    workId,
    `const{execFileSync}=require('child_process');try{execFileSync('/bin/sh',['-c','echo x > ${bashTarget}']);console.log('ESCAPED')}catch(e){console.log('DENIED:'+String(e.stderr||e.message).slice(0,80))}`,
    SHELLS,
  );
  check("3b. DIRECT_BASH_WRITE_OUTSIDE_SCOPE = DENIED (shell ran, kernel refused the write)", !existsSync(bashTarget) && !bashOut.includes("ESCAPED"), { out: bashOut.slice(0, 160), exists: existsSync(bashTarget) });

  // ===== 4. SYMLINK ESCAPE =====
  // A symlink INSIDE the approved scope pointing OUTSIDE it. Writing
  // through it is the classic scope escape — and the exact mechanism that
  // destroyed this repo's package.json earlier today.
  const link = join(SCOPE_ABS, "escape-link");
  const linkTarget = join(OUTSIDE_ABS, "via-symlink.txt");
  try { symlinkSync(OUTSIDE_ABS, link); } catch { /* already exists */ }
  const symOut = await runInSandbox(workId, `try{require('fs').writeFileSync(${JSON.stringify(join(link, "via-symlink.txt"))},'x');console.log('ESCAPED')}catch(e){console.log('DENIED:'+e.code)}`);
  // POSITIVE CONTROL: a symlink pointing INSIDE the scope must still work,
  // so the denial above is about the TARGET being outside, not about
  // symlinks being broken in the sandbox generally.
  const goodLink = join(SCOPE_ABS, "inside-link");
  try { symlinkSync(SCOPE_ABS, goodLink); } catch { /* already exists */ }
  const viaGood = join(SCOPE_ABS, "via-good-link.txt");
  await runInSandbox(workId, `try{require('fs').writeFileSync(${JSON.stringify(join(goodLink, "via-good-link.txt"))},'x')}catch(e){}`);
  check("4a. POSITIVE CONTROL — a symlink resolving INSIDE scope still writes", existsSync(viaGood));
  check("4b. SYMLINK_ESCAPE = DENIED (resolves outside scope)", !existsSync(linkTarget), { out: symOut.slice(0, 160), exists: existsSync(linkTarget) });

  // ===== 5. DUPLICATE GMAIL READER AT THE OS BOUNDARY =====
  // The real existing reader lives in another repo entirely. A process
  // confined to the approved scope cannot create OR overwrite anything
  // there, regardless of what it calls.
  const gmailDir = join(REPO, "..", "dna-os-deadboard", "supabase", "functions", "_shared");
  const dupGmail = join(gmailDir, "my-second-gmail-client.ts");
  const dupOut = await runInSandbox(workId, `try{require('fs').writeFileSync(${JSON.stringify(dupGmail)},'dup');console.log('ESCAPED')}catch(e){console.log('DENIED:'+e.code)}`);
  check("5. duplicate Gmail reader creation = DENIED at the OS boundary", dupOut.includes("DENIED:EPERM") && !existsSync(dupGmail), { out: dupOut.slice(0, 160), exists: existsSync(dupGmail) });

  // ===== 6. SECOND MACHINE OBSERVER OUTSIDE APPROVED SCOPE =====
  const dupObserver = join(REPO, "control", "machine-observation", "second-observer.ts");
  const obsOut = await runInSandbox(workId, `try{require('fs').writeFileSync(${JSON.stringify(dupObserver)},'dup');console.log('ESCAPED')}catch(e){console.log('DENIED:'+e.code)}`);
  check("6. second machine-observer creation = DENIED at the OS boundary", obsOut.includes("DENIED:EPERM") && !existsSync(dupObserver), { out: obsOut.slice(0, 160), exists: existsSync(dupObserver) });

  // ===== 7. NO UNRESTRICTED LAUNCH PATH =====
  const noResolution = await launchAgentForWork(`work-does-not-exist-${Date.now()}`, NODE, ["-e", "console.log('ran')"]);
  check("7a. a work_id with no persisted resolution CANNOT launch", !noResolution.launched && noResolution.refusal_code === "NO_PERSISTED_RESOLUTION", noResolution.refusal_code);

  const emptyScopeId = `work-emptyscope-${Date.now()}`;
  persistResolution({ ...ctx, work_id: emptyScopeId, allowed_write_scope: [] });
  const emptyScope = await launchAgentForWork(emptyScopeId, NODE, ["-e", "console.log('ran')"]);
  check("7b. an empty write scope CANNOT launch (fails closed, not silently)", !emptyScope.launched && emptyScope.refusal_code === "EMPTY_WRITE_SCOPE", emptyScope.refusal_code);

  const notDispatchableId = `work-nodispatch-${Date.now()}`;
  persistResolution({ ...ctx, work_id: notDispatchableId, dispatchable: false, blocking_reason: "test: not dispatchable" });
  const nd = await launchAgentForWork(notDispatchableId, NODE, ["-e", "console.log('ran')"]);
  check("7c. a non-dispatchable resolution CANNOT launch", !nd.launched && nd.refusal_code === "NOT_DISPATCHABLE", nd.refusal_code);

  // ===== 8. STALE RESOLUTION CANNOT LAUNCH =====
  const staleId = `work-stale-${Date.now()}`;
  const staleFile = join(SCOPE_ABS, "tracked-source.ts");
  writeFileSync(staleFile, "export const v = 1;\n");
  persistResolution({ ...ctx, work_id: staleId, exact_source_paths: [staleFile] });
  writeFileSync(staleFile, "export const v = 2; // changed after resolution\n");
  const stale = await launchAgentForWork(staleId, NODE, ["-e", "console.log('ran')"]);
  check("8. a STALE resolution CANNOT launch (source changed since resolve)", !stale.launched && stale.refusal_code === "RESOLUTION_STALE", { code: stale.refusal_code, detail: stale.detail.slice(0, 120) });
}

main()
  .catch((error) => { failed++; console.error("FAIL  harness: " + (error instanceof Error ? error.stack ?? error.message : String(error))); })
  .finally(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });
