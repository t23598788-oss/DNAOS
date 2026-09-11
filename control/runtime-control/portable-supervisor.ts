/**
 * CORE_NODE process supervisor: spawn / stop / restart / health / status
 * against the canonical SERVICES catalog. Never launchctl. Never an
 * infinite restart loop. Never enumerates process.env.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { canExecuteMacLocalAgentCapability, MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE } from "../../contracts/architecture/runtime-node-and-optional-provider";
import { resolveControlPlaneCheckout } from "../../software/repository-registry/contract";
import { buildRequesterProvenance } from "./requester";
import type { RuntimeOperationRequest } from "./requester";
import {
  SERVICES,
  appendEvidence,
  getListeningPids,
  httpHealthCheck,
  newOperationId,
  nowIso,
  sleep,
} from "./host-runtime";
import { isKnownServiceId, serviceNodeEligibility } from "./service-eligibility";
import type { ProcessSupervisor, SupervisorInspect } from "./supervisor";
import type {
  Action,
  HealthCheckResult,
  OperationEvidence,
  ProcessLifecycleState,
  ServiceDefinition,
  ServiceId,
} from "./types";

const READINESS_POLL_INTERVAL_MS = 500;
const STOP_WAIT_MS = 3_000;

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

export type ServiceCatalog = Record<string, ServiceDefinition>;

interface ChildRecord {
  /** Live process id, or null after unexpected exit (exit evidence retained). */
  pid: number | null;
  child: ChildProcess | null;
  lifecycle: ProcessLifecycleState;
  last_exit_code: number | null;
  last_exit_signal: string | null;
  failure_reason: string | null;
  started_at: string;
}

export interface PortableSupervisorOptions {
  readonly catalog?: ServiceCatalog;
  readonly cwd?: string;
  readonly healthCheck?: typeof httpHealthCheck;
  readonly append?: typeof appendEvidence;
}

function emptyInspect(service_id: string, extra: Partial<SupervisorInspect> = {}): SupervisorInspect {
  return {
    service_id,
    lifecycle: "STOPPED",
    pid: null,
    health_http_status: null,
    health_healthy: false,
    last_exit_code: null,
    last_exit_signal: null,
    failure_reason: extra.failure_reason ?? null,
    ...extra,
  };
}

export class PortableProcessSupervisor implements ProcessSupervisor {
  private readonly catalog: ServiceCatalog;
  private readonly explicitCwd: string | undefined;
  private lastSpawnCwd: string | null = null;
  private readonly healthCheck: typeof httpHealthCheck;
  private readonly append: typeof appendEvidence;
  private readonly children = new Map<string, ChildRecord>();

  constructor(options: PortableSupervisorOptions = {}) {
    this.catalog = options.catalog ?? SERVICES;
    this.explicitCwd = options.cwd;
    this.healthCheck = options.healthCheck ?? httpHealthCheck;
    this.append = options.append ?? appendEvidence;
  }

  /** Last spawn cwd, or null if no spawn has succeeded. Tests only. */
  getLastSpawnCwd(): string | null {
    return this.lastSpawnCwd;
  }

  inspect(serviceId: string): SupervisorInspect {
    const rec = this.children.get(serviceId);
    if (!rec) return emptyInspect(serviceId);
    return {
      service_id: serviceId,
      lifecycle: rec.lifecycle,
      pid: rec.pid,
      health_http_status: null,
      health_healthy: rec.lifecycle === "RUNNING",
      last_exit_code: rec.last_exit_code,
      last_exit_signal: rec.last_exit_signal,
      failure_reason: rec.failure_reason,
    };
  }

