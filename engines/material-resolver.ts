// Resolves free-text material names (extracted from LINE chat by the Event
// Builder LLM, e.g. "ทราย, หิน, ดินลูกรัง, ดินถม, หินคลุก") against the real
// material_types table. Never guesses between ambiguous matches (e.g. "ทราย"
// alone could mean ทรายละเอียด or ทรายหยาบ) — flags them for a human to pick
// instead of silently choosing one (DNA OS rule — ห้ามเดา).

export interface MaterialTypeRow {
  id: string
  name: string
}

export interface MaterialMatch {
  input: string
  matched: MaterialTypeRow | null
  candidates: MaterialTypeRow[]
}

// Thai script has no ASCII word boundaries: `\bและ\b` never matches because
// Thai code points are not \w (regression found by M019, fixed in M020).
// Separators are the list punctuation (, 、) plus the Thai connectors และ / กับ,
// with or without surrounding spaces ("ทราย และ หิน", "ทรายและหิน").
const SPLIT_PATTERN = /[,、]|\s*และ\s*|\s*กับ\s*/

export function splitMaterialText(materialText: string): string[] {
  return materialText
    .split(SPLIT_PATTERN)
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalize(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase()
}

export function resolveMaterial(input: string, materialTypes: MaterialTypeRow[]): MaterialMatch {
  const normInput = normalize(input)

  // Exact name match first.
  const exact = materialTypes.find((m) => normalize(m.name) === normInput)
  if (exact) return { input, matched: exact, candidates: [] }

  // Substring match in either direction (handles "ดินลูกรัง" vs registered
  // "ลูกรัง", or "หินคลุก" matching "หินคลุก" exactly, or partial names).
  const candidates = materialTypes.filter(
    (m) => normalize(m.name).includes(normInput) || normInput.includes(normalize(m.name))
  )

  if (candidates.length === 1) return { input, matched: candidates[0], candidates: [] }
  if (candidates.length > 1) return { input, matched: null, candidates } // ambiguous — human picks
  return { input, matched: null, candidates: [] } // no match at all — human enters manually
}

export function resolveMaterialText(materialText: string, materialTypes: MaterialTypeRow[]): MaterialMatch[] {
  return splitMaterialText(materialText).map((input) => resolveMaterial(input, materialTypes))
}
