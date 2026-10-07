/**
 * หน้าที่: Phase 4 step 6 — ADVERSARIAL VERIFY. Every case here runs a
 * real child process under a real `/usr/bin/sandbox-exec` profile
 * produced by `../seatbelt.ts` and asserts on what the KERNEL actually
 * did, never on what the profile text looks like. A test that only
 * inspected the emitted SBPL would have passed against the vulnerable
 * renderer too — case E is the proof of that.
 *
 * How to run: npx tsx control/runtime-adapter/tests/adversarial-seatbelt.test.ts
 *
 * Requires macOS. Skips with a clear message elsewhere rather than
 * reporting a pass it did not earn.
 */

import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir, tmpdir, platform } from "node:os";
import { buildSeatbeltProfile, ConfinementSpecError, type ConfinementSpec } from "../contract";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function check(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const NODE = process.execPath;
const ROOT = join(tmpdir(), `dna-os-runtime-adapter-${Date.now()}`);
const WS = join(ROOT, "ws");
mkdirSync(WS, { recursive: true });

function baseSpec(overrides: Partial<ConfinementSpec> = {}): ConfinementSpec {
  return {
    allowWritePaths: [WS],
    denyWriteWithinAllowed: [],
    denyReadPaths: [],
    allowReadWithinDenied: [],
    execAllowPaths: [NODE],
    network: { mode: "DENY_ALL" },
    ...overrides,
  };
}

/** Runs `script` under `sbpl`, returns combined output (never throws on non-zero exit). */
function runUnder(sbpl: string, script: string, label: string): string {
  const profilePath = join(ROOT, `${label}.sb`);
  const scriptPath = join(ROOT, `${label}.mjs`);
  writeFileSync(profilePath, sbpl, "utf-8");
  writeFileSync(scriptPath, script, "utf-8");
  try {
    return execFileSync("/usr/bin/sandbox-exec", ["-f", profilePath, NODE, scriptPath], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
  }
}

/**
 * Removes every `"..."` string literal (honouring `\"`) so an assertion
 * can look at the DIRECTIVES a profile contains rather than at text that
 * merely appears inside a quoted path.
 */
function stripQuoted(sbpl: string): string {
  return sbpl.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

const TCP_PROBE = `
import net from "node:net";
const s = net.connect({ host: "140.82.121.5", port: 443 });
const done = (m) => { console.log("NET:" + m); process.exit(0); };
s.on("connect", () => done("ALLOWED"));
s.on("error", (e) => done("BLOCKED " + e.code));
setTimeout(() => done("TIMEOUT"), 6000);
`;

function main(): void {
  if (platform() !== "darwin") {
    console.log("SKIP — macOS-only capability; these assertions require /usr/bin/sandbox-exec");
    return;
  }

  check("A. DENY_ALL — TCP egress is refused by the kernel", () => {
    const { sbpl } = buildSeatbeltProfile(baseSpec());
    assert(!sbpl.includes("(allow network"), "DENY_ALL must not emit any network allow");
    const out = runUnder(sbpl, TCP_PROBE, "a-net");
    assert(out.includes("NET:BLOCKED"), `expected kernel-blocked egress, got: ${out.trim()}`);
  });

  check("B. write outside allowWritePaths is refused", () => {
    const { sbpl } = buildSeatbeltProfile(baseSpec());
    const target = join(ROOT, "outside.txt");
    const out = runUnder(
      sbpl,
      `import fs from "node:fs";
       try { fs.writeFileSync(${JSON.stringify(target)}, "x"); console.log("W:ALLOWED"); }
       catch (e) { console.log("W:BLOCKED " + e.code); }`,
      "b-write",
    );
    assert(out.includes("W:BLOCKED"), `expected blocked write, got: ${out.trim()}`);
    assert(!existsSync(target), "file outside the workspace must not exist");
  });

  check("B2. write INSIDE allowWritePaths still works (confinement is not a brick)", () => {
    const { sbpl } = buildSeatbeltProfile(baseSpec());
    const target = join(WS, "inside.txt");
    const out = runUnder(
      sbpl,
      `import fs from "node:fs";
       try { fs.writeFileSync(${JSON.stringify(target)}, "x"); console.log("W:ALLOWED"); }
       catch (e) { console.log("W:BLOCKED " + e.code); }`,
      "b2-write",
    );
    assert(out.includes("W:ALLOWED"), `expected allowed write inside workspace, got: ${out.trim()}`);
  });

  check("C. exec of a binary outside execAllowPaths is refused", () => {
    const { sbpl } = buildSeatbeltProfile(baseSpec());
    const out = runUnder(
      sbpl,
      `import { execFileSync } from "node:child_process";
       try { execFileSync("/bin/sh", ["-c", "echo hi"]); console.log("X:ALLOWED"); }
       catch (e) { console.log("X:BLOCKED " + (e.code || e.message)); }`,
      "c-exec",
    );
    assert(out.includes("X:BLOCKED"), `expected blocked exec, got: ${out.trim()}`);
  });

  check("D. mandatory read denies bite even with no caller denies", () => {
    const { sbpl } = buildSeatbeltProfile(baseSpec());
    const out = runUnder(
      sbpl,
      `import fs from "node:fs";
       try { fs.readdirSync(${JSON.stringify(join(homedir(), "Library/Keychains"))}); console.log("R:ALLOWED"); }
       catch (e) { console.log("R:BLOCKED " + e.code); }`,
      "d-read",
    );
    assert(out.includes("R:BLOCKED"), `expected blocked keychain read, got: ${out.trim()}`);
  });

  check("E1. THE DEFECT — raw interpolation (agent-host's current renderer) IS exploitable", () => {
    // Reproduces control/agent-host/host-runtime.ts's buildSandboxProfile
    // interpolation style exactly: `"${path}"`, no escaping.
    const injected = `${WS}")) (allow network*) (allow file-write* (subpath "/tmp/decoy`;
    const vulnerable =
      [
        "(version 1)",
        "(deny default)",
        "(allow mach-lookup)",
        "(allow sysctl-read)",
        "(allow signal)",
        "(allow ipc-posix-shm)",
        "(allow file-read-metadata)",
        "(allow file-read*)",
        `(allow file-write* (subpath "${injected}"))`,
        `(allow process-exec (literal "${NODE}"))`,
        "(allow process-fork)",
      ].join("\n") + "\n";
    const out = runUnder(vulnerable, TCP_PROBE, "e1-inject");
    // This asserts the vulnerability is REAL. If this ever starts
    // failing, the defect was fixed upstream in agent-host and this
    // case should be re-examined, not deleted.
    assert(
      out.includes("NET:ALLOWED"),
      `expected the vulnerable renderer to grant network it never intended, got: ${out.trim()}`,
    );
  });

  check("E2. THE FIX — the same payload through buildSeatbeltProfile grants nothing", () => {
    const injected = `${WS}")) (allow network*) (allow file-write* (subpath "/tmp/decoy`;
    const { sbpl } = buildSeatbeltProfile(baseSpec({ allowWritePaths: [injected] }));
    // The payload must survive ONLY as an inert quoted literal. A raw
    // substring check would match the payload text inside its own quotes,
    // so strip quoted segments first and assert on what is left — that is
    // the part Seatbelt actually reads as directives.
    assert(
      !stripQuoted(sbpl).includes("(allow network"),
      `escaped profile must not contain an injected network directive outside a string:\n${stripQuoted(sbpl)}`,
    );
    const out = runUnder(sbpl, TCP_PROBE, "e2-fixed");
    assert(
      out.includes("NET:BLOCKED"),
      `expected egress still blocked after escaping, got: ${out.trim()}`,
    );
  });

  check("E3. escaping is real, not rejection-by-accident — a quoted path still confines", () => {
    // Proves the escape produces a VALID profile the kernel enforces,
    // rather than a malformed one that happens to fail closed.
    const quoted = join(ROOT, 'we"ird');
    mkdirSync(quoted, { recursive: true });
    const { sbpl } = buildSeatbeltProfile(baseSpec({ allowWritePaths: [quoted] }));
    const inside = join(quoted, "ok.txt");
    const outside = join(ROOT, "nope.txt");
    const out = runUnder(
      sbpl,
      `import fs from "node:fs";
       try { fs.writeFileSync(${JSON.stringify(inside)}, "x"); console.log("IN:ALLOWED"); }
       catch (e) { console.log("IN:BLOCKED " + e.code); }
       try { fs.writeFileSync(${JSON.stringify(outside)}, "x"); console.log("OUT:ALLOWED"); }
       catch (e) { console.log("OUT:BLOCKED " + e.code); }`,
      "e3-quoted",
    );
    assert(out.includes("IN:ALLOWED"), `quoted path must remain writable (profile must be valid), got: ${out.trim()}`);
    assert(out.includes("OUT:BLOCKED"), `confinement must still hold outside it, got: ${out.trim()}`);
  });

  check("E4. control characters are rejected outright, never rendered", () => {
    let threw: unknown = null;
    try {
      buildSeatbeltProfile(baseSpec({ allowWritePaths: [`${WS}\n(allow network*)`] }));
    } catch (error) {
      threw = error;
    }
    assert(threw instanceof ConfinementSpecError, "expected a ConfinementSpecError");
    assert(
      (threw as ConfinementSpecError).code === "PATH_UNSAFE_CHARACTER",
      `expected PATH_UNSAFE_CHARACTER, got ${(threw as ConfinementSpecError).code}`,
    );
  });

  check("F. mandatory write deny protects a NESTED repo's .git/config (Phase 4.1 fix — was the known gap)", () => {
    const repo = join(WS, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    const { sbpl } = buildSeatbeltProfile(baseSpec({ allowWritePaths: [WS] }));
    const out = runUnder(
      sbpl,
      `import fs from "node:fs";
       try { fs.writeFileSync(${JSON.stringify(join(repo, ".git/config"))}, "[core]"); console.log("G:ALLOWED"); }
       catch (e) { console.log("G:BLOCKED " + e.code); }`,
      "f-git",
    );
    // Phase 4.1 (Owner-disclosed gap, now fixed): the mandatory deny is a
    // REGEX matching ".git/config" at any depth, not a per-root literal
    // join — a nested repo created during the candidate's own run is now
    // covered, not just one already on disk at profile-build time.
    assert(out.includes("G:BLOCKED"), `nested repo .git/config must now be write-denied, got: ${out.trim()}`);
  });

  check("F3. mandatory write deny protects a NESTED repo's .git/hooks (Phase 4.1 fix)", () => {
    const repo = join(WS, "vendor", "some-dep");
    mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
    const { sbpl } = buildSeatbeltProfile(baseSpec({ allowWritePaths: [WS] }));
    const out = runUnder(
      sbpl,
      `import fs from "node:fs";
       try { fs.writeFileSync(${JSON.stringify(join(repo, ".git/hooks/post-checkout"))}, "#!/bin/sh\\necho pwned"); console.log("G:ALLOWED"); }
       catch (e) { console.log("G:BLOCKED " + e.code); }`,
      "f3-git-hooks",
    );
    assert(out.includes("G:BLOCKED"), `nested repo .git/hooks/* must be write-denied, got: ${out.trim()}`);
  });

  check("F2. mandatory write deny DOES protect .git/config at the workspace root", () => {
    mkdirSync(join(WS, ".git"), { recursive: true });
    const { sbpl } = buildSeatbeltProfile(baseSpec({ allowWritePaths: [WS] }));
    const out = runUnder(
      sbpl,
      `import fs from "node:fs";
       try { fs.writeFileSync(${JSON.stringify(join(WS, ".git/config"))}, "[core]"); console.log("G:ALLOWED"); }
       catch (e) { console.log("G:BLOCKED " + e.code); }`,
      "f2-git",
    );
    assert(out.includes("G:BLOCKED"), `expected root .git/config to be write-denied, got: ${out.trim()}`);
  });

  check("G. a caller cannot carve the keychain back open via allowReadWithinDenied", () => {
    const keychains = join(homedir(), "Library/Keychains");
    const { sbpl } = buildSeatbeltProfile(baseSpec({ allowReadWithinDenied: [keychains] }));
    const out = runUnder(
      sbpl,
      `import fs from "node:fs";
       try { fs.readdirSync(${JSON.stringify(keychains)}); console.log("R:ALLOWED"); }
       catch (e) { console.log("R:BLOCKED " + e.code); }`,
      "g-carve",
    );
    assert(out.includes("R:BLOCKED"), `mandatory denies must win over caller carve-outs, got: ${out.trim()}`);
  });

  check("H. an empty exec allowlist is refused rather than rendered", () => {
    let threw: unknown = null;
    try {
      buildSeatbeltProfile(baseSpec({ execAllowPaths: [] }));
    } catch (error) {
      threw = error;
    }
    assert(threw instanceof ConfinementSpecError, "expected a ConfinementSpecError");
    assert((threw as ConfinementSpecError).code === "EMPTY_EXEC_ALLOWLIST", "expected EMPTY_EXEC_ALLOWLIST");
  });

  check("I. relative paths are refused", () => {
    let threw: unknown = null;
    try {
      buildSeatbeltProfile(baseSpec({ allowWritePaths: ["relative/dir"] }));
    } catch (error) {
      threw = error;
    }
    assert(threw instanceof ConfinementSpecError, "expected a ConfinementSpecError");
    assert((threw as ConfinementSpecError).code === "PATH_NOT_ABSOLUTE", "expected PATH_NOT_ABSOLUTE");
  });
}

/**
 * Phase 4.1 addition: LOOPBACK_PORTS was shipped in seatbelt.ts with NO
 * kernel test anywhere (a real gap disclosed during Phase 4.1 discovery)
 * — it is asynchronous (needs a real listening socket), which this
 * file's synchronous `check()` harness cannot express, hence a separate
 * async runner below rather than a silent gap.
 */
async function checkAsync(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function mainAsync(): Promise<void> {
  const net = await import("node:net");
  await checkAsync("J. LOOPBACK_PORTS: an allowed port connects, a non-allowlisted port and a remote host are both denied", () => new Promise((resolve, reject) => {
    const allowedServer = net.createServer((sock) => sock.end("ok"));
    const otherServer = net.createServer((sock) => sock.end("ok"));
    allowedServer.listen(0, "127.0.0.1", () => {
      otherServer.listen(0, "127.0.0.1", () => {
        const allowedPort = (allowedServer.address() as { port: number }).port;
        const otherPort = (otherServer.address() as { port: number }).port;
        const spec = baseSpec({ network: { mode: "LOOPBACK_PORTS", ports: [allowedPort] } });
        const { sbpl } = buildSeatbeltProfile(spec);
        const profilePath = join(ROOT, "loopback.sb");
        writeFileSync(profilePath, sbpl);
        const script = join(ROOT, "loopback-probe.mjs");
        writeFileSync(script, `
          const net = await import("node:net");
          function tryConn(port, label) {
            return new Promise((res) => {
              const s = net.createConnection({ host: "127.0.0.1", port }, () => { console.log(label + ":CONNECTED"); s.end(); res(); });
              s.on("error", (e) => { console.log(label + ":ERROR:" + e.code); res(); });
            });
          }
          await tryConn(${allowedPort}, "ALLOWED_PORT");
          await tryConn(${otherPort}, "OTHER_PORT");
          const remote = await new Promise((res) => {
            const s = net.createConnection({ host: "1.1.1.1", port: 80, timeout: 2000 }, () => { res("CONNECTED"); });
            s.on("error", (e) => res("ERROR:" + e.code));
            s.on("timeout", () => res("TIMEOUT"));
          });
          console.log("REMOTE:" + remote);
        `);
        let out = "";
        try {
          out = execFileSync("/usr/bin/sandbox-exec", ["-f", profilePath, NODE, script], { encoding: "utf8", timeout: 8000 });
        } catch (e) {
          out = (e as { stdout?: string }).stdout ?? String(e);
        }
        allowedServer.close();
        otherServer.close();
        try {
          assert(out.includes("ALLOWED_PORT:CONNECTED"), `allowed loopback port must connect, got: ${out}`);
          assert(out.includes("OTHER_PORT:ERROR:EPERM"), `non-allowlisted loopback port must be denied (fail closed), got: ${out}`);
          assert(out.includes("REMOTE:ERROR:EPERM"), `a remote (non-loopback) host must still be denied, got: ${out}`);
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      });
    });
  }));
}

void (async () => {
try {
  main();
  await mainAsync();
} finally {
  rmSync(ROOT, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
})();
