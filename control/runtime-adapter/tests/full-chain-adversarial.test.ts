/**
 * หน้าที่: PHASE 4, step H — adversarial proof through the REAL, FULL
 * chain: `requestProcessExecution` (`execution/run/process-gate.ts`,
 * the ONE Process Gate entry) -> `launchViaRuntimeAdapter`
 * (`control/runtime-adapter/adapter.ts`) -> `buildSeatbeltProfile`
 * (`./seatbelt.ts`) -> `spawnConfined` (`./host-runtime.ts`) -> a real
 * child process -> captured stdout/stderr/exit_code -> the real audit
 * evidence `requestProcessExecution` already records. Every attack here
 * goes through `candidate.node.npm.build`/`.test`
 * (`execution/run/process-registry.ts`) exactly as
 * `control/agent-gateway/candidate-verification-runtime.ts` would call
 * it — never `launchViaRuntimeAdapter`/`buildSeatbeltProfile` directly
 * (that would only prove the primitive, not the wired chain).
 *
 * How to run: npx tsx control/runtime-adapter/tests/full-chain-adversarial.test.ts
 */
import { mkdirSync, writeFileSync, symlinkSync, existsSync, unlinkSync, rmdirSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { requestProcessExecution, NPM_CLI_JS_PATH } from "../../../execution/run/contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...a: unknown[]): void };

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n      ${JSON.stringify(detail)}`); }
}

const REPO_ROOT = process.cwd();
const WORKSPACE_ROOT = "/tmp/dna-os-agent-workspaces";

/**
 * STAGE 0.3 REGRESSION EVIDENCE (2026-08-24). The incident documented at case
 * 10 destroyed the repo's real package.json three times (11:45, 11:48, 12:23)
 * before the harness fix landed. The fix itself is case 10; THIS is the
 * standing proof that the fix cannot silently regress.
 *
 * Digest is captured at module load — BEFORE any workspace is created or any
 * npm invocation happens — so the final check compares against the manifest as
 * it was before this suite touched anything. Content digest, not existence:
 * the failure mode was an OVERWRITE with a 62-byte stub, which an existsSync
 * check would happily call healthy.
 */
const REPO_MANIFEST_PATH = `${REPO_ROOT}/package.json`;
function manifestDigest(): string {
  if (!existsSync(REPO_MANIFEST_PATH)) return "ABSENT";
  try {
    return createHash("sha256").update(readFileSync(REPO_MANIFEST_PATH)).digest("hex");
  } catch {
    return "UNREADABLE";
  }
}
const MANIFEST_DIGEST_BEFORE = manifestDigest();
/** Every symlink this suite creates, recorded so the guard can prove none of them ever resolved to the repo root. */
const SYMLINKS_CREATED: { link: string; resolved: string }[] = [];
const CALLER = "control/agent-gateway/candidate-verification-runtime.ts";

/** npm echoes the script's own SOURCE TEXT into stdout before running it (the "> ..." banner), so a naive `.includes()` against a marker string that also appears in the source falsely matches. This checks for the marker as its OWN output line instead. */
function emittedAsOwnLine(stdout: string, marker: string): boolean {
  return new RegExp(`^${marker}$`, "m").test(stdout);
}

function freshWorkspace(name: string): string {
  const ws = `${WORKSPACE_ROOT}/fullchain-${name}-${Date.now()}`;
  mkdirSync(ws, { recursive: true });
  return ws;
}

function npmBuild(ws: string, script: string) {
  writeFileSync(`${ws}/package.json`, JSON.stringify({ name: "adv", version: "1.0.0", scripts: { build: script } }));
  return requestProcessExecution({
    request_id: `fullchain-${Date.now()}-${Math.random()}`,
    parent_work_order_id: null,
    requester_identity: CALLER,
    executable_id: "candidate.node.npm.build",
    argv: [NPM_CLI_JS_PATH, "run", "build", "--cache", `${ws}/.npm-cache`],
    cwd: ws,
  });
}

async function main(): Promise<void> {
  // ===== 1. SBPL path injection — through the real chain, via a maliciously-named workspace path =====
  const injectWs = `${WORKSPACE_ROOT}/fullchain-inject")) (allow network*) (allow file-write* (subpath "/tmp`;
  let injectResult;
  try {
    mkdirSync(injectWs, { recursive: true });
    injectResult = await npmBuild(injectWs, `/usr/local/bin/node -e "require('net').createConnection({host:'1.1.1.1',port:80,timeout:2000},()=>{console.log('NETWORK_REACHED');process.exit(0)}).on('error',()=>{console.log('NETWORK_BLOCKED');process.exit(1)}).on('timeout',()=>{console.log('NETWORK_TIMEOUT');process.exit(2)})"`);
  } catch (e) {
    injectResult = { status: "THREW", stdout: "", stderr: String(e), exit_code: null } as any;
  }
  check("SBPL_PATH_INJECTION (full chain): a maliciously-named workspace path never grants network egress through the real chain", injectResult.status !== "EXECUTED" || !emittedAsOwnLine(injectResult.stdout, "NETWORK_REACHED"), injectResult);

  // ===== 2. Symlink executable substitution — through requestProcessExecution directly =====
  const substWs = freshWorkspace("subst");
  const substResult = await requestProcessExecution({
    request_id: `fullchain-subst-${Date.now()}`, parent_work_order_id: null, requester_identity: CALLER,
    executable_id: "candidate.node.npm.build", executable_path: "/bin/echo",
    argv: [NPM_CLI_JS_PATH, "run", "build", "--cache", `${substWs}/.npm-cache`], cwd: substWs,
  });
  check("EXECUTABLE_SUBSTITUTION (full chain): overriding an already-absolute registry entry's executable is refused", substResult.status === "EXECUTABLE_IDENTITY_MISMATCH", substResult);

  // ===== 3. cwd escape — MASTER_SOURCE =====
  const cwdEscapeResult = await requestProcessExecution({
    request_id: `fullchain-cwdescape-${Date.now()}`, parent_work_order_id: null, requester_identity: CALLER,
    // Defense in depth (flagged by dna-os-infrastructure-74 after the
    // package.json incident): --cache points at a DISPOSABLE path, never
    // REPO_ROOT/.npm-cache — this assertion is about the DENY status, not
    // about where the cache would have gone, so a future regression in
    // allowed_cwd_scope's check would be harmless here rather than writing
    // into the real repo again.
    executable_id: "candidate.node.npm.build", argv: [NPM_CLI_JS_PATH, "run", "build", "--cache", `${WORKSPACE_ROOT}/cwd-escape-probe.npm-cache`], cwd: REPO_ROOT,
  });
  check("CWD_ESCAPE (full chain): cwd outside allowed_cwd_scope (MASTER_SOURCE) is refused before any launch", cwdEscapeResult.status === "DENY", cwdEscapeResult);

  // ===== 4. Executable substitution via unregistered executable_id =====
  const unregResult = await requestProcessExecution({
    request_id: `fullchain-unreg-${Date.now()}`, parent_work_order_id: null, requester_identity: CALLER,
    executable_id: "candidate.arbitrary.anything", argv: ["/bin/sh", "-c", "echo pwned"], cwd: freshWorkspace("unreg"),
  });
  check("UNAUTHORIZED_CHILD_PROCESS (full chain): unregistered executable_id refused, no PATH-resolved/arbitrary binary runs", unregResult.status === "EXECUTABLE_NOT_REGISTERED", unregResult);

  // ===== 5. Environment leakage =====
  // Real, disclosed finding this round: npm itself sets `HOME`/`npm_config_*`
  // in the child's env even though our own `env` object never contains
  // `HOME` — npm derives it from `os.homedir()`, which on macOS queries the
  // OS user database directly (getpwuid), independent of any env var this
  // capability controls. This is NOT an env-filtering leak (DNA OS's own
  // allowlist still only forwards PATH/TMPDIR/LANG/LC_ALL) — it is a real
  // architectural limit: a candidate script can always learn its own real
  // home directory PATH via `os.homedir()`, with or without npm, since that
  // is a kernel/libc identity fact, not something `environment_profile` can
  // withhold. The actual security boundary (whether CREDENTIAL FILES under
  // that path are readable) is proven separately below. Checked here:
  // real secret TOKEN VALUES never reach the child.
  const envWs = freshWorkspace("env");
  const envResult = await npmBuild(envWs, `/usr/local/bin/node -e "console.log('ENV_DUMP:'+JSON.stringify(process.env))"`);
  const leaked = ["GITHUB_TOKEN", "GH_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"].filter((k) => envResult.stdout.includes(`"${k}"`));
  check("ENVIRONMENT_LEAKAGE (full chain): no credential/token env var reaches the child (HOME is npm's own libc-derived value, not an env-filtering leak — see comment above)", envResult.status === "EXECUTED" && leaked.length === 0, { envResult, leaked });

  // ===== 6. Unauthorized network =====
  const netWs = freshWorkspace("net");
  const netResult = await npmBuild(netWs, `/usr/local/bin/node -e "require('net').createConnection({host:'1.1.1.1',port:80,timeout:2000},()=>{console.log('NETWORK_REACHED');process.exit(0)}).on('error',()=>{console.log('NETWORK_BLOCKED');process.exit(1)}).on('timeout',()=>{console.log('NETWORK_TIMEOUT');process.exit(2)})"`);
  check("UNAUTHORIZED_NETWORK (full chain): real outbound TCP connect is denied", netResult.status === "EXECUTED" && emittedAsOwnLine(netResult.stdout, "NETWORK_BLOCKED") && !emittedAsOwnLine(netResult.stdout, "NETWORK_REACHED"), netResult);

  // ===== 7. Unauthorized filesystem write (outside the candidate's own workspace) =====
  const writeWs = freshWorkspace("write");
  const outsideTarget = `${REPO_ROOT}/PHASE4_ADVERSARIAL_WRITE_PROBE.txt`;
  const writeResult = await npmBuild(writeWs, `/usr/local/bin/node -e "try{require('fs').writeFileSync('${outsideTarget}','pwned');console.log('WRITE_SUCCEEDED')}catch(e){console.log('WRITE_BLOCKED:'+e.code)}"`);
  check("UNAUTHORIZED_FILESYSTEM_WRITE (full chain): write outside the candidate workspace (into MASTER_SOURCE) is denied", writeResult.status === "EXECUTED" && emittedAsOwnLine(writeResult.stdout, "WRITE_BLOCKED:EPERM") && !existsSync(outsideTarget), { writeResult, existsOutside: existsSync(outsideTarget) });

  // ===== 8. Credential path read =====
  // ~/.ssh/id_rsa does not exist on this host, so reading it would only
  // prove ENOENT (inconclusive — never reaches the sandbox's own deny
  // rule). A real decoy secret file is written first so the test proves
  // the MANDATORY_READ_DENY_SUBPATHS rule itself, not a missing-file
  // accident — created and removed by this test, never left behind.
  const sshDir = `${homedir()}/.ssh`;
  const decoyPath = `${sshDir}/id_rsa_phase4_adversarial_decoy`;
  const sshDirPreexisted = existsSync(sshDir);
  mkdirSync(sshDir, { recursive: true });
  writeFileSync(decoyPath, "-----BEGIN OPENSSH PRIVATE KEY-----\nDECOY_NOT_A_REAL_KEY\n-----END OPENSSH PRIVATE KEY-----\n");
  const credWs = freshWorkspace("cred");
  const credResult = await npmBuild(credWs, `/usr/local/bin/node -e "try{const c=require('fs').readFileSync('${decoyPath}','utf8');console.log('READ_SUCCEEDED:'+c.length)}catch(e){console.log('READ_BLOCKED:'+e.code)}"`);
  check("CREDENTIAL_PATH_READ (full chain): a real ~/.ssh file is denied by the mandatory read-deny rule, proven against a file that actually exists", credResult.status === "EXECUTED" && emittedAsOwnLine(credResult.stdout, "READ_BLOCKED:EPERM"), credResult);
  unlinkSync(decoyPath);
  if (!sshDirPreexisted) { try { rmdirSync(sshDir); } catch { /* not empty or already gone — fine */ } }

  // ===== 9. Nested .git mutation =====
  // ROOT_GIT_MUTATION — <workspace>/.git/config (the case that already
  // passed even before the Phase 4.1 nested-git fix).
  const gitWs = freshWorkspace("git");
  mkdirSync(`${gitWs}/.git`, { recursive: true });
  writeFileSync(`${gitWs}/.git/config`, "[core]\n\toriginal = true\n");
  const gitResult = await npmBuild(gitWs, `/usr/local/bin/node -e "try{require('fs').writeFileSync('.git/config','[core]\\n\\tpwned = true\\n');console.log('GIT_CONFIG_WRITE_SUCCEEDED')}catch(e){console.log('GIT_CONFIG_WRITE_BLOCKED:'+e.code)}"`);
  check("ROOT_GIT_MUTATION (full chain): writing <workspace>/.git/config is denied", gitResult.status === "EXECUTED" && emittedAsOwnLine(gitResult.stdout, "GIT_CONFIG_WRITE_BLOCKED:EPERM"), gitResult);

  // NESTED_GIT_MUTATION — a repo NESTED below the workspace root
  // (<workspace>/vendor/dep/.git/config) — this is the case Phase 3's
  // original evidence_refs implied but never actually exercised (flagged
  // during Phase 4.1 discovery); now genuinely covered by the regex-based
  // mandatory write-deny in seatbelt.ts.
  const nestedGitWs = freshWorkspace("nestedgit");
  mkdirSync(`${nestedGitWs}/vendor/dep/.git/hooks`, { recursive: true });
  writeFileSync(`${nestedGitWs}/vendor/dep/.git/config`, "[core]\n\toriginal = true\n");
  const nestedGitResult = await npmBuild(nestedGitWs, `/usr/local/bin/node -e "const fs=require('fs');let cfg,hook;try{fs.writeFileSync('vendor/dep/.git/config','[core]\\n\\tpwned = true\\n');cfg='ALLOWED'}catch(e){cfg='BLOCKED:'+e.code}try{fs.writeFileSync('vendor/dep/.git/hooks/post-checkout','#!/bin/sh\\necho pwned');hook='ALLOWED'}catch(e){hook='BLOCKED:'+e.code}console.log('NESTED_GIT_CONFIG_'+cfg);console.log('NESTED_GIT_HOOKS_'+hook)"`);
  check("NESTED_GIT_MUTATION (full chain): writing a NESTED repo's .git/config is denied", nestedGitResult.status === "EXECUTED" && emittedAsOwnLine(nestedGitResult.stdout, "NESTED_GIT_CONFIG_BLOCKED:EPERM"), nestedGitResult);
  check("NESTED_GIT_MUTATION (full chain): writing a NESTED repo's .git/hooks/* is denied", nestedGitResult.status === "EXECUTED" && emittedAsOwnLine(nestedGitResult.stdout, "NESTED_GIT_HOOKS_BLOCKED:EPERM"), nestedGitResult);

  // ===== 10. Symlinked cwd escape =====
  // SECURITY INCIDENT FIX (2026-08-24, disclosed by dna-os-infrastructure-74):
  // the PRIOR version of this test symlinked `linkWs` DIRECTLY at REPO_ROOT
  // and then called `writeFileSync(`${linkWs}/package.json`, ...)` from this
  // UNSANDBOXED TEST HARNESS ITSELF (before any Process Gate call) — writing
  // straight through the symlink and overwriting the repo's real,
  // never-committed package.json with a 62-byte test stub. This was a bug in
  // the TEST HARNESS's own filesystem setup, not in Process Gate, seatbelt.ts,
  // or candidate-verification-runtime.ts — no production code path did this.
  // Fixed by symlinking a SAFE, disposable target instead of REPO_ROOT, and
  // by never writing through a symlink whose target this test does not fully
  // control. package.json was restored by dna-os-infrastructure-74 (verified
  // against package-lock.json's packages[""] entry) before this fix landed.
  const linkTargetWs = freshWorkspace("linktarget");
  writeFileSync(`${linkTargetWs}/package.json`, JSON.stringify({ name: "adv", version: "1.0.0", scripts: { build: "/usr/local/bin/node -e \"require('fs').writeFileSync('symlink-build-marker.txt','ok')\"" } }));
  const linkWs = `${WORKSPACE_ROOT}/fullchain-symlinkescape-${Date.now()}`;
  symlinkSync(linkTargetWs, linkWs); // points at our OWN disposable workspace, never REPO_ROOT
  SYMLINKS_CREATED.push({ link: linkWs, resolved: realpathSync(linkWs) });
  const linkResult = await requestProcessExecution({
    request_id: `fullchain-symlink-${Date.now()}`, parent_work_order_id: null, requester_identity: CALLER,
    executable_id: "candidate.node.npm.build", argv: [NPM_CLI_JS_PATH, "run", "build", "--cache", `${linkWs}/.npm-cache`], cwd: linkWs,
  });
  check("SYMLINK_CWD_ESCAPE (full chain): a symlinked cwd resolves through the kernel's realpath and stays confined to the real target directory (never REPO_ROOT — never a symlink whose target this test does not itself control)", linkResult.status === "EXECUTED" && existsSync(`${linkTargetWs}/symlink-build-marker.txt`) && !existsSync(`${REPO_ROOT}/symlink-build-marker.txt`), { linkResult, markerInTarget: existsSync(`${linkTargetWs}/symlink-build-marker.txt`), markerInRepoRoot: existsSync(`${REPO_ROOT}/symlink-build-marker.txt`) });

  // ===== 11. STAGE 0.3 GUARD: this harness can never write its fixture manifest into the real repo root =====
  // Three independent assertions, because each catches a different regression:
  //  (a) content digest unchanged  -> catches ANY overwrite, including a
  //      same-length one, which an existsSync check would miss entirely;
  //  (b) no symlink this suite created resolves to REPO_ROOT (realpath, not
  //      name-pattern) -> catches the exact 2026-08-24 root cause directly,
  //      even if the write itself happened to fail for an unrelated reason;
  //  (c) the repo manifest is not the "adv" fixture -> catches the specific
  //      observed corruption by identity, so the failure message is unambiguous.
  const digestAfter = manifestDigest();
  const symlinksIntoRepoRoot = SYMLINKS_CREATED.filter((s) => s.resolved === REPO_ROOT || s.resolved === realpathSync(REPO_ROOT));
  let manifestIsFixture = false;
  if (existsSync(REPO_MANIFEST_PATH)) {
    try {
      manifestIsFixture = (JSON.parse(readFileSync(REPO_MANIFEST_PATH, "utf-8")) as { name?: string }).name === "adv";
    } catch {
      manifestIsFixture = true; // an unparseable manifest is at least as bad as the fixture
    }
  }
  check(
    "HARNESS_NEVER_WRITES_REPO_ROOT_MANIFEST (Stage 0.3 regression guard): the repo's real package.json is byte-identical to before this suite ran, no symlink this suite created resolves to REPO_ROOT, and the manifest is not the 'adv' fixture",
    digestAfter === MANIFEST_DIGEST_BEFORE && symlinksIntoRepoRoot.length === 0 && !manifestIsFixture,
    { digestBefore: MANIFEST_DIGEST_BEFORE, digestAfter, symlinksIntoRepoRoot, manifestIsFixture, symlinksCreated: SYMLINKS_CREATED },
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) (process as unknown as { exitCode: number }).exitCode = 1;
}

void main();