  async run(serviceId: ServiceId, action: Action, request?: RuntimeOperationRequest): Promise<OperationEvidence> {
    const operation_id = newOperationId();
    const timestamp_started = nowIso();

    if (!isKnownServiceId(serviceId) && !(serviceId in this.catalog)) {
      return this.finishUnknown(serviceId, action, operation_id, timestamp_started, request);
    }

    const def = this.catalog[serviceId];
    if (!def) {
      return this.finishUnknown(serviceId, action, operation_id, timestamp_started, request);
    }

    const eligibility = serviceNodeEligibility(serviceId);
    // Observation actions must not probe Mac-only fixed ports on CORE_NODE.
    if (eligibility === "MAC_LOCAL_AGENT_ONLY") {
      return this.finishDenied(
        def,
        action,
        operation_id,
        timestamp_started,
        request,
        `${MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE}: ${serviceId} is MAC_LOCAL_AGENT_ONLY`,
      );
    }
    if (eligibility === "UNKNOWN" && (action === "start" || action === "restart")) {
      return this.finishDenied(
        def,
        action,
        operation_id,
        timestamp_started,
        request,
        `UNKNOWN service node class for ${serviceId} — CORE_NODE refuses to start it`,
      );
    }

    const healthBefore = await this.probe(def);
    let mutationError: string | null = null;
    const ownedBefore = this.children.get(serviceId);
    const pidBefore = ownedBefore?.pid ?? null;

    if (action === "start") mutationError = await this.startChild(def);
    else if (action === "stop") mutationError = await this.stopChild(serviceId);
    else if (action === "restart") {
      mutationError = await this.stopChild(serviceId);
      if (!mutationError) mutationError = await this.startChild(def);
    }

    let healthAfter: HealthCheckResult;
    let readiness_wait_ms = 0;
    const readiness_deadline_ms = action === "start" || action === "restart" ? def.readiness_timeout_ms : 0;
    if (readiness_deadline_ms > 0 && !mutationError) {
      const ready = await this.waitForReadiness(def, readiness_deadline_ms);
      healthAfter = ready.health;
      readiness_wait_ms = ready.waited_ms;
      const rec = this.children.get(serviceId);
      if (rec && rec.lifecycle !== "FAILED" && rec.lifecycle !== "STOPPED") {
        rec.lifecycle = healthAfter.healthy && healthAfter.http_status === def.health_expect_status ? "RUNNING" : "UNHEALTHY";
      }
    } else {
      healthAfter = await this.probe(def);
      const rec = this.children.get(serviceId);
      if (rec && rec.lifecycle === "RUNNING" && !(healthAfter.healthy && healthAfter.http_status === def.health_expect_status)) {
        rec.lifecycle = "UNHEALTHY";
      }
    }

    const rec = this.children.get(serviceId);
    const pidAfter = rec?.pid ?? null;
    let result: "SUCCESS" | "FAILED" = "SUCCESS";
    let failure_reason: string | null = mutationError;

    if (mutationError) result = "FAILED";
    else if (action === "start" || action === "restart") {
      if (pidAfter === null) {
        result = "FAILED";
        failure_reason = rec?.failure_reason ?? "no PID after start/restart";
      } else if (!(healthAfter.http_status === def.health_expect_status)) {
        result = "FAILED";
        failure_reason = `process is running (pid ${pidAfter}) but did not answer ${def.health_path} with HTTP ${def.health_expect_status} within ${readiness_deadline_ms}ms: ${healthAfter.error ?? `http_status=${healthAfter.http_status}`}`;
        if (rec && rec.lifecycle !== "FAILED" && rec.lifecycle !== "STOPPED") rec.lifecycle = "UNHEALTHY";
      }
    } else if (action === "stop") {
      if (pidAfter !== null && rec?.lifecycle !== "FAILED" && rec?.lifecycle !== "STOPPED") {
        result = "FAILED";
        failure_reason = `process still running (pid ${pidAfter}) after stop`;
      }
    }

    const evidence: OperationEvidence = {
      operation_id,
      service_id: def.service_id,
      launchd_label: def.launchd_label,
      requested_action: action,
      port: def.port,
      pid_before: pidBefore,
      pid_after: pidAfter,
      launchd_loaded_before: false,
      launchd_loaded_after: pidAfter !== null,
      health_before: healthBefore,
      health_after: healthAfter,
      duplicate_check: {
        listening_pids: getListeningPids(def.port),
        duplicate_detected: getListeningPids(def.port).length > 1,
      },
      readiness_wait_ms,
      readiness_deadline_ms,
      timestamp_started,
      timestamp_completed: nowIso(),
      result,
      failure_reason,
      ...buildRequesterProvenance(request),
    };
    this.append(evidence);
    return evidence;
  }

