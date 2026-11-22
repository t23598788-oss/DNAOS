import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/services/supabase/queries";
import { readSystemVaultSecret } from "@/services/system-graph/systemVault";

const API_ORIGIN = "https://api.digitalocean.com";

export type DigitalOceanOperation =
  | "catalog.sizes"
  | "catalog.one_clicks"
  | "catalog.database_options"
  | "catalog.regions"
  | "billing.balance"
  | "billing.prepayment_status"
  | "billing.history"
  | "billing.invoices"
  | "billing.insights";

export interface DigitalOceanClient {
  request<T = unknown>(operation: DigitalOceanOperation, path: string, idempotencyKey?: string): Promise<T>;
}

export function digitalOceanAccountUrn(): string | null {
  const urn = process.env.DIGITALOCEAN_ACCOUNT_URN ?? "";
  return /^do:(team|teamgroup):[A-Za-z0-9-]+$/.test(urn) ? urn : null;
}

export class DigitalOceanRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number, code: "DIGITALOCEAN_RATE_LIMITED" | "DIGITALOCEAN_RATE_QUEUE_BUSY") {
    super(code);
    this.name = "DigitalOceanRateLimitError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validPath(path: string): boolean {
  return path.startsWith("/v2/") && !path.startsWith("//") && !path.includes("..") && !/[\r\n]/.test(path);
}

