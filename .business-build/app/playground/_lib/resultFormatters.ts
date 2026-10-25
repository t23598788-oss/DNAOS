/**
 * Single registry for turning a /api/v1/query result into human-readable
 * text. Every ResultCard goes through formatResult() — no component formats
 * its own data, so there is exactly one place to fix a bad-looking result.
 */

// Never show a raw ID/UUID in human-readable output — matches on the field
// NAME (id, partner_id, customer_id, ...), not on whether the value looks
// like a UUID, so it also hides non-UUID internal IDs consistently.
function isIdField(key: string): boolean {
  return key === "id" || key.endsWith("_id")
}

function humanizeItem(item: unknown): string {
  if (item === null || item === undefined) return "-"
  if (typeof item !== "object") return String(item)
  const rec = item as Record<string, unknown>
  return Object.entries(rec)
    .filter(([k, v]) => v !== null && v !== undefined && !isIdField(k) && k !== "created_at")
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ")
}

/** Fallback used for any command without a specific formatter below — readable, not raw JSON. */
function genericFormatter(data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return "ไม่พบข้อมูล"
    const lines = data.slice(0, 10).map((item, i) => `${i + 1}. ${humanizeItem(item)}`)
    if (data.length > 10) lines.push(`...และอีก ${data.length - 10} รายการ`)
    return lines.join("\n")
  }
  if (data && typeof data === "object") return humanizeItem(data)
  if (data === undefined || data === null) return "ไม่พบข้อมูล"
  return String(data)
}

type Formatter = (data: unknown) => string

const RESULT_FORMATTERS: Record<string, Formatter> = {
  "partner.list": (data) => genericFormatter(data),
  "debt.list": (data) => {
    if (!Array.isArray(data) || data.length === 0) return "ไม่มีหนี้ค้างชำระในขณะนี้"
    return genericFormatter(data)
  },
  "job.active": (data) => {
    if (!Array.isArray(data) || data.length === 0) return "ไม่มีงานที่กำลังดำเนินการ"
    return genericFormatter(data)
  },
  "events.recent": (data) => genericFormatter(data),
  "computer.system.status": (data) => genericFormatter(data),
}

export function formatResult(command: string, data: unknown): string {
  const formatter = RESULT_FORMATTERS[command]
  return formatter ? formatter(data) : genericFormatter(data)
}
