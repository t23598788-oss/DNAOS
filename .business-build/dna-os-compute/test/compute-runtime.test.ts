/**
 * dna-os-compute Phase 1 acceptance test (tsx script, same convention as
 * the repo's scripts/*-test.ts). REAL filesystem + REAL HTTP loopback —
 * no mocks on the surfaces under test:
 *  1. path escape denial (.., absolute, excluded dirs, .env patterns)
 *  2. real code.read round-trip inside a granted workspace
 *  3. auth: no/incorrect bearer token → 401; token match → dispatch works
 *  4. build/test scripts: off-allowlist → SCOPE_DENIED; on-allowlist runs a
 *     REAL npm script in a REAL workspace (types-only, no network)
 *  5. ai.infer fail-closed: unconfigured endpoint → NOT_CONFIGURED
 */
import assert from "assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import http from "http";
import { resolveWorkspacePath, readWorkspaceFile, WorkspaceError } from "../src/workspace.js";
import { allowedScripts, runBuildOrTestScript } from "../src/exec.js";
import { inferForward } from "../src/inference.js";
import { RemoteComputeDaemon } from "../src/daemon.js";

let failures = 0;
const check = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS ${name}`))
    .catch((e: unknown) => {
      failures += 1;
      console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
    });

// fixture workspace
const wsRoot = mkdtempSync(path.join(os.tmpdir(), "dna-compute-ws-"));
mkdirSync(path.join(wsRoot, "sub"), { recursive: true });
writeFileSync(path.join(wsRoot, "real.ts"), "export const answer = 42;\n", "utf-8");
writeFileSync(path.join(wsRoot, "sub", "inner.ts"), "export const inner = 1;\n", "utf-8");
writeFileSync(path.join(wsRoot, ".env.local"), "SUPER_SECRET=1\n", "utf-8");
writeFileSync(path.join(wsRoot, "server.key"), "PRIVATE\n", "utf-8");

await (async () => {
  await check("path escape denial", () => {
    assert.throws(() => resolveWorkspacePath(wsRoot, "../outside"), WorkspaceError);
    assert.throws(() => resolveWorkspacePath(wsRoot, "/etc/passwd"), WorkspaceError);
    assert.throws(() => resolveWorkspacePath(wsRoot, "sub/../../outside"), WorkspaceError);
  });

  await check("excluded dirs + sensitive files denied", async () => {
    assert.throws(() => resolveWorkspacePath(wsRoot, ".git/config"), WorkspaceError);
    assert.throws(() => resolveWorkspacePath(wsRoot, "node_modules/x/index.js"), WorkspaceError);
    await assert.rejects(() => readWorkspaceFile(wsRoot, { path: ".env.local" }), WorkspaceError);
    await assert.rejects(() => readWorkspaceFile(wsRoot, { path: "server.key" }), WorkspaceError);
  });

  await check("real code.read inside workspace", async () => {
    const r = await readWorkspaceFile(wsRoot, { path: "sub/inner.ts" });
    assert.equal(r.content, "export const inner = 1;\n");
    assert.equal(r.relPath, "sub/inner.ts");
    assert.ok(r.bytes > 0);
  });

  await check("allowlist shape per kind", () => {
    assert.deepEqual([...allowedScripts("build.run")], ["build", "type-check"]);
    assert.ok(allowedScripts("test.run").includes("type-check"));
  });

  await check("off-allowlist script is SCOPE_DENIED", async () => {
    const bad = await runBuildOrTestScript("test.run", wsRoot, { script: "dangerous-uninstall" });
    assert.equal(bad.status, "SCOPE_DENIED");
  });

  await check("on-allowlist script runs for real (type-check on fixture)", async () => {
    // write a minimal package.json into the fixture so `npm run type-check` exists
    writeFileSync(path.join(wsRoot, "package.json"), JSON.stringify({ name: "fixture", scripts: { "type-check": "node --version" } }), "utf-8");
    const run = await runBuildOrTestScript("test.run", wsRoot, { script: "type-check" });
    assert.equal(run.status, "SUCCEEDED");
    // npm run header + node --version line (e.g. v22.23.2)
    assert.equal(/^v\d+\.\d+\.\d+$/m.test(run.output ?? ""), true, `unexpected output: ${JSON.stringify(run.output)}`);
  });

  await check("ai.infer fail-closed without endpoint", async () => {
    const r = await inferForward({ prompt: "ping" }, null);
    assert.equal(r.status, "NOT_CONFIGURED");
  });

  await check("http surface: 401 without token, works with token", async () => {
    const daemon = new RemoteComputeDaemon({ token: "tk-accept", inferEndpoint: null, bindHost: "127.0.0.1", port: 0, deviceId: null });
    const server = await daemon.start();
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    const call = (p: string, headers: Record<string, string> = {}, method = "GET") =>
      new Promise<{ code: number; body: string }>((resolve, reject) => {
        const req = http.request(`${base}${p}`, { method, headers }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ code: res.statusCode ?? 0, body }));
        });
        req.on("error", reject);
        if (method === "POST") req.write(headers.__body ? headers.__body : "{}");
        req.end();
      });

    const hb = await call("/health");
    assert.equal(hb.code, 200); // health is reachable without token (not an admin surface)
    const noAuth = await call("/commands", { __body: JSON.stringify({ kind: "code.read", payload: { path: "real.ts" }, workspaceRoot: wsRoot }) }, "POST");
    assert.equal(noAuth.code, 401);
    const badAuth = await call("/commands", { __body: JSON.stringify({ kind: "code.read", payload: { path: "real.ts" }, workspaceRoot: wsRoot }), Authorization: "Bearer nope" }, "POST");
    assert.equal(badAuth.code, 401);
    const good = await call("/commands", { __body: JSON.stringify({ commandId: "c1", kind: "code.read", payload: { path: "real.ts" }, workspaceRoot: wsRoot }), Authorization: "Bearer tk-accept" }, "POST");
    assert.equal(good.code, 200);
    const parsed = JSON.parse(good.body) as { result: { status: string; output: string | null } };
    assert.equal(parsed.result.status, "SUCCEEDED");
    assert.ok((parsed.result.output ?? "").includes("export const answer = 42;"));
    const unknownKind = await call("/commands", { __body: JSON.stringify({ kind: "deploy.prod", payload: {}, workspaceRoot: wsRoot }), Authorization: "Bearer tk-accept" }, "POST");
    assert.equal(JSON.parse(unknownKind.body).result.status, "KIND_UNKNOWN");
    server.close();
  });

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("\nALL CHECKS PASSED");
  }
})();
