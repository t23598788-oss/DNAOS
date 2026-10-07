/**
 * Supervisor interface over the single SERVICES catalog.
 * LaunchdSupervisor — MAC_LOCAL_AGENT / darwin.
 * PortableProcessSupervisor — CORE_NODE (non-darwin).
 */

import type { Action, OperationEvidence, ProcessLifecycleState, ServiceId } from "./types";
import type { RuntimeOperationRequest } from "./requester";

export interface SupervisorInspect {
  readonly service_id: string;
  readonly lifecycle: ProcessLifecycleState;
  readonly pid: number | null;
  readonly health_http_status: number | null;
  readonly health_healthy: boolean;
  readonly last_exit_code: number | null;
  readonly last_exit_signal: string | null;
  readonly failure_reason: string | null;
}

export interface ProcessSupervisor {
  run(serviceId: ServiceId, action: Action, request?: RuntimeOperationRequest): Promise<OperationEvidence>;
  inspect(serviceId: string): SupervisorInspect;
}
