/**
 * หน้าที่: permanent regression coverage for the real SBPL path-injection
 * defect found and patched in `../host-runtime.ts#buildSandboxProfile`
 * (2026-08-24, Owner-escalated ahead of Phase 4 reconciliation) — closes
 * a gap flagged by peer session dna-os-infrastructure-74: the patch's
 * only prior verification was a one-off scratchpad repro that died with
 * that session, and no committed suite in `control/agent-host/tests/`
 * ever built a malicious profile through the REAL renderer. Every other
 * suite in this repo that exercises SBPL escaping goes through
 * `control/runtime-adapter/`'s `buildSeatbeltProfile` instead — a
 * DIFFERENT renderer for a DIFFERENT confinement contract — so none of
 * them can catch this file's own escaping regressing.
 *
 * Asserts KERNEL BEHAVIOUR, not profile text — a text-only assertion
 * (e.g. a naive `includes("allow network")` check) passes against the
 * VULNERABLE renderer too, once the payload's own quotes are counted:
 * the injected directive's literal text is a substring of the escaped,
 * safe output as well. Case A strips quoted string literals before
 * checking for a leaked `(allow network` directive, and case B/C launch
 * a real child under the generated profile and assert the OS's own
 * EPERM, matching the discipline `control/runtime-adapter/tests/adversarial-seatbelt.test.ts`
 * already uses for the sibling renderer.
 *
 * How to run: npx tsx control/agent-host/tests/sbpl-injection-regression.test.ts
 */
import { writeSandboxProfile } from "../host-runtime";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n      ${JSON.stringify(detail)}`); }
}

const NODE = process.execPath;
const ROOT = join(tmpdir(), `dna-os-agent-host-sbpl-regression-${Date.now()}`);
const WS = join(ROOT, "ws");
mkdirSync(WS, { recursive: true });

/** Strips quoted SBPL string literals before searching for a leaked top-level directive — a payload's own quoted text containing "(allow network" must not false-positive this check; only an UNQUOTED (i.e. actually-parsed-as-a-directive) occurrence should. */
function stripQuotedLiterals(sbpl: string): string {
  return sbpl.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function launchAndCheckEgressDenied(profilePath: string, executable: string): { exitCode: number | null; stdout: string } {
  let stdout = "";
  let exitCode: number | null = 0;
  try {
    stdout = execFileSync("/usr/bin/sandbox-exec", ["-f", profilePath, executable, "-e",
      "const net=require('net');const s=net.createConnection({host:'1.1.1.1',port:80,timeout:3000},()=>{console.log('CONNECTED');process.exit(0)});s.on('error',()=>{console.log('BLOCKED');process.exit(1)});s.on('timeout',()=>{console.log('TIMEOUT');process.exit(2)});",
    ], { encoding: "utf8", timeout: 8000 });
  } catch (e) {
    const err = e as { stdout?: string; status?: number | null };
    stdout = err.stdout ?? "";
    exitCode = err.status ?? null;
  }
  return { exitCode, stdout };
}

function main(): void {
  if (platform() !== "darwin") {
    console.log("SKIP: this suite requires macOS sandbox-exec; not reporting a pass it did not earn.");
    return;
  }

  // ===== A. allowedWorkspaceDir injection — the exact real exploit payload =====
  const attackWorkspaceDir = `${WS}/decoy")) (allow network*) (allow file-write* (subpath "/tmp/anything`;
  const profileA = join(ROOT, "a.sb");
  writeSandboxProfile(profileA, attackWorkspaceDir, NODE, []);
  const sbplA = readFileSync(profileA, "utf8");
  const strippedA = stripQuotedLiterals(sbplA);
  check("A1. allowedWorkspaceDir payload never leaks an unquoted (allow network directive into the profile text", !strippedA.includes("(allow network"), { sbplA });
  const runA = launchAndCheckEgressDenied(profileA, NODE);
  check("A2. KERNEL VERIFY: a real child launched under the attacked allowedWorkspaceDir profile still has egress denied", runA.stdout.includes("BLOCKED"), runA);

  // ===== B. outsideProbeDirs injection — the caller-influenced path (real on-disk sibling directory names) =====
  const attackProbeDir = `${WS}/sibling")) (allow network*) (allow file-read* (subpath "/tmp/anything`;
  const profileB = join(ROOT, "b.sb");
  writeSandboxProfile(profileB, WS, NODE, [attackProbeDir]);
  const sbplB = readFileSync(profileB, "utf8");
  const strippedB = stripQuotedLiterals(sbplB);
  check("B1. outsideProbeDirs payload never leaks an unquoted (allow network directive into the profile text", !strippedB.includes("(allow network"), { sbplB });
  const runB = launchAndCheckEgressDenied(profileB, NODE);
  check("B2. KERNEL VERIFY: a real child launched under the attacked outsideProbeDirs profile still has egress denied", runB.stdout.includes("BLOCKED"), runB);

  // ===== C. agentExecutable injection =====
  const profileC = join(ROOT, "c.sb");
  let threwC = false;
  try {
    writeSandboxProfile(profileC, WS, `${NODE}")) (allow network*) (allow process-exec (literal "/bin/sh`, []);
  } catch {
    threwC = true; // acceptable: resolveRealPath on a non-existent literal falling back, still must never render an unescaped payload
  }
  if (!threwC) {
    const sbplC = readFileSync(profileC, "utf8");
    check("C1. agentExecutable payload never leaks an unquoted (allow network or process-exec directive", !stripQuotedLiterals(sbplC).includes("(allow network") && (stripQuotedLiterals(sbplC).match(/\(allow process-exec/g) ?? []).length <= 1, { sbplC });
  } else {
    check("C1. agentExecutable payload rejected outright (fail-closed) rather than rendered unsafely", true);
  }

  // ===== D. normal-path regression — a real, non-malicious profile still confines correctly =====
  const normalWs = join(WS, "normal");
  mkdirSync(normalWs, { recursive: true });
  const profileD = join(ROOT, "d.sb");
  writeSandboxProfile(profileD, normalWs, NODE, [join(WS, "some-sibling")]);
  try {
    execFileSync("/usr/bin/sandbox-exec", ["-f", profileD, NODE, "-e", `require('fs').writeFileSync(${JSON.stringify(join(normalWs, "ok.txt"))}, 'hi')`], { encoding: "utf8", timeout: 8000 });
    check("D1. NORMAL PATH: a legitimate workspace write still succeeds under the patched renderer", true);
  } catch (e) {
    check("D1. NORMAL PATH: a legitimate workspace write still succeeds under the patched renderer", false, String(e));
  }
  const runD = launchAndCheckEgressDenied(profileD, NODE);
  check("D2. NORMAL PATH: network is still denied by default for an ordinary profile", runD.stdout.includes("BLOCKED"), runD);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

try {
  main();
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
