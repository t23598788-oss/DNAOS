import { loadConnectionSummaries } from "../conversation-runtime/connection-summary";
import { productionBoundaryProjection } from "../work-production-pipeline/production-boundaries";
import { persistAdapter, listPersistedAdapters } from "./persist";
import type { InboundAdapterV1, ProviderClass } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function adapter(partial: Omit<InboundAdapterV1, "schema" | "discovery_grants_authority">): InboundAdapterV1 {
  return { schema: "INBOUND_EVENT_ADAPTER_V1", discovery_grants_authority: false, ...partial };
}

export function discoverInboundAdapters(): readonly InboundAdapterV1[] {
  const existing = listPersistedAdapters();
  if (existing.length > 0) return existing;
  const summaries = loadConnectionSummaries().summaries;
  const github = summaries.find((row) => /github/i.test(row.system) || /github/i.test(row.connection_id));
  const railway = productionBoundaryProjection();
  const catalog: InboundAdapterV1[] = [
    adapter({
      adapter_id: "adapter://inbound/coding-client/cursor",
      provider_id: "cursor",
      provider_type: "CODING_CLIENT",
      source_system: "Cursor",
      transport: "MCP",
      event_types: ["WORK_ACCEPTED", "CODING_PROGRESS", "CLIENT_DISCONNECTED", "COMPLETED_CANDIDATE"],
      authentication_state: "SESSION",
      authority_state: "DENY",
      runtime_verified: true,
      owner_enabled: false,
      last_event_at: null,
      health: "CONNECTED",
      evidence_refs: ["connections/dna-os-mcp/server.ts"],
    }),
    adapter({
      adapter_id: "adapter://inbound/github",
      provider_id: github?.connection_id ?? "github",
      provider_type: "GITHUB",
      source_system: "GitHub",
      transport: "DNA_OS_PUBLISH",
      event_types: ["PUBLISHED", "PROVIDER_ALERT"],
      authentication_state: github?.status ?? "NOT_WIRED",
      authority_state: "DENY",
      runtime_verified: github?.status === "VERIFIED" || github?.status === "CONNECTED",
      owner_enabled: false,
      last_event_at: null,
      health: github?.status === "VERIFIED" || github?.status === "CONNECTED" ? "VERIFIED" : "NOT_WIRED",
      evidence_refs: [github?.evidence_ref ?? "connections/github"],
    }),
    adapter({
      adapter_id: "adapter://inbound/macos",
      provider_id: "macos",
      provider_type: "MACOS",
      source_system: "macOS",
      transport: "UserNotifications/LaunchServices",
      event_types: ["FILE_RECEIVED", "INBOUND_SYSTEM_EVENT"],
      authentication_state: "LOCAL",
      authority_state: "DENY",
      runtime_verified: true,
      owner_enabled: false,
      last_event_at: null,
      health: "CONNECTED",
      evidence_refs: ["control/macos-native-bridge/contract.ts"],
    }),
    adapter({
      adapter_id: "adapter://inbound/deployment",
      provider_id: "railway",
      provider_type: "DEPLOYMENT_PROVIDER",
      source_system: "deployment-provider",
      transport: "NOT_WIRED",
      event_types: ["DEPLOYED", "DEPLOYMENT_FAILED"],
      authentication_state: "NONE",
      authority_state: "DENY",
      runtime_verified: false,
      owner_enabled: false,
      last_event_at: null,
      health: railway.RAILWAY_DEPLOYMENT_MUTATION === "NOT_WIRED" ? "NOT_WIRED" : "NOT_AVAILABLE",
      evidence_refs: ["control/work-production-pipeline/production-boundaries.ts"],
    }),
    adapter({
      adapter_id: "adapter://inbound/database",
      provider_id: "database",
      provider_type: "DATABASE_PROVIDER",
      source_system: "database-provider",
      transport: "NOT_WIRED",
      event_types: ["PROVIDER_ALERT"],
      authentication_state: "NONE",
      authority_state: "DENY",
      runtime_verified: false,
      owner_enabled: false,
      last_event_at: null,
      health: "NOT_WIRED",
      evidence_refs: ["connections/connection-index/index.json"],
    }),
    adapter({
      adapter_id: "adapter://inbound/email",
      provider_id: "email",
      provider_type: "EMAIL_PROVIDER",
      source_system: "email-provider",
      transport: "NOT_AVAILABLE",
      event_types: ["EMAIL_RECEIVED"],
      authentication_state: "NONE",
      authority_state: "DENY",
      runtime_verified: false,
      owner_enabled: false,
      last_event_at: null,
      health: "NOT_AVAILABLE",
      evidence_refs: ["control/owner-work-surface/work.ts"],
    }),
    adapter({
      adapter_id: "adapter://inbound/messaging",
      provider_id: "messaging",
      provider_type: "MESSAGING_PROVIDER",
      source_system: "messaging-provider",
      transport: "NOT_AVAILABLE",
      event_types: ["MESSAGE_RECEIVED"],
      authentication_state: "NONE",
      authority_state: "DENY",
      runtime_verified: false,
      owner_enabled: false,
      last_event_at: null,
      health: "NOT_AVAILABLE",
      evidence_refs: [],
    }),
    adapter({
      adapter_id: "adapter://inbound/files",
      provider_id: "local-files",
      provider_type: "FILE_SOURCE",
      source_system: "local-resource-access",
      transport: "LOCAL_RESOURCE",
      event_types: ["FILE_RECEIVED"],
      authentication_state: "OWNER_GRANT",
      authority_state: "DENY",
      runtime_verified: true,
      owner_enabled: false,
      last_event_at: null,
      health: "CONNECTED",
      evidence_refs: ["control/local-resource-access/contract.ts"],
    }),
    adapter({
      adapter_id: "adapter://inbound/system-internal",
      provider_id: "dna-os",
      provider_type: "SYSTEM_INTERNAL",
      source_system: "DNA_OS",
      transport: "CANONICAL_EVENT",
      event_types: ["WORK_COMPLETED", "RUNTIME_VERIFIED", "TEST_FAILED", "REVIEW_READY"],
      authentication_state: "INTERNAL",
      authority_state: "DENY",
      runtime_verified: true,
      owner_enabled: true,
      last_event_at: null,
      health: "VERIFIED",
      evidence_refs: ["control/canonical-information"],
    }),
  ];
  for (const row of catalog) persistAdapter(row);
  return catalog;
}

export function getInboundAdapter(adapter_id: string): InboundAdapterV1 | null {
  return discoverInboundAdapters().find((row) => row.adapter_id === adapter_id) ?? null;
}

export function inboundEventGrantsAuthority(): false {
  return false;
}

export function futureInboundContracts(): Record<string, readonly string[]> {
  return {
    EMAIL_RECEIVED: ["provider", "external_event_id", "sender_ref", "subject", "received_at", "resource_refs", "owner_attention", "evidence_refs"],
    MESSAGE_RECEIVED: ["provider", "external_event_id", "sender_ref", "subject", "received_at", "resource_refs", "owner_attention", "evidence_refs"],
    FILE_RECEIVED: ["provider", "external_event_id", "subject", "received_at", "resource_refs", "owner_attention", "evidence_refs"],
    PROVIDER_ALERT: ["provider", "external_event_id", "subject", "received_at", "resource_refs", "owner_attention", "evidence_refs"],
  };
}

void nowIso;
void (0 as unknown as ProviderClass);