  private probe(def: ServiceDefinition): Promise<HealthCheckResult> {
    return this.healthCheck(def.port, def.health_path);
  }

  private async waitForReadiness(
    def: ServiceDefinition,
    deadlineMs: number,
  ): Promise<{ health: HealthCheckResult; waited_ms: number }> {
    const startedAt = Date.now();
    let health = await this.probe(def);
    while (health.http_status !== def.health_expect_status && Date.now() - startedAt < deadlineMs) {
      await sleep(READINESS_POLL_INTERVAL_MS);
      health = await this.probe(def);
    }
    return { health, waited_ms: Date.now() - startedAt };
  }

  private childEnv(def: ServiceDefinition): Record<string, string | undefined> {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOST: "127.0.0.1",
      PORT: String(def.port),
    };
    const allow = def.portable_process?.env_allowlist ?? [];
    for (const name of allow) {
      if (!ENV_NAME.test(name)) continue;
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    return env;
  }

  private resolveExecutionCwd(): { ok: true; cwd: string } | { ok: false; reason: string } {
    if (this.explicitCwd) return { ok: true, cwd: resolve(this.explicitCwd) };
    const resolved = resolveControlPlaneCheckout();
    if (!resolved.ok) {
      return { ok: false, reason: `CONTROL_PLANE checkout unresolved (${resolved.code}): ${resolved.reason}` };
    }
    return { ok: true, cwd: resolved.repository_root };
  }

  private async startChild(def: ServiceDefinition): Promise<string | null> {
    const existing = this.children.get(def.service_id);
    if (existing && (existing.lifecycle === "STARTING" || existing.lifecycle === "RUNNING" || existing.lifecycle === "UNHEALTHY" || existing.lifecycle === "STOPPING")) {
      return `already has pid ${existing.pid}`;
    }

    // Process ownership: in-memory map alone is not enough across supervisor instances.
    const listeners = getListeningPids(def.port);
    if (listeners.length > 0) {
      return `port ${def.port} already has listener pid(s) ${listeners.join(",")} not owned by this supervisor instance — refuse duplicate start / false readiness`;
    }

    const spec = def.portable_process;
    if (!spec || spec.argv.length === 0) {
      return `no portable_process.argv for ${def.service_id}`;
    }

    const cwdResolved = this.resolveExecutionCwd();
    if (!cwdResolved.ok) return cwdResolved.reason;

    const argv = [...spec.argv];
    const command = argv[0]!;
    const args = argv.slice(1);
    this.lastSpawnCwd = cwdResolved.cwd;
    const child = spawn(command, args, {
      cwd: cwdResolved.cwd,
      env: this.childEnv(def),
      stdio: ["ignore", "ignore", "ignore"],
    });

    // Async spawn failure must become lifecycle evidence, not an uncaught crash.
    const spawnFailure = await new Promise<string | null>((resolveSpawn) => {
      let settled = false;
      const finish = (err: string | null) => {
        if (settled) return;
        settled = true;
        resolveSpawn(err);
      };
      child.once("error", (err) => finish(`spawn failed: ${err instanceof Error ? err.message : String(err)}`));
      child.once("spawn", () => finish(null));
      // Some Node versions assign pid synchronously without emitting "spawn".
      queueMicrotask(() => {
        if (child.pid !== undefined) finish(null);
      });
    });
    if (spawnFailure) return spawnFailure;
    if (child.pid === undefined) return "spawn produced no pid";

    const ownedPid = child.pid;
    const rec: ChildRecord = {
      pid: ownedPid,
      child,
      lifecycle: "STARTING",
      last_exit_code: null,
      last_exit_signal: null,
      failure_reason: null,
      started_at: nowIso(),
    };
    this.children.set(def.service_id, rec);

    child.on("exit", (code, signal) => {
      const current = this.children.get(def.service_id);
      if (!current || current.child !== child) return;
      current.last_exit_code = code;
      current.last_exit_signal = signal;
      // Clear LIVE pid; keep exit evidence on the record until stop/delete.
      current.pid = null;
      if (current.lifecycle === "STOPPING") {
        current.lifecycle = "STOPPED";
        this.children.delete(def.service_id);
        return;
      }
      current.lifecycle = "FAILED";
      current.failure_reason = `exited unexpectedly code=${code ?? "null"} signal=${signal ?? "null"}`;
    });

    return null;
  }

