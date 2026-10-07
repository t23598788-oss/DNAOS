/**
 * หน้าที่: the public boundary of `control/agent-host/`.
 *
 * Input: re-exports only.
 * Output: `launchAgent`, `listActiveLaunches`, `killLaunch` (added
 * 2026-08-22 — see ./host.ts's header), plus every type a caller needs.
 * Dependency ที่อนุญาต: ./host.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export ./host-runtime.ts here — private implementation.
 */

export { killLaunch, launchAgent, listActiveLaunches } from "./host";
export type { ActiveLaunch, AgentLaunchRequest, AgentLaunchResult } from "./types";
export { resolveWorker, listWorkerKinds } from "./worker-registry";
export type { WorkerKind, WorkerDefinition, WorkerResolution } from "./worker-registry";
