/**
 * Connector Catalog — read-only join across the real, existing systems:
 *   - gateway/connectors.ts (DB-backed Connector lifecycle records)
 *   - app/api/admin/ide/_lib/workerSelectorRuntime.ts (real AI/Code
 *     Worker Adapter Registry)
 *   - engines/integration-gateway/selfDescription.ts (real GitHub/
 *     Vercel/Supabase webhook-observe adapters)
 *
 * This is a presentation-layer merge only — same pattern as the existing
 * describeGateway()/ai-agents route aggregators. It creates no new
 * connector engine, no new lifecycle, no new persistence. Every field is
 * either copied verbatim from a real source or a static *declared* fact
 * (providerDescriptors.ts) — status/health/enabled/lastVerifiedAt are
 * NEVER fabricated; unknown/unavailable renders honestly as
 * NOT_CONFIGURED/UNKNOWN, never HEALTHY/connected.
 */
import { listConnectors } from "@/gateway/connectors";
import type { ConnectorRecord } from "@/core/connector-loader";
import { WORKER_ADAPTER_REGISTRY } from "@/app/api/admin/ide/_lib/workerSelectorRuntime";
import type { WorkerHealthStatus } from "@/app/api/admin/ide/_lib/workerAdapter";
import { describeGateway } from "@/engines/integration-gateway/selfDescription";
import { channelIsEnabled } from "@/engines/integration-gateway/policy/gate";
import { KNOWN_PROVIDER_DESCRIPTORS, AI_WORKER_DESCRIPTORS, describeConnectorSlug } from "./providerDescriptors";

export type Direction = "INBOUND" | "OUTBOUND" | "BIDIRECTIONAL";
export type ConnectorFamily = "AI_CODE_WORKER" | "GITHUB" | "VERCEL" | "GENERIC_API" | "OTHER";
export type FunctionGroup =
  | "AI_DEVELOPMENT_WORKERS"
  | "EXTERNAL_INTELLIGENCE"
  | "SOURCE_CONTROL"
  | "DEPLOYMENT_INFRASTRUCTURE"
  | "COMMUNICATION"
  | "OTHER";

export interface CatalogEntry {
  id: string;
  kind: "db_connector" | "ai_worker" | "gateway_adapter";
  provider: string;
  product: string;
  model: string | null;
  logo: string | null;
  connectionType: string;
  capabilities: string[];
  role: string;
  direction: Direction;
  runtimeStatus: string;
  healthStatus: WorkerHealthStatus;
  enabled: boolean;
  endpoints: string[];
  permissions: string[];
  lastVerifiedAt: string | null;
  lastError: string | null;
  family: ConnectorFamily;
  functionGroup: FunctionGroup;
  connectorId?: string;
  adapterId?: string;
  slug?: string;
}

function familyForConnector(c: ConnectorRecord): ConnectorFamily {
  const key = `${c.slug} ${c.name}`.toLowerCase();
  if (key.includes("github")) return "GITHUB";
  if (key.includes("vercel")) return "VERCEL";
  if (c.auth_type === "api_key" || c.auth_type === "token" || c.auth_type === "uri" || c.auth_type === "webhook") return "GENERIC_API";
  return "OTHER";
}

function healthFromConnector(c: ConnectorRecord): WorkerHealthStatus {
  if (c.status === "connected") return "HEALTHY";
  if (c.status === "error") return "UNAVAILABLE";
  if (c.status === "connecting") return "UNKNOWN";
  return "NOT_CONFIGURED";
}

function connectorEntry(c: ConnectorRecord): CatalogEntry {
  const descriptor = describeConnectorSlug(c.slug, c.name);
  const family = familyForConnector(c);
  const direction: Direction = c.auth_type === "webhook" ? "INBOUND" : "OUTBOUND";
  const endpoints = [
    typeof c.config.base_url === "string" ? c.config.base_url : null,
    typeof c.config.url === "string" ? c.config.url : null,
    typeof c.config.receiving_path === "string" ? c.config.receiving_path : null,
    typeof c.config.authorize_url === "string" ? c.config.authorize_url : null,
  ].filter((v): v is string => !!v);

  return {
    id: c.id,
    kind: "db_connector",
    provider: descriptor?.provider ?? c.slug,
    product: descriptor?.product ?? c.name,
    model: descriptor?.model ?? null,
    logo: descriptor?.logo ?? null,
    connectionType: c.auth_type,
    capabilities: descriptor?.capabilities ?? [],
    role: descriptor?.role ?? "External Service",
    direction,
    runtimeStatus: c.status,
    healthStatus: healthFromConnector(c),
    enabled: c.enabled,
    endpoints,
    permissions: descriptor?.permissions ?? [],
    lastVerifiedAt: c.last_checked_at,
    lastError: c.last_error,
    family,
    functionGroup: descriptor?.functionGroup ?? (family === "GENERIC_API" ? "OTHER" : "OTHER"),
    connectorId: c.id,
    slug: c.slug,
  };
}

