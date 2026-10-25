/**
 * Configuration only. No business logic, no filesystem access into the
 * DNA OS repo, no defaults that silently paper over a missing token.
 */

export interface DnaOsConfig {
  baseUrl: string
  apiToken: string | undefined
}

export function loadConfig(): DnaOsConfig {
  const baseUrl = process.env.DNA_OS_BASE_URL ?? "http://localhost:3000"
  const apiToken = process.env.DNA_OS_API_TOKEN || undefined
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiToken }
}

/** Never log or echo the token itself — only whether one is configured. */
export function tokenStatus(config: DnaOsConfig): "configured" | "missing" {
  return config.apiToken ? "configured" : "missing"
}
