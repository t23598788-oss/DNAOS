/**
 * Resolves a free-text name into a real ID by calling the same *.find
 * commands already registered in command-registry.json (engines/validation/
 * resolver.ts) via /api/v1/query — no new resolution logic, this just
 * shapes the existing partner.find response into 0/1/N branches and never
 * surfaces raw UUIDs to the user.
 */
import { callQuery } from "./apiClient"
import type { EntityType } from "./commandCorpus"

const FIND_COMMAND: Record<EntityType, string> = {
  partner: "partner.find",
}

// Field DNA OS's partner records use for the human-readable name — checked
// against engines/validation/dispatcher.ts's partner.find handler, which
// filters services/supabase/queries.ts's getPartners() (id, name, ...).
const LABEL_FIELD: Record<EntityType, string> = {
  partner: "name",
}

const ID_FIELD: Record<EntityType, string> = {
  partner: "id",
}

export type EntityResolution =
  | { kind: "resolved"; id: string; label: string }
  | { kind: "none" }
  | { kind: "multiple"; options: { id: string; label: string }[] }
  | { kind: "error"; message: string }

export async function resolveEntity(token: string, type: EntityType, keyword: string): Promise<EntityResolution> {
  const command = FIND_COMMAND[type]
  const res = await callQuery(token, command, { keyword })

  if (!res.ok) {
    return { kind: "error", message: res.error ?? "resolution failed" }
  }

  const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : []
  const labelField = LABEL_FIELD[type]
  const idField = ID_FIELD[type]

  const options = rows
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map(r => ({ id: String(r[idField] ?? ""), label: String(r[labelField] ?? "(ไม่ทราบชื่อ)") }))
    .filter(o => o.id)

  if (options.length === 0) return { kind: "none" }
  if (options.length === 1) return { kind: "resolved", id: options[0].id, label: options[0].label }
  return { kind: "multiple", options: options.slice(0, 8) }
}