function healthFromWorkerAvailability(available: boolean): WorkerHealthStatus {
  // Deliberately never HEALTHY here — the Catalog never spends a live
  // call, so it can only ever know NOT_CONFIGURED or UNKNOWN. HEALTHY is
  // reserved for a real live health()/execute() result inside the
  // Connector Console (execution surface).
  return available ? "UNKNOWN" : "NOT_CONFIGURED";
}

function aiWorkerEntries(): CatalogEntry[] {
  return WORKER_ADAPTER_REGISTRY.filter((a) => a.type === "API" || a.type === "CLI").map((a) => {
    const descriptor = AI_WORKER_DESCRIPTORS[a.id];
    const availability = a.availability();
    return {
      id: `worker:${a.id}`,
      kind: "ai_worker",
      provider: descriptor?.provider ?? a.provider,
      product: descriptor?.product ?? a.id,
      model: descriptor?.model ?? null,
      logo: descriptor?.logo ?? null,
      connectionType: a.type,
      capabilities: a.capabilities(),
      role: descriptor?.role ?? "Code Worker",
      direction: "BIDIRECTIONAL",
      runtimeStatus: availability.available ? "configured" : "not_configured",
      healthStatus: healthFromWorkerAvailability(availability.available),
      enabled: availability.available,
      endpoints: [],
      permissions: descriptor?.permissions ?? [],
      lastVerifiedAt: null,
      lastError: availability.available ? null : availability.reason,
      family: "AI_CODE_WORKER",
      functionGroup: "AI_DEVELOPMENT_WORKERS",
      adapterId: a.id,
    } satisfies CatalogEntry;
  });
}

function gatewayEntries(dbConnectors: ConnectorRecord[]): CatalogEntry[] {
  const gw = describeGateway();
  const executeOpen = channelIsEnabled("execute");
  return gw.adapters
    .filter((a) => a.provider === "github" || a.provider === "vercel")
    .map((a) => {
      const descriptor = KNOWN_PROVIDER_DESCRIPTORS[a.provider];
      const matchingConnector = dbConnectors.find((c) => `${c.slug} ${c.name}`.toLowerCase().includes(a.provider));
      const observeOn = channelIsEnabled("observe");
      return {
        id: `gateway:${a.provider}`,
        kind: "gateway_adapter",
        provider: a.provider,
        product: descriptor?.product ?? a.provider,
        model: null,
        logo: descriptor?.logo ?? null,
        connectionType: a.ingress,
        capabilities: a.observes,
        role: descriptor?.role ?? "External Service",
        direction: executeOpen ? "BIDIRECTIONAL" : "INBOUND",
        runtimeStatus: matchingConnector?.status ?? (observeOn ? "observe_enabled" : "disabled"),
        healthStatus: matchingConnector ? healthFromConnector(matchingConnector) : observeOn ? "UNKNOWN" : "NOT_CONFIGURED",
        enabled: matchingConnector?.enabled ?? observeOn,
        endpoints: [`/api/gateway/observe/${a.provider}`],
        permissions: descriptor?.permissions ?? [],
        lastVerifiedAt: matchingConnector?.last_checked_at ?? null,
        lastError: matchingConnector?.last_error ?? null,
        family: a.provider === "github" ? "GITHUB" : "VERCEL",
        functionGroup: descriptor?.functionGroup ?? "OTHER",
        connectorId: matchingConnector?.id,
        slug: a.provider,
      } satisfies CatalogEntry;
    });
}

export async function buildConnectorCatalog(): Promise<CatalogEntry[]> {
  const dbConnectors = await listConnectors().catch(() => [] as ConnectorRecord[]);
  const gatewayProviderNames = new Set(["github", "vercel"]);

  const dbEntries = dbConnectors
    .filter((c) => !gatewayProviderNames.has(familyForConnector(c) === "GITHUB" ? "github" : familyForConnector(c) === "VERCEL" ? "vercel" : ""))
    .map(connectorEntry);

  return [...dbEntries, ...aiWorkerEntries(), ...gatewayEntries(dbConnectors)];
}

export function groupByFamily(catalog: CatalogEntry[]): Record<ConnectorFamily, CatalogEntry[]> {
  const groups: Record<ConnectorFamily, CatalogEntry[]> = {
    AI_CODE_WORKER: [],
    GITHUB: [],
    VERCEL: [],
    GENERIC_API: [],
    OTHER: [],
  };
  for (const entry of catalog) groups[entry.family].push(entry);
  return groups;
}

export function groupByFunction(catalog: CatalogEntry[]): Record<FunctionGroup, CatalogEntry[]> {
  const groups: Record<FunctionGroup, CatalogEntry[]> = {
    AI_DEVELOPMENT_WORKERS: [],
    EXTERNAL_INTELLIGENCE: [],
    SOURCE_CONTROL: [],
    DEPLOYMENT_INFRASTRUCTURE: [],
    COMMUNICATION: [],
    OTHER: [],
  };
  for (const entry of catalog) groups[entry.functionGroup].push(entry);
  return groups;
}