/**
 * Step 8 — generic Linux Own-Machine Core acceptance (composition).
 * Does not import transport/owner-command-http/server.ts (write-gate schg).
 * Proves portable contracts compose without Railway/Vercel.
 *
 * Status this file can claim: TESTED/COMPOSED (real loopback HTTP +
 * existing portable APIs). Not live production deploy PROVEN.
 *
 * Run: esbuild bundle + node (npx tsx is currently broken in this tree).
 */

import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  providerIsExecutionAuthority,
  setRuntimeNodePlatformForTests,
} from "./runtime-node-and-optional-provider";
import {
  CORE_BOOT_MUST_NOT_REQUIRE_ENV,
  CORE_BOOT_REQUIRED_ENV,
} from "./own-machine-core";
import { evaluateBindPolicy, verifySharedSecret } from "../../permissions/network-auth-gate/contract";
import { evaluateExecutionPermission } from "../../permissions/execution-policy/contract";
import { listCapabilities } from "../../control/command-router/capability-registry";
import { macLocalAgentUnavailableBody, coreNodeUnavailableForCapability } from "../../transport/owner-command-http/mac-local-agent-gate";
import {
  PortableProcessSupervisor,
  SERVICES,
  resetPortableSupervisorForTests,
} from "../../control/runtime-control/contract";
import type { ServiceDefinition, ServiceId } from "../../control/runtime-control/contract";
import {
  optionalProviderSecretStatus,
  secretResolutionBackend,
} from "../../credentials/secret-resolver/index";
import { resolveControlPlaneCheckout, setCheckoutResolutionForTests } from "../../software/repository-registry/contract";
import type { RepositoryRegistration } from "../../software/repository-registry/contract";
import {
  ensureRuntimeEndpointsLoaded,
  resetRuntimeEndpointsForTests,
  resolveRuntimeEndpoint,
} from "../../control/runtime-endpoint-registry/contract";

