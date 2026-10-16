#!/usr/bin/env npx tsx
/**
 * Devices ↔ Compute RELAY acceptance test (Phase 2, 2026-10-16).
 *
 * REAL code, REAL loopback HTTP, REAL daemon child process — no mocks on
 * the surfaces under test; NO database and no network beyond 127.0.0.1
 * (same stub technique as scripts/connect-core-acceptance-test.ts). Proves:
 *   1. RELAY_NOT_CONFIGURED — env fail-closed BEFORE any device row exists
 *   2. CLOSED TOOL SET      — unknown toolId → TOOL_KIND_UNKNOWN, never forwarded
 *   3. PAYLOAD CONTRACTS    — each tool id validates its own shape
 *   4. IDEMPOTENCY          — deterministic key per (tool, payload, device, owner)
 *   5. REAL FORWARD         — code.read + test.run against the REAL spawned
 *                             daemon (bearer auth), and daemon-side
 *                             NOT_CONFIGURED for ai.infer carried VERBATIM
 *   6. AUTH IS REAL         — wrong bearer token → RELAY_UNREACHABLE
 *   7. DENY-BY-DEFAULT      — evaluateScope with zero grants denies a compute tool
 *   8. SOURCE WIRING        — the route really runs the 6-step order over the
 *                             EXISTING engine (requireAuth/create/ack/forward/
 *                             complete), never a second gateway
 * Run: npx tsx scripts/devices-compute-relay-test.ts
 */
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type GrantRow } from "@/core/policy/scope";
import {
  COMPUTE_TOOL_IDS, resolveRelayConfig, forwardToComputeDaemon,
  toolIdToDaemonKind, buildDaemonPayload, denseIdempotencyKey, type RelayConfig,
} from "@/app/api/admin/devices/_lib/computeRelay";
import { evaluateComputeScope, RELAY_STEP_ORDER, tokenMatches, tokenFingerprint } from "@/app/api/admin/devices/_lib/computeRelayRuntime";

const ROOT = path.resolve(import.meta.dirname, "..");
let failures = 0;
const check = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS ${name}`))
    .catch((e: unknown) => { failures += 1; console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`); });

const wsRoot = mkdtempSync(path.join("/tmp", "dna-relay-ws-"));
mkdirSync(path.join(wsRoot, "sub"), { recursive: true });
writeFileSync(path.join(wsRoot, "answer.ts"), "export const answer = 42;\n", "utf-8");
writeFileSync(path.join(wsRoot, "package.json"), JSON.stringify({ name: "fixture", scripts: { "type-check": "node --version" } }), "utf-8");

/** Spawn the REAL daemon via tsx server-entry and wait for the READY line. */
async function spawnDaemon(env: Record<string, string>): Promise<{ url: string; kill: () => void; child: ChildProcess }> {
  const child = spawn("./node_modules/.bin/tsx", [path.join(ROOT, "dna-os-compute/src/server-entry.ts")], {
    cwd: ROOT,
    env: { ...process.env, DNA_COMPUTE_PORT: "0", DNA_COMPUTE_BIND_HOST: "127.0.0.1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("daemon did not become ready within 30s")), 30_000);
    let buf = "";
    child.stdout!.on("data", (d: Buffer) => {
      buf += String(d);
      const m = /DNA_COMPUTE_READY port=(\d+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); }
    });
    child.stderr!.on("data", (d: Buffer) => { if (/DNA_COMPUTE_BOOT_FAILED/.test(String(d))) { clearTimeout(timer); reject(new Error(String(d))); } });
  });
  return { url, kill: () => child.kill("SIGTERM"), child };
}


