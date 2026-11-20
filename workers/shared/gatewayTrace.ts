/** Request-scoped audit trace fields and safe structured event logging for the DNA OS Gateway. */
export interface GatewayTrace {
  requestId: string;
  capabilityId: string | null;
  actorId: string | null;
  adapterId: string | null;
  organizationId: string | null;
  companyId: string | null;
  startedAt: number;
  rpcAuthorized: boolean;
  scopeEvidence: "not_resolved" | "database_response" | "authorized_resource_read";
}

// This symbol is only carried on a fresh server-created Env object per request.
// No client header or JSON property can supply this context.
export const GATEWAY_TRACE = Symbol("dnaos.gateway.trace");

export function traceEvent(trace: GatewayTrace | undefined, event: string, fields: {
  outcome?: string; status?: number; backend?: string; reasonCode?: string;
} = {}): void {
  if (!trace) return;
  console.log(JSON.stringify({
    event, request_id: trace.requestId, capability_id: trace.capabilityId,
    actor_user_id: trace.actorId, organization_id: trace.organizationId,
    adapter_id: trace.adapterId,
    principal_type: trace.actorId ? "authenticated_user" : trace.adapterId ? "verified_adapter_service" : "unverified",
    company_id: trace.companyId, authorization: trace.rpcAuthorized ? "rpc_verified" : "not_yet_verified",
    scope_evidence: trace.scopeEvidence,
    occurred_at: new Date().toISOString(), elapsed_ms: Math.max(0, Date.now() - trace.startedAt),
    ...(fields.outcome ? { outcome: fields.outcome } : {}),
    ...(fields.status !== undefined ? { status: fields.status } : {}),
    ...(fields.backend ? { backend: fields.backend } : {}),
    ...(fields.reasonCode ? { reason_code: fields.reasonCode } : {}),
  }));
}

export function verifiedRpcContext(trace: GatewayTrace | undefined, value: unknown): void {
  if (!trace) return;
  trace.rpcAuthorized = true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  // Only DB response IDs, never input parameters, become verified trace scope.
  if (typeof row.organization_id === "string" && uuid.test(row.organization_id)) {
    trace.organizationId = row.organization_id;
    trace.scopeEvidence = "database_response";
  }
  if (typeof row.company_id === "string" && uuid.test(row.company_id)) trace.companyId = row.company_id;
}
