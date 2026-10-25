/**
 * Config for the remote (Streamable HTTP) transport only. Separate from
 * config.ts (which is DNA OS connection config, used by every transport)
 * because this token gates *access to this MCP server itself* — a different
 * concern from DNA_OS_API_TOKEN, which gates *runtime.query's call into DNA
 * OS*. Conflating the two would mean anyone who can reach the transport can
 * also run runtime.query, even without their own DNA OS token.
 */
export interface HttpTransportConfig {
  port: number
  accessToken: string | undefined
}

export function loadHttpTransportConfig(): HttpTransportConfig {
  const port = Number(process.env.MCP_HTTP_PORT ?? "8787")
  const accessToken = process.env.MCP_SERVER_ACCESS_TOKEN || undefined
  return { port, accessToken }
}