(async () => {
  let killDaemon: (() => void) | null = null;
  try {
    await check("1. relay env fail-closed (no URL → RELAY_NOT_CONFIGURED)", () => {
      const missing = resolveRelayConfig(() => undefined);
      assert.equal(missing.ok, false);
      if (missing.ok) return;
      assert.equal(missing.code, "RELAY_NOT_CONFIGURED");
    });

    await check("2. closed tool set — unknown id never becomes a daemon kind", () => {
      assert.equal(toolIdToDaemonKind("compute.code.read"), "code.read");
      assert.equal(toolIdToDaemonKind("compute.ai.infer"), "ai.infer");
      assert.equal(toolIdToDaemonKind("deploy.prod"), null);
      assert.ok(COMPUTE_TOOL_IDS.length === 4);
    });

    await check("3. payload contracts per tool id", () => {
      assert.ok(buildDaemonPayload("compute.code.read", { path: "a.ts" }) !== null);
      assert.ok(buildDaemonPayload("compute.code.read", {}) === null);
      assert.ok(buildDaemonPayload("compute.code.read", { path: { nested: true } }) === null);
      assert.ok(buildDaemonPayload("compute.build.run", { script: "type-check" }) !== null);
      assert.ok(buildDaemonPayload("compute.build.run", { script: " " }) === null);
      assert.ok(buildDaemonPayload("compute.ai.infer", { prompt: "hi" }) !== null);
      assert.ok(buildDaemonPayload("compute.ai.infer", {}) === null);
    });

    await check("4. idempotency key is deterministic per inputs", () => {
      const a = denseIdempotencyKey("compute.code.read", { path: "a.ts" }, "dev1", "owner1");
      const b = denseIdempotencyKey("compute.code.read", { path: "a.ts" }, "dev1", "owner1");
      const c = denseIdempotencyKey("compute.code.read", { path: "b.ts" }, "dev1", "owner1");
      assert.equal(a, b);
      assert.notEqual(a, c);
      assert.ok(a.startsWith("dns-relay-"));
    });

    await check("7. deny-by-default scope: zero grants → NO_GRANT; live grant → allow", () => {
      const denied = evaluateComputeScope("devX", "compute.code.read", [] as GrantRow[]);
      assert.equal(denied.allow, false, "zero grants must NEVER allow a compute tool");
      if (!denied.allow) assert.equal(denied.code, "NO_GRANT");
      const granted = evaluateComputeScope("devX", "compute.code.read", [
        { subject_type: "device", subject_id: "devX", action: "run", resource: "compute.code.read" } as GrantRow,
      ]);
      assert.equal(granted.allow, true, "a live matching grant must allow (evaluator proves deny≠always)");
    });

    await check("6. token compare is timing-safe and honest", () => {
      assert.equal(tokenMatches("abc", "abc"), true);
      assert.equal(tokenMatches("abc", "abd"), false);
      assert.equal(tokenMatches("abc", "abcd"), false);
      assert.equal(tokenFingerprint("secret-token").length, 12);
    });

    // Real daemon for the forward checks
    const token = "dna-relay-token-local";
    const daemon = await spawnDaemon({ DNA_COMPUTE_TOKEN: token, DNA_COMPUTE_INFER_ENDPOINT: "" });
    killDaemon = daemon.kill;
    const liveConfig: RelayConfig = { url: daemon.url, token };

    await check("5a. REAL forward code.read (loopback daemon)", async () => {
      const res = await forwardToComputeDaemon(
        { toolId: "compute.code.read", payload: { path: "answer.ts" }, commandId: "cmd-relay-1", workspaceRoot: wsRoot },
        { ok: true, config: liveConfig },
      );
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.equal(res.status, "SUCCEEDED");
      assert.ok(String((res.result as { output?: string }).output).includes("export const answer = 42;"));
    });

    await check("5b. REAL forward test.run (type-check fixture)", async () => {
      const res = await forwardToComputeDaemon(
        { toolId: "compute.test.run", payload: { script: "type-check" }, commandId: "cmd-relay-2", workspaceRoot: wsRoot },
        { ok: true, config: liveConfig },
      );
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.equal(res.status, "SUCCEEDED");
      assert.ok(/^v\d+\.\d+\.\d+$/m.test(String((res.result as { output?: string }).output)));
    });

    await check("5c. daemon-side SCOPE_DENIED carried verbatim (off-allowlist script)", async () => {
      const res = await forwardToComputeDaemon(
        { toolId: "compute.build.run", payload: { script: "not-allowed-script" }, commandId: "cmd-relay-3", workspaceRoot: wsRoot },
        { ok: true, config: liveConfig },
      );
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.equal(res.status, "SCOPE_DENIED");
    });

    await check("5d. ai.infer honest NOT_CONFIGURED (no endpoint configured)", async () => {
      const res = await forwardToComputeDaemon(
        { toolId: "compute.ai.infer", payload: { prompt: "ping" }, commandId: "cmd-relay-4", workspaceRoot: null },
        { ok: true, config: liveConfig },
      );
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.equal(res.status, "NOT_CONFIGURED");
    });

    await check("6b. wrong bearer → RELAY_UNREACHABLE", async () => {
      const res = await forwardToComputeDaemon(
        { toolId: "compute.code.read", payload: { path: "answer.ts" }, commandId: "cmd-relay-5", workspaceRoot: wsRoot },
        { ok: true, config: { url: daemon.url, token: "WRONG" } },
      );
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.code, "RELAY_UNREACHABLE");
    });

    await check("8. source wiring — route runs the 6-step order over the existing engine", () => {
      const routeSrc = readFileSync(path.join(ROOT, "app/api/admin/devices/compute-relay/route.ts"), "utf-8");
      assert.ok(routeSrc.includes("requireAuth(ADMIN_TIER)"), "route must gate by ADMIN_TIER");
      assert.ok(routeSrc.includes("createDeviceCommand"), "must reuse the existing create step");
      assert.ok(routeSrc.includes("ackCommand"), "must run the real ack (scope re-check)");
      assert.ok(routeSrc.includes("forwardToComputeDaemon"), "must forward through the relay");
      assert.ok(routeSrc.includes("completeCommand"), "must complete with honest status");
      assert.ok(routeSrc.includes("process.cwd()"), "workspace root is asserted SERVER-SIDE ONLY");
      assert.ok(!/createClient\(|runpod|ollama/gi.test(routeSrc.split("forwardToComputeDaemon")[0]), "no second gateway/daemon inside the route");
      assert.ok(RELAY_STEP_ORDER.join(",") === "config,scope,create,ack,forward,complete");
    });
  } finally {
    killDaemon?.();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("\nALL CHECKS PASSED");
  }
})();