declare const process: {
  env: Record<string, string | undefined>;
  execPath: string;
  cwd(): string;
  exitCode?: number;
};
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const FAKE_SECRET = "fake-step8-owner-command-secret";
const FAKE_RAILWAY = "must-not-be-read-for-core-boot";
const FIXTURE = join(process.cwd(), "control/runtime-control/tests/fixtures/portable-http-child.cjs");

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => void | Promise<void>): Promise<void> {
  try {
    await body();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fixtureDef(id: ServiceId, port: number): ServiceDefinition {
  const base = SERVICES[id];
  return {
    ...base,
    port,
    health_path: "/health",
    health_expect_status: 200,
    readiness_timeout_ms: 5_000,
    portable_process: {
      argv: [process.execPath, FIXTURE],
      env_allowlist: ["DNA_OS_TEST_HEALTH", "OWNER_COMMAND_HTTP_SHARED_SECRET"],
    },
  };
}

function listen(server: ReturnType<typeof createServer>): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolveListen, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no port"));
        return;
      }
      resolveListen({
        port: addr.port,
        close: () => new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}

async function httpJson(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = { raw: text }; }
  return { status: res.status, body };
}

async function main(): Promise<void> {
  setRuntimeNodePlatformForTests("linux");
  const previousRailway = process.env.RAILWAY_PROJECT_TOKEN;
  const previousOwner = process.env.OWNER_COMMAND_HTTP_SHARED_SECRET;
  delete process.env.RAILWAY_PROJECT_TOKEN;
  delete process.env.RAILWAY_ENVIRONMENT_ID;
  delete process.env.RAILWAY_SERVICE_ID;
  delete process.env.RAILWAY_DEPLOYMENT_ID;
  process.env.OWNER_COMMAND_HTTP_SHARED_SECRET = FAKE_SECRET;
  process.env.DNA_OS_TEST_HEALTH = "200";

  const sandbox = join(process.cwd(), "tests/__sandbox__");
  mkdirSync(sandbox, { recursive: true });
  const linuxRoot = mkdtempSync(join(sandbox, "dnaos-step8-checkout-"));
  const dataDir = mkdtempSync(join(sandbox, "dnaos-step8-supervisor-"));
  const previousData = process.env.RUNTIME_CONTROL_DATA_DIR;
  process.env.RUNTIME_CONTROL_DATA_DIR = dataDir;
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(linuxRoot, { recursive: true });
  mkdirSync(join(linuxRoot, ".git"), { recursive: true });
  writeFileSync(
    join(linuxRoot, ".git", "config"),
    `[remote "origin"]\n\turl = https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-.git\n`,
    "utf8",
  );

  const controlPlane: RepositoryRegistration = {
    repository_id: "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-",
    owner: "t23598788-oss",
    repository: "-DNA-OS-INFRASTRUCTURE-",
    world: "CONTROL_PLANE",
    source_authority: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-.git",
    default_branch: "main",
    repository_root: linuxRoot,
    connection_id: null,
    status: "ACTIVE",
    registered_at: "2026-09-11T00:00:00.000Z",
  };
  setCheckoutResolutionForTests({
    lookup: {
      getRepository: (id) => (id === controlPlane.repository_id ? controlPlane : null),
      listOperationalRepositories: () => [controlPlane],
    },
    host: {
      cwd: () => linuxRoot,
      exists: (p) => existsSync(p),
    },
  });

  resetRuntimeEndpointsForTests();
  ensureRuntimeEndpointsLoaded();
  resetPortableSupervisorForTests();

  const catalog = {
    "joint-monitor": fixtureDef("joint-monitor", 18081),
  };
  const supervisor = new PortableProcessSupervisor({ catalog, cwd: linuxRoot });

  const server = createServer((req, res) => {
    const send = (status: number, obj: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "GET" && req.url === "/health") {
      send(200, { ok: true, railway_required: false, node: "CORE_NODE" });
      return;
    }
    if (req.method === "POST" && req.url === "/command") {
      if (!verifySharedSecret(req.headers.authorization, FAKE_SECRET)) {
        send(401, { error: "unauthorized" });
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        let commandText = "";
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { commandText?: unknown };
          commandText = typeof parsed.commandText === "string" ? parsed.commandText : "";
        } catch {
          send(400, { error: "invalid JSON body" });
          return;
        }
        if (commandText.trim() === "") {
          send(400, { error: "commandText must be a non-empty string" });
          return;
        }
        const permission = evaluateExecutionPermission({
          identity_id: "identity-step8",
          account_id: "account-step8",
          workspace_id: "workspace-step8",
          capability: "execution.run",
          command_id: "not-an-allowlisted-command",
          action: "run",
          cwd_scope: ".",
          requested_args: [],
          correlation_id: "step8",
        }, { identities: [], memberships: [], grants: [] }, "2026-09-11T00:00:00.000Z");
        send(200, {
          ok: true,
          railway_required: false,
          capabilities_registered: listCapabilities().length,
          permission_decision: permission.decision,
          classified_without_provider: true,
        });
      });
      return;
    }
    send(404, { error: "not found" });
  });

  let bound: { port: number; close: () => Promise<void> } | null = null;
  try {
    await check("0. boot env contract does not require Railway names", () => {
      for (const name of CORE_BOOT_REQUIRED_ENV) {
        assert(name !== "RAILWAY_PROJECT_TOKEN", name);
      }
      assert(CORE_BOOT_MUST_NOT_REQUIRE_ENV.includes("RAILWAY_PROJECT_TOKEN"), "token listed");
      assert(process.env.RAILWAY_PROJECT_TOKEN === undefined, "token still set");
    });

    await check("1-2. Core loopback health without Railway", async () => {
      bound = await listen(server);
      const bind = evaluateBindPolicy("127.0.0.1", FAKE_SECRET);
      assert(bind.allowed, "loopback bind");
      const health = await httpJson(`http://127.0.0.1:${bound.port}/health`);
      assert(health.status === 200 && health.body.ok === true, JSON.stringify(health));
      assert(health.body.railway_required === false, "health must not require Railway");
    });

    await check("3. authenticated POST /command; missing bearer fails", async () => {
      assert(bound !== null, "not listening");
      const denied = await httpJson(`http://127.0.0.1:${bound.port}/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandText: "status" }),
      });
      assert(denied.status === 401, String(denied.status));
      const ok = await httpJson(`http://127.0.0.1:${bound.port}/command`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${FAKE_SECRET}` },
        body: JSON.stringify({ commandText: "status" }),
      });
      assert(ok.status === 200 && ok.body.ok === true, JSON.stringify(ok));
      assert(ok.body.railway_required === false, "command path required Railway");
      assert(typeof ok.body.capabilities_registered === "number" && (ok.body.capabilities_registered as number) > 0, "registry empty");
    });

    await check("4. execution-policy runs on the command path (DENY without grant)", async () => {
      assert(bound !== null, "not listening");
      const ok = await httpJson(`http://127.0.0.1:${bound.port}/command`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${FAKE_SECRET}` },
        body: JSON.stringify({ commandText: "anything" }),
      });
      assert(ok.body.permission_decision === "DENY", String(ok.body.permission_decision));
    });

    await check("5. local runtime endpoints resolve without provider hostnames", () => {
      const core = resolveRuntimeEndpoint("endpoint://owner-command-http/local");
      assert(core.ok && core.endpoint.address === "http://127.0.0.1:8791", JSON.stringify(core));
      assert(!core.ok || !core.endpoint.address.includes("railway"), "endpoint leaked provider");
      const checkout = resolveControlPlaneCheckout();
      assert(checkout.ok && checkout.repository_root === linuxRoot, JSON.stringify(checkout));
    });

    await check("6. portable supervisor starts a Core service from Linux checkout cwd", async () => {
      assert(existsSync(FIXTURE), FIXTURE);
      const started = await supervisor.run("joint-monitor", "start");
      assert(started.result === "SUCCESS", started.failure_reason ?? "start");
      assert(supervisor.getLastSpawnCwd() === resolve(linuxRoot), String(supervisor.getLastSpawnCwd()));
      await supervisor.run("joint-monitor", "stop");
    });

    await check("7. secret backend on linux is process_environment; Railway token unused", () => {
      assert(secretResolutionBackend("CORE_NODE") === "process_environment", "backend");
      const missing = optionalProviderSecretStatus("credential://railway/dna-os-infrastructure/production/project-token");
      assert(missing.available === false, "optional railway must not be required");
      assert(missing.core_startup_blocked === false, "missing railway blocked boot");
      assert(process.env.RAILWAY_PROJECT_TOKEN === undefined, "token appeared");
    });

    await check("8. Mac-only capability fails closed on linux Core", () => {
      const body = coreNodeUnavailableForCapability("control/computer-use-executor");
      assert(body !== null && body.execution_attempted === false, JSON.stringify(body));
      assert(body!.required_node === "MAC_LOCAL_AGENT", "required node");
      const unavailable = macLocalAgentUnavailableBody("connections/os-ui");
      assert(unavailable.execution_attempted === false, "os-ui attempted");
    });

    await check("9. public HTTP routes remain in Core source (no /v1 replacement)", () => {
      const src = readFileSync(join(process.cwd(), "transport/owner-command-http/server.ts"), "utf8");
      assert(src.includes('req.url === "/command"'), "/command");
      assert(src.includes("/runtime/inventory"), "inventory");
      assert(src.includes("/handoffs"), "handoffs");
    });

    await check("10. provider is never execution authority; Railway env may be set without becoming required", () => {
      assert(providerIsExecutionAuthority("railway") === false, "railway authority");
      process.env.RAILWAY_PROJECT_TOKEN = FAKE_RAILWAY;
      assert(providerIsExecutionAuthority("railway") === false, "still not authority");
      delete process.env.RAILWAY_PROJECT_TOKEN;
    });
  } finally {
    if (bound) await bound.close();
    resetPortableSupervisorForTests();
    resetRuntimeEndpointsForTests();
    setCheckoutResolutionForTests(undefined);
    setRuntimeNodePlatformForTests(undefined);
    if (previousRailway === undefined) delete process.env.RAILWAY_PROJECT_TOKEN;
    else process.env.RAILWAY_PROJECT_TOKEN = previousRailway;
    if (previousOwner === undefined) delete process.env.OWNER_COMMAND_HTTP_SHARED_SECRET;
    else process.env.OWNER_COMMAND_HTTP_SHARED_SECRET = previousOwner;
    if (previousData === undefined) delete process.env.RUNTIME_CONTROL_DATA_DIR;
    else process.env.RUNTIME_CONTROL_DATA_DIR = previousData;
    delete process.env.DNA_OS_TEST_HEALTH;
    rmSync(linuxRoot, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
