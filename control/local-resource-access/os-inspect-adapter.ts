/**
 * Read-only OS inspection. Mutation verbs (kill, chmod, mount, sudo) are not implemented.
 */

import { networkInterfaces, loadavg, freemem, totalmem, uptime } from "node:os";
import { emitLocalResourceEvent } from "./events";
import { runRegisteredJob } from "./process-adapter";
import { classifyAnomaly } from "./anomaly";
import type { LocalResourceV1 } from "./types";

function minimizeProcessLines(stdout: string): readonly Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 6) continue;
    const [pid, ppid, pcpu, pmem, state, ...comm] = parts;
    rows.push({
      logical_ref: `process://${pid}`,
      pid,
      ppid,
      pcpu,
      pmem,
      state,
      comm: comm.join(" ").slice(0, 80),
    });
    if (rows.length >= 20) break;
  }
  return rows;
}

function minimizePorts(stdout: string): readonly Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (const line of stdout.split("\n")) {
    const match = line.match(/:(\d+)\s+\(LISTEN\)|:(\d+)$/);
    const port = match?.[1] ?? match?.[2];
    if (!port) continue;
    const name = line.split(/\s+/)[0] ?? "unknown";
    items.push({ logical_ref: `port://tcp/${port}`, port, comm: name.slice(0, 40) });
    if (items.length >= 20) break;
  }
  return items;
}

export async function osProcessList(resource: LocalResourceV1, work_id: string, session_id: string): Promise<{ ok: boolean; result: Record<string, unknown>; reason_code?: string }> {
  const job = await runRegisteredJob(resource, "local.os.ps-list", work_id);
  if (!job.ok) return { ok: false, result: {}, reason_code: job.reason_code };
  const processes = minimizeProcessLines(job.stdout);
  emitLocalResourceEvent("PROCESS_DISCOVERED", work_id, `count=${processes.length}`, undefined, {
    session_id, resource_id: resource.resource_id, authority_decision: "ALLOW", locality: "LOCAL",
  });
  const cpu = processes.find((row) => Number(row.pcpu) >= 80);
  if (cpu) classifyAnomaly("CPU_SPIKE", `pid=${String(cpu.pid)}`, work_id, session_id, resource.resource_id);
  return { ok: true, result: { processes, locality: "LOCAL", mutation: false } };
}

export async function osProcessInspect(resource: LocalResourceV1, work_id: string, session_id: string, pid: string): Promise<{ ok: boolean; result: Record<string, unknown>; reason_code?: string }> {
  const job = await runRegisteredJob(resource, "local.os.ps-inspect", work_id, { pid });
  if (!job.ok) return { ok: false, result: {}, reason_code: job.reason_code };
  const processes = minimizeProcessLines(job.stdout);
  emitLocalResourceEvent("PROCESS_INSPECTED", work_id, `pid=${pid}`, undefined, {
    session_id, resource_id: resource.resource_id, authority_decision: "ALLOW", locality: "LOCAL",
  });
  return { ok: true, result: { process: processes[0] ?? null, locality: "LOCAL", mutation: false } };
}

export async function osPortList(resource: LocalResourceV1, work_id: string, session_id: string): Promise<{ ok: boolean; result: Record<string, unknown>; reason_code?: string }> {
  const job = await runRegisteredJob(resource, "local.os.lsof-listen", work_id);
  if (!job.ok) return { ok: false, result: {}, reason_code: job.reason_code };
  const ports = minimizePorts(job.stdout);
  emitLocalResourceEvent("PORT_DISCOVERED", work_id, `count=${ports.length}`, undefined, {
    session_id, resource_id: resource.resource_id, authority_decision: "ALLOW", locality: "LOCAL",
  });
  return { ok: true, result: { ports, locality: "LOCAL", mutation: false } };
}

export function osNetworkSummary(resource: LocalResourceV1, work_id: string, session_id: string): Record<string, unknown> {
  const ifaces = networkInterfaces();
  const names = Object.keys(ifaces).slice(0, 8).map((name) => ({
    logical_ref: `net://${name}`,
    name,
    addresses: (ifaces[name] ?? []).filter((row) => !row.internal).map((row) => ({ family: row.family, cidr: row.cidr })),
  }));
  emitLocalResourceEvent("NETWORK_DESTINATION_OBSERVED", work_id, "summary-only", undefined, {
    session_id, resource_id: resource.resource_id, authority_decision: "ALLOW", locality: "LOCAL",
  });
  return { interfaces: names, locality: "LOCAL", destinations_enumerated: false };
}

export async function osDiskSummary(resource: LocalResourceV1, work_id: string): Promise<{ ok: boolean; result: Record<string, unknown>; reason_code?: string }> {
  const job = await runRegisteredJob(resource, "local.os.df", work_id);
  if (!job.ok) return { ok: false, result: {}, reason_code: job.reason_code };
  const lines = job.stdout.split("\n").filter(Boolean).slice(0, 8);
  return { ok: true, result: { mounts: lines.map((line) => line.slice(0, 160)), locality: "LOCAL" } };
}

export async function osMountList(resource: LocalResourceV1, work_id: string): Promise<{ ok: boolean; result: Record<string, unknown>; reason_code?: string }> {
  const job = await runRegisteredJob(resource, "local.os.mount", work_id);
  if (!job.ok) return { ok: false, result: {}, reason_code: job.reason_code };
  const mounts = job.stdout.split("\n").filter(Boolean).slice(0, 12).map((line) => ({ logical_ref: "mount://registered", summary: line.slice(0, 120) }));
  return { ok: true, result: { mounts, locality: "LOCAL" } };
}

export function osServiceStatus(resource: LocalResourceV1): Record<string, unknown> {
  return {
    services: [{ resource_id: resource.resource_id, status: resource.availability, mutation: false }],
    locality: "LOCAL",
  };
}

export function osResourceUsage(resource: LocalResourceV1, work_id: string, session_id: string): Record<string, unknown> {
  const load = loadavg();
  const mem = { free_bytes: freemem(), total_bytes: totalmem() };
  if (load[0]! >= 16) classifyAnomaly("CPU_SPIKE", `load1=${load[0]}`, work_id, session_id, resource.resource_id);
  if (mem.free_bytes / mem.total_bytes < 0.05) classifyAnomaly("MEMORY_SPIKE", "low-free-memory", work_id, session_id, resource.resource_id);
  return {
    loadavg: load,
    memory: mem,
    uptime_seconds: Math.floor(uptime()),
    locality: "LOCAL",
  };
}
