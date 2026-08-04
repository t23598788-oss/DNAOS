import type { DnaOsConfig } from "./config.js"

export interface GovernanceResult {
  body: unknown
  status: number
}

async function request(config: DnaOsConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<GovernanceResult> {
  if (!config.apiToken) throw new Error("DNA_OS_API_TOKEN is required for governance tools")
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-DNA-Token": config.apiToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const parsed = await response.json().catch(() => undefined)
  if (!response.ok) throw new Error(typeof parsed?.error === "string" ? parsed.error : `DNA OS governance HTTP ${response.status}`)
  return { body: parsed, status: response.status }
}

export const governanceGet = (config: DnaOsConfig, path: string) => request(config, "GET", path)
export const governancePost = (config: DnaOsConfig, path: string, body: unknown) => request(config, "POST", path, body)
