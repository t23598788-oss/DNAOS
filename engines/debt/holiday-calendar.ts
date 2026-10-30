/**
 * Thai public-holiday calendar — PURE validation, no I/O, no assumed dates.
 *
 * The Debt Collection Act B.E. 2558 (§8) closes collection contact at 18:00 on
 * public holidays instead of 20:00. That single hour depends entirely on knowing
 * whether "today" is a public holiday, so a guessed calendar is a legal risk,
 * not a convenience. This module therefore NEVER invents a date:
 *
 *   • a year is usable only when an entry exists for it,
 *   • the entry must name an OFFICIAL source (a .go.th host or bot.or.th),
 *   • every day must carry a label and kind (annual | special) so a special
 *     cabinet-approved holiday is distinguishable from the regular list,
 *   • the operator records when they verified it (`verified_at`).
 *
 * Anything that fails those checks returns a status other than VERIFIED, and the
 * caller (the cron) must refuse to send. Missing data must never be silently
 * read as "no holiday today".
 *
 * Authoritative sources to transcribe from (never from memory):
 *   • สำนักเลขาธิการคณะรัฐมนตรี — วันหยุดราชการประจำปี (soc.go.th)
 *   • ธนาคารแห่งประเทศไทย — วันหยุดของสถาบันการเงิน + วันหยุดเพิ่มเป็นกรณีพิเศษ
 *     (bot.or.th/th/financial-institutions-holiday.html)
 *   • ราชกิจจานุเบกษา — the announcement itself (ratchakitcha.soc.go.th)
 *
 * The BOT list is a superset of the public holidays for financial institutions
 * and is the safer of the two when they differ: a day that is a holiday for
 * either source is treated as a holiday (18:00 close). Being conservative can
 * only shorten the allowed window, never extend it.
 */

export type HolidayKind = "annual" | "special";

export interface HolidayDay {
  date: string; // YYYY-MM-DD
  label: string;
  kind: HolidayKind;
}

export interface HolidayYearEntry {
  source_url: string;
  source_name: string;
  verified_at: string; // YYYY-MM-DD
  days: HolidayDay[];
}

export type CalendarStatus =
  | "VERIFIED"
  | "MISSING"
  | "MALFORMED"
  | "YEAR_NOT_PUBLISHED"
  | "UNVERIFIED_SOURCE"
  | "INVALID_DAYS";

export interface HolidayCalendar {
  status: CalendarStatus;
  year: number;
  dates: string[];
  sourceUrl: string | null;
  sourceName: string | null;
  verifiedAt: string | null;
  dayCount: number;
  problems: string[];
}

const OFFICIAL_HOST_SUFFIXES = [".go.th", "bot.or.th", "ratchakitcha.soc.go.th"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isOfficial(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_HOST_SUFFIXES.some((s) => host === s.replace(/^\./, "") || host.endsWith(s));
  } catch {
    return false;
  }
}

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function result(year: number, status: CalendarStatus, problems: string[], entry?: HolidayYearEntry): HolidayCalendar {
  return {
    status,
    year,
    dates: status === "VERIFIED" ? (entry?.days ?? []).map((d) => d.date).sort() : [],
    sourceUrl: entry?.source_url ?? null,
    sourceName: entry?.source_name ?? null,
    verifiedAt: entry?.verified_at ?? null,
    dayCount: status === "VERIFIED" ? (entry?.days.length ?? 0) : 0,
    problems,
  };
}

/**
 * Validate a calendar document:
 *   { "schema_version": 1, "years": { "2027": { source_url, source_name, verified_at, days: [...] } } }
 * `raw` is whatever the operator stored (app_configs text or the registry file
 * contents). Unknown extra keys are ignored; missing required keys are not.
 */
export function resolveHolidayCalendar(input: { raw: unknown; year: number }): HolidayCalendar {
  const { year } = input;
  if (input.raw == null || (typeof input.raw === "string" && input.raw.trim() === "")) {
    return result(year, "MISSING", ["no calendar configured"]);
  }

  let doc: any;
  try {
    doc = typeof input.raw === "string" ? JSON.parse(input.raw) : input.raw;
  } catch (e) {
    return result(year, "MALFORMED", [`not JSON: ${e instanceof Error ? e.message : String(e)}`]);
  }
  if (!doc || typeof doc !== "object" || !doc.years || typeof doc.years !== "object") {
    return result(year, "MALFORMED", ["missing years object"]);
  }

  const entry = doc.years[String(year)] as HolidayYearEntry | undefined;
  if (!entry) return result(year, "YEAR_NOT_PUBLISHED", [`no entry for ${year}`]);

  const problems: string[] = [];
  if (typeof entry.source_url !== "string" || !isOfficial(entry.source_url)) {
    problems.push("source_url ต้องเป็นแหล่งราชการ (.go.th / bot.or.th / ratchakitcha)");
  }
  if (typeof entry.source_name !== "string" || entry.source_name.trim() === "") {
    problems.push("missing source_name");
  }
  if (typeof entry.verified_at !== "string" || !isRealDate(entry.verified_at)) {
    problems.push("verified_at must be YYYY-MM-DD");
  }
  if (problems.length) return result(year, "UNVERIFIED_SOURCE", problems, entry);

  if (!Array.isArray(entry.days) || entry.days.length === 0) {
    return result(year, "INVALID_DAYS", ["days must be a non-empty array"], entry);
  }

  const seen = new Set<string>();
  for (const [i, day] of entry.days.entries()) {
    if (!day || typeof day !== "object") {
      problems.push(`days[${i}] is not an object`);
      continue;
    }
    if (typeof day.date !== "string" || !isRealDate(day.date)) {
      problems.push(`days[${i}].date must be YYYY-MM-DD`);
      continue;
    }
    if (!day.date.startsWith(`${year}-`)) {
      problems.push(`days[${i}] ${day.date} is outside ${year}`);
    }
    if (typeof day.label !== "string" || day.label.trim() === "") {
      problems.push(`days[${i}] ${day.date} has no label`);
    }
    if (day.kind !== "annual" && day.kind !== "special") {
      problems.push(`days[${i}] ${day.date} kind must be annual|special`);
    }
    if (seen.has(day.date)) problems.push(`days[${i}] ${day.date} duplicated`);
    seen.add(day.date);
  }
  if (problems.length) return result(year, "INVALID_DAYS", problems, entry);

  return result(year, "VERIFIED", [], entry);
}

/** Years present in a document (for the health/status surface). */
export function listedYears(raw: unknown): number[] {
  try {
    const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!doc?.years || typeof doc.years !== "object") return [];
    return Object.keys(doc.years).map(Number).filter((n) => Number.isFinite(n)).sort();
  } catch {
    return [];
  }
}
