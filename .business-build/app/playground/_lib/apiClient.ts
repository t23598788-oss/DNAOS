/**
 * The ONLY place this console calls POST /api/v1/query. Every step of
 * intent routing, entity resolution, and multi-step chaining goes through
 * this one function — never a direct dispatcher/engine import, never a new
 * batch endpoint. Contract is untouched: { command, args } in, whatever
 * /api/v1/query already returns, out.
 */
export interface QueryResult {
  ok: boolean
  command?: string
  data?: unknown
  error?: string
  hint?: string
  requires_confirmation?: boolean
}

export async function callQuery(token: string, command: string, args: Record<string, unknown> = {}): Promise<QueryResult> {
  try {
    const res = await fetch("/api/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DNA-Token": token },
      body: JSON.stringify({ command, args }),
    })
    const json = await res.json()
    if (!res.ok) {
      return { ok: false, error: json?.error ?? json?.hint ?? `HTTP ${res.status}` }
    }
    return json as QueryResult
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
