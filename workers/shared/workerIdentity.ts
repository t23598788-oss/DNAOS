/** Shared adapter and service-principal validation helpers for Gateway-only ingestion Workers. */
export interface AdapterPrincipal {
  adapterId: string;
  apiToken: string;
  requestId: string;
  capability: string;
}

export interface WorkerDatabaseEnv {
  GATEWAY_INTERNAL_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export class BoundaryError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BoundaryError";
    this.status = status;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function equalSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length || a.length === 0) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

export function requireGatewayPrincipal(request: Request, env: WorkerDatabaseEnv, expectedCapability: string): AdapterPrincipal {
  const suppliedGatewaySecret = request.headers.get("x-dna-gateway-secret") ?? "";
  if (!env.GATEWAY_INTERNAL_SECRET || !equalSecret(suppliedGatewaySecret, env.GATEWAY_INTERNAL_SECRET)) {
    throw new BoundaryError("gateway_only", 403);
  }
  const requestId = request.headers.get("x-dna-request-id") ?? "";
  const adapterId = request.headers.get("x-adapter-id") ?? "";
  const apiToken = request.headers.get("x-adapter-token") ?? "";
  const capability = request.headers.get("x-dna-capability") ?? "";
  if (!UUID_RE.test(requestId) || !UUID_RE.test(adapterId) || apiToken.length < 32 || apiToken.length > 256
      || capability !== expectedCapability) {
    throw new BoundaryError("adapter_identity_invalid", 401);
  }
  return { adapterId, apiToken, requestId, capability };
}

export async function digestReference(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function callServiceRpc<T>(
  env: WorkerDatabaseEnv,
  functionName: string,
  body: Record<string, unknown>,
): Promise<{ response: Response; data: T | null }> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new BoundaryError("database_not_configured", 503);
  }
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      "content-profile": "system",
      "accept-profile": "system",
    },
    body: JSON.stringify(body),
  });
  let data: T | null = null;
  try { data = await response.json() as T; } catch { /* Never expose the upstream body. */ }
  return { response, data };
}

const ALLOWED_REASONS = new Set([
  "adapter_unknown", "adapter_inactive", "token_hash_mismatch",
  "binding_inactive_or_expired", "capability_denied", "tenant_scope_denied",
  "target_owner_mismatch", "target_not_found", "invalid_identity",
]);

export async function recordAuthorizationRejection(
  env: WorkerDatabaseEnv,
  requestId: string,
  adapterId: string,
  operation: string,
  reason: string,
  targetRef?: string | null,
): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !UUID_RE.test(adapterId)) return;
  const safeReason = ALLOWED_REASONS.has(reason) ? reason : "invalid_identity";
  try {
    await callServiceRpc(env, "log_worker_authorization_rejection", {
      p_request_id: UUID_RE.test(requestId) ? requestId : crypto.randomUUID(),
      p_adapter_id: adapterId,
      p_operation: operation,
      p_reason_code: safeReason,
      p_target_ref: await digestReference(targetRef),
    });
  } catch {
    // The structured edge log remains available if the audit RPC is unavailable.
  }
}

export function safeFailureLog(input: {
  requestId: string | null;
  adapterId: string | null;
  operation: string;
  reasonCode: string;
}): void {
  console.warn(JSON.stringify({
    event: "worker_request_rejected",
    request_id: input.requestId,
    adapter_id: input.adapterId,
    operation: input.operation,
    reason_code: input.reasonCode,
  }));
}

export function rpcReasonCode(data: unknown): string {
  const details = data && typeof data === "object" ? String((data as Record<string, unknown>).details ?? "") : "";
  return ALLOWED_REASONS.has(details) ? details : "capability_denied";
}

export function rpcStatus(code: string | undefined): number {
  switch (code) {
    case "42501": return 403;
    case "P0002": return 404;
    case "23505": return 409;
    case "23514": return 400;
    case "22023": return 400;
    default: return 502;
  }
}

export { UUID_RE };