  private async stopChild(serviceId: string): Promise<string | null> {
    const def = this.catalog[serviceId];
    const rec = this.children.get(serviceId);
    if (rec?.child && rec.pid !== null) {
      rec.lifecycle = "STOPPING";
      try {
        rec.child.kill("SIGTERM");
      } catch {
        rec.lifecycle = "STOPPED";
        this.children.delete(serviceId);
        return null;
      }
      const deadline = Date.now() + STOP_WAIT_MS;
      while (Date.now() < deadline && this.children.has(serviceId) && this.children.get(serviceId)?.lifecycle === "STOPPING") {
        await sleep(50);
      }
      const still = this.children.get(serviceId);
      if (still && still.lifecycle === "STOPPING") {
        try {
          still.child?.kill("SIGKILL");
        } catch {
          // already gone
        }
        still.lifecycle = "STOPPED";
        this.children.delete(serviceId);
      }
      return null;
    }

    // No owned child in this instance — refuse to signal unverified port listeners.
    if (!def) return null;
    const listeners = getListeningPids(def.port);
    if (listeners.length === 0) return null;
    return `no owned child for ${serviceId}; port ${def.port} has unverified listener pid(s) ${listeners.join(",")} — refuse kill without ownership proof`;
  }

  private finishUnknown(
    serviceId: ServiceId,
    action: Action,
    operation_id: string,
    timestamp_started: string,
    request?: RuntimeOperationRequest,
  ): OperationEvidence {
    const evidence: OperationEvidence = {
      operation_id,
      service_id: serviceId,
      launchd_label: "",
      requested_action: action,
      port: 0,
      pid_before: null,
      pid_after: null,
      launchd_loaded_before: false,
      launchd_loaded_after: false,
      health_before: { checked_at: timestamp_started, http_status: null, healthy: false, error: "unknown ServiceId" },
      health_after: { checked_at: nowIso(), http_status: null, healthy: false, error: "unknown ServiceId" },
      readiness_wait_ms: 0,
      readiness_deadline_ms: 0,
      timestamp_started,
      timestamp_completed: nowIso(),
      result: "FAILED",
      failure_reason: `unknown ServiceId "${String(serviceId)}"`,
      ...buildRequesterProvenance(request),
    };
    this.append(evidence);
    return evidence;
  }

  private finishDenied(
    def: ServiceDefinition,
    action: Action,
    operation_id: string,
    timestamp_started: string,
    request: RuntimeOperationRequest | undefined,
    reason: string,
  ): OperationEvidence {
    const evidence: OperationEvidence = {
      operation_id,
      service_id: def.service_id,
      launchd_label: def.launchd_label,
      requested_action: action,
      port: def.port,
      pid_before: this.children.get(def.service_id)?.pid ?? null,
      pid_after: this.children.get(def.service_id)?.pid ?? null,
      launchd_loaded_before: false,
      launchd_loaded_after: false,
      health_before: { checked_at: timestamp_started, http_status: null, healthy: false, error: reason },
      health_after: { checked_at: nowIso(), http_status: null, healthy: false, error: reason },
      readiness_wait_ms: 0,
      readiness_deadline_ms: 0,
      timestamp_started,
      timestamp_completed: nowIso(),
      result: "FAILED",
      failure_reason: reason,
      ...buildRequesterProvenance(request),
    };
    this.append(evidence);
    return evidence;
  }
}

let defaultPortable: PortableProcessSupervisor | undefined;

export function getPortableSupervisor(): PortableProcessSupervisor {
  if (!defaultPortable) defaultPortable = new PortableProcessSupervisor();
  return defaultPortable;
}

/** Test-only: isolate pid table between cases. */
export function resetPortableSupervisorForTests(instance?: PortableProcessSupervisor): void {
  defaultPortable = instance;
}

export function portableSupervisorActive(): boolean {
  return !canExecuteMacLocalAgentCapability({ current_node: "CORE_NODE" });
}
