/**
 * Step 5 — portable CORE_NODE supervisor.
 * Harmless fixture children only. Never starts production services.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setRuntimeNodePlatformForTests } from "../../../contracts/architecture/runtime-node-and-optional-provider";
import { setCheckoutResolutionForTests } from "../../../software/repository-registry/contract";
import type { RepositoryRegistration } from "../../../software/repository-registry/contract";
import { SERVICES } from "../host-runtime";
import { PortableProcessSupervisor } from "../portable-supervisor";
import { serviceNodeEligibility } from "../service-eligibility";
import { runOperation } from "../resolver";
import type { ServiceDefinition, ServiceId } from "../types";

declare const process: { env: Record<string, string | undefined>; execPath: string; cwd(): string; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const FAKE_SECRET = "fake-step5-secret-never-production";
const FIXTURE = join(process.cwd(), "control/runtime-control/tests/fixtures/portable-http-child.cjs");

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fixtureDef(id: ServiceId, port: number, extraEnv: readonly string[] = []): ServiceDefinition {
  const base = SERVICES[id];
  return {
    ...base,
    port,
    health_path: "/health",
    health_expect_status: 200,
    readiness_timeout_ms: 5_000,
    portable_process: {
      argv: [process.execPath, FIXTURE],
      env_allowlist: ["DNA_OS_TEST_HEALTH", "DNA_OS_TEST_CRASH_MS", "OWNER_COMMAND_HTTP_SHARED_SECRET", ...extraEnv],
    },
  };
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), "dnaos-runtime-control-"));
  const previousData = process.env.RUNTIME_CONTROL_DATA_DIR;
  process.env.RUNTIME_CONTROL_DATA_DIR = dataDir;
  mkdirSync(dataDir, { recursive: true });
  const previousSecret = process.env.OWNER_COMMAND_HTTP_SHARED_SECRET;
  process.env.OWNER_COMMAND_HTTP_SHARED_SECRET = FAKE_SECRET;

  try {
    await check("existing ServiceDefinition remains canonical (one SERVICES catalog)", () => {
      assert(SERVICES["joint-monitor"].service_id === "joint-monitor", "joint-monitor missing");
      assert(SERVICES["owner-command-http"].service_id === "owner-command-http", "owner-command-http not enrolled");
      assert(SERVICES["owner-command-http"].launchd_job === "not_installed", "must not join launchd boot");
      const src = readFileSync(join(process.cwd(), "control/runtime-control/portable-supervisor.ts"), "utf8");
      assert(!src.includes("railway") && !src.includes("vercel"), "supervisor depends on optional provider");
    });

    await check("CORE_NODE-capable vs MAC_LOCAL_AGENT_ONLY vs UNKNOWN", () => {
      assert(serviceNodeEligibility("joint-monitor") === "CORE_NODE_CAPABLE", "joint-monitor");
      assert(serviceNodeEligibility("dna-os-mcp") === "CORE_NODE_CAPABLE", "mcp");
      assert(serviceNodeEligibility("owner-command-http") === "CORE_NODE_CAPABLE", "owner-command-http");
      assert(serviceNodeEligibility("dna-os-circuit") === "CORE_NODE_CAPABLE", "circuit");
      assert(serviceNodeEligibility("machine-observer") === "MAC_LOCAL_AGENT_ONLY", "observer");
      assert(serviceNodeEligibility("control-workspace") === "MAC_LOCAL_AGENT_ONLY", "workspace");
      assert(serviceNodeEligibility("recovery-supervisor") === "MAC_LOCAL_AGENT_ONLY", "recovery");
      assert(serviceNodeEligibility("deadboard") === "UNKNOWN", "deadboard");
      assert(serviceNodeEligibility("lab-ui") === "UNKNOWN", "lab-ui");
    });

    await check("CORE_NODE can start an eligible portable service; status RUNNING", async () => {
      setRuntimeNodePlatformForTests("linux");
      const port = 18000 + Math.floor(Math.random() * 1000);
      const catalog = { "joint-monitor": fixtureDef("joint-monitor", port) };
      const sup = new PortableProcessSupervisor({ catalog, cwd: process.cwd() });
      const started = await sup.run("joint-monitor", "start");
      assert(started.result === "SUCCESS", started.failure_reason ?? "start failed");
      assert(started.pid_after !== null, "no pid");
      assert(sup.inspect("joint-monitor").lifecycle === "RUNNING", sup.inspect("joint-monitor").lifecycle);
      const health = await sup.run("joint-monitor", "health");
      assert(health.health_after.http_status === 200, String(health.health_after.http_status));
      assert(health.health_after.healthy === true, "not healthy");
      await sup.run("joint-monitor", "stop");
    });

    await check("health check distinguishes healthy/unhealthy", async () => {
      setRuntimeNodePlatformForTests("linux");
      const port = 19000 + Math.floor(Math.random() * 1000);
      process.env.DNA_OS_TEST_HEALTH = "unhealthy";
      const catalog = { "dna-os-mcp": fixtureDef("dna-os-mcp", port) };
      const sup = new PortableProcessSupervisor({ catalog, cwd: process.cwd() });
      const started = await sup.run("dna-os-mcp", "start");
      assert(started.result === "FAILED", "unhealthy child should fail readiness");
      assert(sup.inspect("dna-os-mcp").lifecycle === "UNHEALTHY", sup.inspect("dna-os-mcp").lifecycle);
      assert(started.health_after.http_status === 503, String(started.health_after.http_status));
      await sup.run("dna-os-mcp", "stop");
      delete process.env.DNA_OS_TEST_HEALTH;
    });

    await check("stop terminates only the intended child", async () => {
      setRuntimeNodePlatformForTests("linux");
      const portA = 20000 + Math.floor(Math.random() * 500);
      const portB = portA + 1;
      const catalog = {
        "joint-monitor": fixtureDef("joint-monitor", portA),
        "dna-os-mcp": fixtureDef("dna-os-mcp", portB),
      };
      const sup = new PortableProcessSupervisor({ catalog, cwd: process.cwd() });
      const a = await sup.run("joint-monitor", "start");
      const b = await sup.run("dna-os-mcp", "start");
      assert(a.result === "SUCCESS" && b.result === "SUCCESS", "both should start");
      const pidB = b.pid_after;
      await sup.run("joint-monitor", "stop");
      assert(sup.inspect("joint-monitor").lifecycle === "STOPPED" || sup.inspect("joint-monitor").pid === null, "A not stopped");
      assert(sup.inspect("dna-os-mcp").pid === pidB, "B pid changed");
      assert(sup.inspect("dna-os-mcp").lifecycle === "RUNNING", "B was stopped");
      await sup.run("dna-os-mcp", "stop");
    });

    await check("restart works", async () => {
      setRuntimeNodePlatformForTests("linux");
      const port = 21000 + Math.floor(Math.random() * 500);
      const catalog = { "owner-command-http": fixtureDef("owner-command-http", port) };
      const sup = new PortableProcessSupervisor({ catalog, cwd: process.cwd() });
      const first = await sup.run("owner-command-http", "start");
      assert(first.result === "SUCCESS", first.failure_reason ?? "start");
      const restarted = await sup.run("owner-command-http", "restart");
      assert(restarted.result === "SUCCESS", restarted.failure_reason ?? "restart");
      assert(restarted.pid_after !== null, "restart pid");
      assert(restarted.pid_after !== first.pid_after, "pid did not change");
      await sup.run("owner-command-http", "stop");
    });

    await check("unknown service fails closed", async () => {
      setRuntimeNodePlatformForTests("linux");
      const catalog = { "joint-monitor": fixtureDef("joint-monitor", 22001) };
      const sup = new PortableProcessSupervisor({ catalog, cwd: process.cwd() });
      const ev = await sup.run("lab-ui", "start");
      assert(ev.result === "FAILED", "unknown/missing in catalog must fail");
      assert(typeof ev.failure_reason === "string" && ev.failure_reason.length > 0, "reason");
    });

    await check("MAC_LOCAL_AGENT_ONLY service is denied on CORE_NODE", async () => {
      setRuntimeNodePlatformForTests("linux");
      const catalog = { "machine-observer": fixtureDef("machine-observer", 22002) };
      const sup = new PortableProcessSupervisor({ catalog, cwd: process.cwd() });
      const ev = await sup.run("machine-observer", "start");
      assert(ev.result === "FAILED", "Mac-only started");
      assert((ev.failure_reason ?? "").includes("MAC_LOCAL_AGENT"), ev.failure_reason ?? "");
      assert(sup.inspect("machine-observer").pid === null, "spawned Mac service");
    });

    await check("Launchd path remains unchanged on darwin", async () => {
      setRuntimeNodePlatformForTests("darwin");
      const resolverSrc = readFileSync(join(process.cwd(), "control/runtime-control/resolver.ts"), "utf8");
      assert(resolverSrc.includes("launchctlKickstart"), "launchd kickstart removed");
      assert(resolverSrc.includes("portableSupervisorActive"), "dispatch missing");
      const ev = await runOperation("joint-monitor", "status");
      assert(ev.service_id === "joint-monitor", "status service");
      assert(typeof ev.launchd_label === "string" && ev.launchd_label.includes("joint-monitor"), ev.launchd_label);
    });

    await check("child crash is observed without infinite restart", async () => {
      setRuntimeNodePlatformForTests("linux");
      process.env.DNA_OS_TEST_CRASH_MS = "80";
      const port = 23000 + Math.floor(Math.random() * 500);
      const catalog = { "joint-monitor": fixtureDef("joint-monitor", port) };
      const sup = new PortableProcessSupervisor({ catalog, cwd: process.cwd() });
      await sup.run("joint-monitor", "start");
      const start = Date.now();
      let snap = sup.inspect("joint-monitor");
      while (Date.now() - start < 3000 && snap.lifecycle !== "FAILED") {
        await new Promise((r) => setTimeout(r, 50));
        snap = sup.inspect("joint-monitor");
      }
      assert(snap.lifecycle === "FAILED", snap.lifecycle);
      assert(snap.pid === null, "live pid must clear after unexpected exit");
      assert(snap.last_exit_code === 2 || snap.failure_reason !== null, String(snap.last_exit_code));
      await new Promise((r) => setTimeout(r, 200));
      const later = sup.inspect("joint-monitor");
      assert(later.lifecycle === "FAILED", "auto-restarted");
      assert(later.pid === null, "pid still published after exit");
      delete process.env.DNA_OS_TEST_CRASH_MS;
    });

    await check("P1: second supervisor refuses start when port already has orphan listener", async () => {
      setRuntimeNodePlatformForTests("linux");
      const port = 26000 + Math.floor(Math.random() * 500);
      const catalog = { "joint-monitor": fixtureDef("joint-monitor", port) };
      const first = new PortableProcessSupervisor({ catalog, cwd: process.cwd() });
      const started = await first.run("joint-monitor", "start");
      assert(started.result === "SUCCESS", started.failure_reason ?? "first start");
      const second = new PortableProcessSupervisor({ catalog, cwd: process.cwd() });
      const dup = await second.run("joint-monitor", "start");
      assert(dup.result === "FAILED", "duplicate start must fail");
      assert((dup.failure_reason ?? "").includes("not owned"), dup.failure_reason ?? "");
      await first.run("joint-monitor", "stop");
    });

    await check("P1: Mac-only health/status denied on Core (no fixed-port probe success)", async () => {
      setRuntimeNodePlatformForTests("linux");
      const catalog = { "machine-observer": fixtureDef("machine-observer", 22003) };
      const sup = new PortableProcessSupervisor({ catalog, cwd: process.cwd() });
      const health = await sup.run("machine-observer", "health");
      assert(health.result === "FAILED", "health must deny");
      assert((health.failure_reason ?? "").includes("MAC_LOCAL_AGENT"), health.failure_reason ?? "");
      const status = await sup.run("machine-observer", "status");
      assert(status.result === "FAILED", "status must deny");
    });

    await check("P1: Core credential env names are explicitly allowlisted for owner-command-http", () => {
      const allow = SERVICES["owner-command-http"].portable_process?.env_allowlist ?? [];
      for (const name of [
        "GITHUB_PAT_INFRASTRUCTURE",
        "GITHUB_WEBHOOK_SECRET_INFRASTRUCTURE",
        "RAILWAY_PROJECT_TOKEN",
        "SUPABASE_SCHEMA_READ_TOKEN",
      ]) {
        assert(allow.includes(name), `missing ${name}`);
      }
      const src = readFileSync(join(process.cwd(), "control/runtime-control/host-runtime.ts"), "utf8");
      assert(src.includes("CORE_PROCESS_ENV_BINDINGS"), "must compose existing process-environment authority");
      assert(!/Object\.assign\(.*process\.env|\{ \.\.\.process\.env/.test(src), "must not dump parent env wholesale");
    });

    await check("secret values are not present in logs/status", async () => {
      setRuntimeNodePlatformForTests("linux");
      const port = 24000 + Math.floor(Math.random() * 500);
      const catalog = { "owner-command-http": fixtureDef("owner-command-http", port) };
      const sup = new PortableProcessSupervisor({ catalog, cwd: process.cwd() });
      const started = await sup.run("owner-command-http", "start");
      const inspect = JSON.stringify(sup.inspect("owner-command-http"));
      const evidence = JSON.stringify(started);
      assert(!inspect.includes(FAKE_SECRET), "inspect leaked secret");
      assert(!evidence.includes(FAKE_SECRET), "evidence leaked secret");
      await sup.run("owner-command-http", "stop");
    });

    await check("CORE_NODE portable supervisor uses resolved node-local root as cwd", async () => {
      setRuntimeNodePlatformForTests("linux");
      const linuxRoot = mkdtempSync(join(tmpdir(), "dnaos-supervisor-cwd-"));
      execFileSync("git", ["init", "-b", "main"], { cwd: linuxRoot });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: linuxRoot });
      execFileSync("git", ["config", "user.name", "test"], { cwd: linuxRoot });
      execFileSync("git", ["remote", "add", "origin", "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-.git"], { cwd: linuxRoot });
      writeFileSync(join(linuxRoot, "README.md"), "supervisor-cwd\n");
      execFileSync("git", ["add", "."], { cwd: linuxRoot });
      execFileSync("git", ["commit", "-m", "initial"], { cwd: linuxRoot });
      const row: RepositoryRegistration = {
        repository_id: "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-",
        owner: "t23598788-oss",
        repository: "-DNA-OS-INFRASTRUCTURE-",
        world: "CONTROL_PLANE",
        source_authority: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-.git",
        default_branch: "main",
        repository_root: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE",
        connection_id: null,
        status: "ACTIVE",
        registered_at: "2026-01-01T00:00:00.000Z",
      };
      setCheckoutResolutionForTests({
        lookup: {
          getRepository: (id) => (id === row.repository_id ? row : null),
          listOperationalRepositories: () => [row],
        },
        host: {
          cwd: () => linuxRoot,
          exists: (p) => {
            if (resolve(p) === resolve("/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE")) return false;
            return existsSync(p);
          },
        },
      });
      const port = 25000 + Math.floor(Math.random() * 500);
      const catalog = { "joint-monitor": fixtureDef("joint-monitor", port) };
      const sup = new PortableProcessSupervisor({ catalog });
      const started = await sup.run("joint-monitor", "start");
      assert(started.result === "SUCCESS", started.failure_reason ?? "start failed");
      assert(sup.getLastSpawnCwd() === resolve(linuxRoot), String(sup.getLastSpawnCwd()));
      await sup.run("joint-monitor", "stop");
      setCheckoutResolutionForTests(undefined);
      rmSync(linuxRoot, { recursive: true, force: true });
    });

    await check("no Railway/Vercel dependency is required to supervise a Core process", () => {
      const portable = readFileSync(join(process.cwd(), "control/runtime-control/portable-supervisor.ts"), "utf8");
      const eligibility = readFileSync(join(process.cwd(), "control/runtime-control/service-eligibility.ts"), "utf8");
      assert(!/railway|vercel/i.test(portable), "portable imports optional provider");
      assert(!/railway|vercel/i.test(eligibility), "eligibility imports optional provider");
    });
  } finally {
    setRuntimeNodePlatformForTests(undefined);
    setCheckoutResolutionForTests(undefined);
    if (previousData === undefined) delete process.env.RUNTIME_CONTROL_DATA_DIR;
    else process.env.RUNTIME_CONTROL_DATA_DIR = previousData;
    if (previousSecret === undefined) delete process.env.OWNER_COMMAND_HTTP_SHARED_SECRET;
    else process.env.OWNER_COMMAND_HTTP_SHARED_SECRET = previousSecret;
    delete process.env.DNA_OS_TEST_HEALTH;
    delete process.env.DNA_OS_TEST_CRASH_MS;
    rmSync(dataDir, { recursive: true, force: true });
  }

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
