/**
 * Loads the tool→endpoint mapping from DNA OS itself via
 * GET /api/v1/mcp/manifest — the live rendering of
 * registry/mcp-planned-manifest.json + registry/mcp-resource-registry.json.
 *
 * This is the ONLY place that mapping lives. No endpoint path is
 * hardcoded a second time anywhere else in this package — every tool file
 * asks this module for its endpoint by name instead of holding its own copy.
 *
 * Fetched once per process lifetime (not persisted to disk, not treated as
 * a new source of truth — a fresh process always re-fetches the live
 * manifest from DNA OS on startup).
 */
import type { DnaOsConfig } from "./config.js"
import { httpGet } from "./httpClient.js"
import type { McpAdapterError } from "./errors.js"

export interface ManifestToolEntry {
  reads_endpoint: string
  reads_source_files: string[]
  status: string
  [k: string]: unknown
}

export interface ManifestResourceEntry {
  reads_endpoint: string
  reads_source_files: string[]
  status: string
  [k: string]: unknown
}

interface ManifestEnvelope {
  data: {
    tools: Record<string, ManifestToolEntry>
    resources: Record<string, ManifestResourceEntry>
  }
  registry_version: Record<string, number>
}

let cached: ManifestEnvelope | undefined

/**
 * registry/mcp-planned-manifest.json's reads_endpoint values are written as
 * "METHOD /path" (e.g. "POST /api/v1/query") for human readability. This is
 * the one place that convention is parsed back into a bare path.
 */
function stripMethodPrefix(readsEndpoint: string): string {
  const match = readsEndpoint.match(/^[A-Z]+\s+(\/.*)$/)
  return match ? match[1] : readsEndpoint
}

export async function loadManifest(
  config: DnaOsConfig
): Promise<{ ok: true; manifest: ManifestEnvelope } | { ok: false; error: McpAdapterError }> {
  if (cached) return { ok: true, manifest: cached }

  const result = await httpGet<ManifestEnvelope>(config, "/api/v1/mcp/manifest")
  if (!result.ok) return { ok: false, error: result.error }

  cached = result.body
  return { ok: true, manifest: cached }
}

export async function resolveToolEndpoint(
  config: DnaOsConfig,
  toolName: string
): Promise<{ ok: true; endpoint: string } | { ok: false; error: McpAdapterError }> {
  const loaded = await loadManifest(config)
  if (!loaded.ok) return loaded
  const entry = loaded.manifest.data.tools[toolName]
  if (!entry) {
    return {
      ok: false,
      error: {
        code: "CONFIGURATION_ERROR",
        message: `Tool "${toolName}" is not declared in registry/mcp-planned-manifest.json`,
        endpoint: "/api/v1/mcp/manifest",
        retryable: false,
      },
    }
  }
  return { ok: true, endpoint: stripMethodPrefix(entry.reads_endpoint) }
}

export async function resolveResourceEndpoint(
  config: DnaOsConfig,
  resourceName: string
): Promise<{ ok: true; endpoint: string } | { ok: false; error: McpAdapterError }> {
  const loaded = await loadManifest(config)
  if (!loaded.ok) return loaded
  const entry = loaded.manifest.data.resources[resourceName]
  if (!entry) {
    return {
      ok: false,
      error: {
        code: "CONFIGURATION_ERROR",
        message: `Resource "${resourceName}" is not declared in registry/mcp-resource-registry.json`,
        endpoint: "/api/v1/mcp/manifest",
        retryable: false,
      },
    }
  }
  return { ok: true, endpoint: stripMethodPrefix(entry.reads_endpoint) }
}
