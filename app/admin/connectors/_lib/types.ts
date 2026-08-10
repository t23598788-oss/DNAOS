// Client-side mirror of app/api/admin/connectors/_lib/catalog.ts's
// CatalogEntry shape (kept in sync manually — this route boundary is a
// plain JSON response, not a shared TS import, since one side is a
// Next.js API route and the other a "use client" page).
export type Direction = "INBOUND" | "OUTBOUND" | "BIDIRECTIONAL";
export type ConnectorFamily = "AI_CODE_WORKER" | "GITHUB" | "VERCEL" | "GENERIC_API" | "OTHER";
export type WorkerHealthStatus = "HEALTHY" | "DEGRADED" | "NOT_CONFIGURED" | "UNAVAILABLE" | "UNKNOWN";

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
  functionGroup: string;
  connectorId?: string;
  adapterId?: string;
  slug?: string;
}

export const FAMILY_LABELS: Record<ConnectorFamily, string> = {
  AI_CODE_WORKER: "AI / Code Worker",
  GITHUB: "GitHub",
  VERCEL: "Vercel",
  GENERIC_API: "Generic API / Webhook",
  OTHER: "Other External Services",
};

export function healthColor(h: WorkerHealthStatus): string {
  switch (h) {
    case "HEALTHY": return "bg-emerald-500";
    case "DEGRADED": return "bg-amber-400";
    case "UNAVAILABLE": return "bg-red-500";
    case "NOT_CONFIGURED": return "bg-stone-300";
    default: return "bg-stone-300";
  }
}