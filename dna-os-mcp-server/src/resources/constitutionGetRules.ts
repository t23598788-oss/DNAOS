/**
 * constitution.get_rules reuses the pre-existing GET /api/v1/constitution
 * route, which already returns registry/CONSTITUTION.json verbatim
 * (including its own "version" field, which this resource extracts for
 * registry_version rather than guessing it).
 */
import type { DnaOsConfig } from "../config.js"
import { httpGet } from "../httpClient.js"
import { resolveResourceEndpoint } from "../manifestClient.js"
import { normalizeLegacyResponse, type NormalizedResult } from "../normalize.js"
import type { McpAdapterError } from "../errors.js"

export const RESOURCE_NAME = "constitution.get_rules"
export const RESOURCE_URI = "dna-os://constitution/rules"

export async function readConstitutionGetRules(
  config: DnaOsConfig
): Promise<{ ok: true; result: NormalizedResult } | { ok: false; error: McpAdapterError }> {
  const resolved = await resolveResourceEndpoint(config, RESOURCE_NAME)
  if (!resolved.ok) return resolved

  const res = await httpGet<{ version?: number }>(config, resolved.endpoint)
  if (!res.ok) return res

  const constitutionVersion = typeof res.body?.version === "number" ? res.body.version : undefined

  return {
    ok: true,
    result: normalizeLegacyResponse(res.body, {
      sourceFiles: ["registry/CONSTITUTION.json"],
      registryVersion: constitutionVersion !== undefined ? { constitution: constitutionVersion } : {},
      confidenceReason:
        constitutionVersion === undefined
          ? "GET /api/v1/constitution response did not include a version field."
          : undefined,
    }),
  }
}
