/**
 * Single source for the canonical MCP resource URI (RFC 8707) and this
 * server's own origin — every OAuth route and the resource-server token
 * check reads from here, never a second hardcoded copy.
 */

export function appOrigin(): string {
  const value = process.env.AI_CONNECTION_APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL
  if (!value) throw new Error("AI_CONNECTION_APP_ORIGIN (or NEXT_PUBLIC_APP_URL) is not set.")
  return value.replace(/\/+$/, "")
}

/** The canonical URI RFC 8707's `resource` parameter must match exactly. */
export function canonicalMcpResourceUri(): string {
  return `${appOrigin()}/api/v1/query`
}
