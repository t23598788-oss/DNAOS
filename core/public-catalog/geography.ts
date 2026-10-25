/**
 * Province / district resolution from the supplier's own address text — PURE.
 *
 * Why this exists: the source schema (pit_profiles) stores sub_district_id /
 * district_id / province_id as uuid ids and this repo has NO geography table
 * (verified: no migration defines provinces/districts). The only place a human
 * readable จังหวัด/อำเภอ actually exists is the supplier's address text
 * (`formatted_address` / `address`), which the admin control room ALREADY
 * parses with the exact same rule (`/api/admin/pits`: `จ.\s*([ก-๙]+)`).
 * This module is that rule, extracted once, so the admin table and the public
 * reader can never disagree about which province a pit is in.
 *
 * It is a PARSE of real published text, not a lookup and not a guess:
 *   - no match  → null (the UI renders "—" and the record simply won't match a
 *     province filter — it is never bucketed into a made-up province)
 *   - ids alone → null (ids carry no name; nothing is synthesised)
 */

export interface ParsedArea {
  province: string | null
  district: string | null
}

/** Thai letters and the marks that appear inside Thai place names. */
const THAI_WORD = "[ก-๙.]+"

/** ตำบล / แขวง are not exposed: they are finer than the required filters. */
function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = text.match(pattern)
    const raw = m?.[1]?.trim()
    if (raw) return raw.replace(/[.,\s]+$/, "")
  }
  return null
}

const PROVINCE_PATTERNS = [new RegExp(`จ\\.\\s*(${THAI_WORD})`), new RegExp(`จังหวัด\\s*(${THAI_WORD})`)]

/**
 * อ. / อำเภอ for a district, เขต for a Bangkok district. The lookbehind-free
 * pattern set is deliberate: "เขต" also appears in unrelated words, so it is
 * only accepted when followed by a space or a Thai word start and NOT when it
 * is part of "พื้นที่เขต..." style text.
 */
const DISTRICT_PATTERNS = [
  new RegExp(`อ\\.\\s*(${THAI_WORD})`),
  new RegExp(`อำเภอ\\s*(${THAI_WORD})`),
  new RegExp(`(?:^|[\\s,])เขต\\s*(${THAI_WORD})`),
]

export function parseAreaFromAddress(text: string | null | undefined): ParsedArea {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { province: null, district: null }
  }
  // Normalise the Thai abbreviation variants that occur in real rows
  // ("จันทบุรี" / "จ.จันทบุรี" / "จ. จันทบุรี").
  const normalised = text.replace(/\s+/g, " ").trim()
  return {
    province: firstMatch(normalised, PROVINCE_PATTERNS),
    district: firstMatch(normalised, DISTRICT_PATTERNS),
  }
}

/**
 * Province/district filters compare on the parsed name with a substring match,
 * so "จันทบุรี" and "จันทบุรี " match, and a filter of "ท่าใหม่" matches the
 * district "ท่าใหม่" only. A record without the field never matches.
 */
export function matchesParsedArea(value: string | null, filter: string): boolean {
  const f = filter.trim().toLowerCase()
  if (!f) return true
  if (!value) return false
  return value.trim().toLowerCase().includes(f)
}