async function insertUsageEvent(input: {
  idempotencyKey: string;
  requestId: string;
  operation: DigitalOceanOperation;
  path: string;
  status: number | null;
  outcome: "succeeded" | "failed" | "blocked";
  latencyMs: number;
  responseBytes?: number | null;
  errorCode?: string | null;
}): Promise<boolean> {
  const { error } = await supabaseAdmin().from("do_usage_events").upsert({
    idempotency_key: input.idempotencyKey,
    request_id: input.requestId,
    method: "GET",
    api_path: input.path.slice(0, 500),
    operation: input.operation,
    status_code: input.status,
    outcome: input.outcome,
    latency_ms: Math.max(0, Math.floor(input.latencyMs)),
    estimated_resource_cost_usd: 0,
    response_bytes: input.responseBytes ?? null,
    error_code: input.errorCode ?? null,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  return !error;
}

/** All DigitalOcean control-plane requests in this feature go through here.
 * This first increment deliberately exposes read-only catalog/billing calls;
 * resource-mutating operations are not proxied until they have a priced,
 * reserved budget contract. Provider resource spend is not the API-call fee. */
export async function createMeteredDigitalOceanClient(): Promise<DigitalOceanClient> {
  const db = supabaseAdmin();

  const client: DigitalOceanClient = {
    async request<T>(operation: DigitalOceanOperation, path: string, requestedIdempotencyKey?: string): Promise<T> {
      if (!validPath(path)) throw new Error("DIGITALOCEAN_PATH_NOT_ALLOWED");
      const requestId = randomUUID();
      const idempotencyKey = requestedIdempotencyKey?.trim().slice(0, 240) || requestId;
      const rawRequest = async (targetOperation: DigitalOceanOperation, targetPath: string, key: string) => {
        const started = Date.now();
        const { data: permitRows, error: permitError } = await db.rpc("do_rate_limit_reserve_slot", { p_interval_milliseconds: 750 });
        if (permitError || !Array.isArray(permitRows) || typeof permitRows[0]?.permit_at !== "string") {
          const logged = await insertUsageEvent({ idempotencyKey: key, requestId, operation: targetOperation, path: targetPath, status: null, outcome: "blocked", latencyMs: Date.now() - started, errorCode: "RATE_LIMITER_UNAVAILABLE" });
          if (!logged) throw new Error("DIGITALOCEAN_USAGE_LOG_UNAVAILABLE");
          throw new Error("DIGITALOCEAN_RATE_LIMITER_UNAVAILABLE");
        }
        const permitAt = permitRows[0].permit_at as string;
        const waitMs = new Date(permitAt).getTime() - Date.now();
        if (!Number.isFinite(waitMs) || waitMs > 15_000) {
          const logged = await insertUsageEvent({ idempotencyKey: key, requestId, operation: targetOperation, path: targetPath, status: 429, outcome: "blocked", latencyMs: Date.now() - started, errorCode: "RATE_LIMIT_QUEUE_BUSY" });
          if (!logged) throw new Error("DIGITALOCEAN_USAGE_LOG_UNAVAILABLE");
          throw new DigitalOceanRateLimitError(15, "DIGITALOCEAN_RATE_QUEUE_BUSY");
        }
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

        // Read the latest rotated token after the queue delay so this outbound
        // request always uses the current System Vault value. Never cache or log it.
        let token: string | null;
        try { token = await readSystemVaultSecret("digitalocean_api_token"); } catch {
          token = null;
        }
        if (!token) {
          const logged = await insertUsageEvent({ idempotencyKey: key, requestId, operation: targetOperation, path: targetPath, status: null, outcome: "failed", latencyMs: Date.now() - started, errorCode: "DIGITALOCEAN_VAULT_TOKEN_UNAVAILABLE" });
          if (!logged) throw new Error("DIGITALOCEAN_USAGE_LOG_UNAVAILABLE");
          throw new Error("DIGITALOCEAN_CREDENTIAL_MISSING");
        }

        let response: Response;
        try {
          response = await fetch(new URL(targetPath, API_ORIGIN), {
            method: "GET",
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            cache: "no-store",
            signal: AbortSignal.timeout(20_000),
          });
        } catch {
          const logged = await insertUsageEvent({ idempotencyKey: key, requestId, operation: targetOperation, path: targetPath, status: null, outcome: "failed", latencyMs: Date.now() - started, errorCode: "PROVIDER_UNAVAILABLE" });
          if (!logged) throw new Error("DIGITALOCEAN_USAGE_LOG_UNAVAILABLE");
          throw new Error("DIGITALOCEAN_PROVIDER_UNAVAILABLE");
        }
        const raw = await response.text();
        const remaining = response.headers.get("ratelimit-remaining");
        const resetAt = Number(response.headers.get("ratelimit-reset"));
        const retryAfter = Number(response.headers.get("retry-after"));
        let deferUntil: number | null = null;
        if (response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) deferUntil = Date.now() + retryAfter * 1000;
        else if (remaining === "0" && Number.isFinite(resetAt) && resetAt * 1000 > Date.now()) deferUntil = resetAt * 1000;
        if (deferUntil !== null) {
          const { error } = await db.rpc("do_rate_limit_defer", { p_until: new Date(deferUntil).toISOString() });
          if (error) console.error("DigitalOcean rate-limit backoff could not be persisted");
        }
        const logged = await insertUsageEvent({
          idempotencyKey: key, requestId, operation: targetOperation, path: targetPath, status: response.status,
          outcome: response.ok ? "succeeded" : "failed", latencyMs: Date.now() - started,
          responseBytes: new TextEncoder().encode(raw).byteLength,
          errorCode: response.ok ? null : `HTTP_${response.status}`,
        });
        if (!logged) throw new Error("DIGITALOCEAN_USAGE_LOG_UNAVAILABLE");
        if (response.status === 429) {
          const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 30;
          throw new DigitalOceanRateLimitError(seconds, "DIGITALOCEAN_RATE_LIMITED");
        }
        if (!response.ok) throw new Error(`DIGITALOCEAN_HTTP_${response.status}`);
        try { return JSON.parse(raw) as unknown; } catch { throw new Error("DIGITALOCEAN_INVALID_JSON"); }
      };

      // DigitalOcean exposes its own prepayment gate. Read that authoritative
      // state before each requested API call; log the gate read just like every
      // other provider request. If the gate itself cannot be read, do not make
      // the requested call.
      if (operation !== "billing.prepayment_status") {
        let gate: unknown;
        try {
          gate = await rawRequest("billing.prepayment_status", "/v2/customers/my/prepayment_status", `${idempotencyKey}:balance-gate`);
        } catch (error) {
          if (error instanceof DigitalOceanRateLimitError) throw error;
          if (error instanceof Error && ["DIGITALOCEAN_RATE_LIMITER_UNAVAILABLE", "DIGITALOCEAN_CREDENTIAL_MISSING", "DIGITALOCEAN_USAGE_LOG_UNAVAILABLE"].includes(error.message)) throw error;
          const logged = await insertUsageEvent({ idempotencyKey, requestId, operation, path, status: null, outcome: "blocked", latencyMs: 0, errorCode: "BALANCE_GATE_UNAVAILABLE" });
          if (!logged) throw new Error("DIGITALOCEAN_USAGE_LOG_UNAVAILABLE");
          throw new Error("DIGITALOCEAN_BALANCE_GATE_UNAVAILABLE");
        }
        const status = record(record(gate)?.status);
        if (status?.blocked === true) {
          const logged = await insertUsageEvent({ idempotencyKey, requestId, operation, path, status: 402, outcome: "blocked", latencyMs: 0, errorCode: "PREPAYMENT_BALANCE_BLOCKED" });
          if (!logged) throw new Error("DIGITALOCEAN_USAGE_LOG_UNAVAILABLE");
          throw new Error("DIGITALOCEAN_BALANCE_GATE_BLOCKED");
        }
      }

      // This increment only permits GET catalog/billing routes. It does not
      // expose any billable resource-creation request without a reservation.
      return await rawRequest(operation, path, idempotencyKey) as T;
    },
  };

  return client;
}

export async function fetchAllPages<T>(
  client: DigitalOceanClient,
  operation: DigitalOceanOperation,
  path: string,
  collectionKey: string,
  idempotencyPrefix?: string,
  onFirstPage?: (response: Record<string, unknown>) => void,
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  for (;;) {
    const separator = path.includes("?") ? "&" : "?";
    const response = record(await client.request(operation, `${path}${separator}per_page=200&page=${page}`, idempotencyPrefix ? `${idempotencyPrefix}:page:${page}` : undefined));
    if (page === 1 && response) onFirstPage?.(response);
    const values = response?.[collectionKey];
    if (!Array.isArray(values)) throw new Error(`DIGITALOCEAN_${collectionKey.toUpperCase()}_MISSING`);
    results.push(...values as T[]);
    const links = record(response?.links);
    const pages = record(links?.pages);
    const meta = record(response?.meta);
    const totalPages = Number(meta?.total_pages);
    if (typeof pages?.next === "string" && pages.next.length > 0) { page++; continue; }
    if (Number.isFinite(totalPages) && totalPages > page) { page++; continue; }
    if (!Number.isFinite(totalPages) && values.length === 200) { page++; continue; }
    return results;
  }
}

export function resourceKey(item: unknown, fallback: number): string {
  const value = record(item);
  for (const key of ["slug", "size", "name", "id", "engine", "version"]) {
    const candidate = value?.[key];
    if (typeof candidate === "string" && candidate.length) return candidate;
    if (typeof candidate === "number") return String(candidate);
  }
  return `item-${fallback}`;
}

export function finiteMoney(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
