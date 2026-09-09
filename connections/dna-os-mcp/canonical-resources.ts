import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  canonicalMetrics,
  documentationProjection,
  ensureSafeCanonicalIngest,
  getActiveActivities,
  getBoundaries,
  getFacts,
  getRecentEvents,
  getRelationships,
  listEntitiesByType,
} from "../../control/canonical-information/contract";
import { ingestSafeCanonicalSources } from "../../control/canonical-information/ingest-safe";
import { DEVELOPMENT_KNOWLEDGE_URIS, developmentContext } from "../../control/mcp-code-knowledge/contract";

const CACHE = { _meta: { ttl: 30, cacheScope: "private" as const } };

function text(uri: string, payload: unknown): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  const keys = Object.keys(payload as object).sort();
  const ordered = payload && typeof payload === "object" && !Array.isArray(payload)
    ? Object.fromEntries(keys.map((key) => [key, (payload as Record<string, unknown>)[key]]))
    : payload;
  return { contents: [{ uri, mimeType: "application/json", text: `${JSON.stringify(ordered, null, 2)}\n` }] };
}

export const CANONICAL_MCP_RESOURCE_URIS = [
  "resource://dna-os/system",
  "resource://dna-os/capabilities",
  "resource://dna-os/connections",
  "resource://dna-os/resources",
  "resource://dna-os/work",
  "resource://dna-os/activity",
  "resource://dna-os/production",
  "resource://dna-os/runtime",
  "resource://dna-os/schemas/canonical-information-v1",
] as const;

export const DEVELOPMENT_MCP_RESOURCE_URIS = DEVELOPMENT_KNOWLEDGE_URIS;

export function registerCanonicalInformationResources(server: McpServer): void {
  const read = (uri: typeof CANONICAL_MCP_RESOURCE_URIS[number]) => async () => {
    ingestSafeCanonicalSources();
    ensureSafeCanonicalIngest();
    if (uri.endsWith("/system")) return text(uri, { entity: listEntitiesByType("SYSTEM"), metrics: canonicalMetrics(), ...CACHE });
    if (uri.endsWith("/capabilities")) return text(uri, { entities: listEntitiesByType("CAPABILITY"), ...CACHE });
    if (uri.endsWith("/connections")) return text(uri, { entities: listEntitiesByType("CONNECTION"), boundaries: getBoundaries(), ...CACHE });
    if (uri.endsWith("/resources")) return text(uri, { entities: listEntitiesByType("RESOURCE"), ...CACHE });
    if (uri.endsWith("/work")) return text(uri, { entities: listEntitiesByType("WORK"), ...CACHE });
    if (uri.endsWith("/activity")) return text(uri, { activities: getActiveActivities(), ...CACHE });
    if (uri.endsWith("/production")) return text(uri, { docs: documentationProjection(), ...CACHE });
    if (uri.endsWith("/runtime")) return text(uri, { entities: listEntitiesByType("RUNTIME"), events: getRecentEvents(10), ...CACHE });
    return text(uri, { schema: "DNA_OS_CANONICAL_INFORMATION_BACKEND_V1", uris: CANONICAL_MCP_RESOURCE_URIS, ...CACHE });
  };
  for (const uri of CANONICAL_MCP_RESOURCE_URIS) {
    const name = uri.replace("resource://dna-os/", "dna-os-");
    server.registerResource(name, uri, {
      description: `Canonical information ${uri}`,
      mimeType: "application/json",
      _meta: { ttl: 30, cacheScope: "private" },
    }, read(uri));
  }
  const readDev = (uri: typeof DEVELOPMENT_MCP_RESOURCE_URIS[number]) => async () => {
    ingestSafeCanonicalSources();
    ensureSafeCanonicalIngest();
    const capabilities = listEntitiesByType("CAPABILITY").map((row) => ({ id: row.entity_id, name: row.canonical_name }));
    const context = developmentContext({ work_id: "unbound", lease: null, goal: "registered-fact-first" });
    const dependencies = getRelationships().filter((row) => row.relationship_type === "DEPENDS_ON").slice(0, 32);
    const source_map = capabilities.map((row) => ({ capability: row.name, handle: `resource://dna-os/capability/${row.name}` }));
    const tests = getFacts().filter((row) => /test/i.test(row.key)).slice(0, 16);
    const work_order = listEntitiesByType("WORK").slice(0, 8);
    if (uri.endsWith("/context")) return text(uri, { ...context, ...CACHE });
    if (uri.endsWith("/dependencies")) return text(uri, { dependencies, ...CACHE });
    if (uri.endsWith("/source-map")) return text(uri, { source_map, ...CACHE });
    if (uri.endsWith("/tests")) return text(uri, { tests, ...CACHE });
    return text(uri, { work: work_order, ...CACHE });
  };
  for (const uri of DEVELOPMENT_MCP_RESOURCE_URIS) {
    const name = uri.replace("resource://dna-os/", "dna-os-");
    server.registerResource(name, uri, {
      description: `Development knowledge ${uri}`,
      mimeType: "application/json",
      _meta: { ttl: 15, cacheScope: "private" },
    }, readDev(uri));
  }
}
