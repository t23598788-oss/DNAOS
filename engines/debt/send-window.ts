/**
 * Debt Reminder Send Window — PURE, no I/O.
 *
 * Thai law (พระราชบัญญัติการทวงถามหนี้ พ.ศ. ๒๕๕๘, มาตรา ๘) limits when a debtor
 * may be contacted for collection:
 *   • Monday–Friday   08:00–20:00
 *   • public holidays 08:00–18:00
 * and allows at most one collection contact per day. The frequency half is
 * enforced by the reminder key + the database send-once guard; this module
 * enforces the clock half, and it is deliberately conservative: weekends are
 * treated as public holidays (18:00 close) because the official holiday
 * calendar is a moving target that must come from configuration, not from a
 * hardcoded list that silently goes stale.
 *
 * The caller supplies the holiday dates it considers authoritative
 * (`app_configs.debt-reminder-holiday-dates`, comma-separated YYYY-MM-DD,
 * Bangkok business dates). An empty list means "weekends only", which is
 * weaker than the statute for mid-week holidays — that gap is reported, not
 * hidden behind a guess.
 */

export type DayKind = "WEEKDAY" | "WEEKEND" | "PUBLIC_HOLIDAY";

export interface SendWindowPlan {
  allowed: boolean;
  reason?: "OUTSIDE_ALLOWED_HOURS";
  businessDate: string;
  hour: number;
  minute: number;
  dayKind: DayKind;
  windowStart: string;
  windowEnd: string;
  /** the statute clause this decision comes from, for the audit trail */
  legalBasis: string;
}

export interface SendWindowInput {
  now: Date;
  timeZone?: string;
  /** YYYY-MM-DD business dates that are public holidays */
  holidays?: string[];
}

const DEFAULT_TZ = "Asia/Bangkok";

const WEEKDAY_NAMES: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function parts(now: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return {
    businessDate: `${out.year}-${out.month}-${out.day}`,
    hour: Number(out.hour),
    minute: Number(out.minute),
    weekday: WEEKDAY_NAMES[out.weekday] ?? 1,
  };
}

export interface ReminderTickPlan {
  /** may this invocation send? */
  run: boolean;
  reason?: "OUTSIDE_ALLOWED_HOURS" | "BEFORE_CONFIGURED_HOUR";
  /** true when the configured hour already passed today — a missed slot is caught up */
  catchUp: boolean;
  window: SendWindowPlan;
}

/**
 * May THIS scheduler invocation run? The cron fires every 10 minutes, so the old
 * `hour === configured` test silently dropped the whole day whenever the
 * configured hour was missed (deploy, outage, cold start). Running on
 * `hour >= configured` inside the statutory window turns that into a catch-up;
 * repeats stay harmless because one reminder per document per day is enforced
 * by the reminder key and the database send-once guard.
 */
export function planReminderTick(input: {
  now: Date;
  configuredHour: number;
  holidays?: string[];
  timeZone?: string;
}): ReminderTickPlan {
  const window = planSendWindow({ now: input.now, holidays: input.holidays, timeZone: input.timeZone });
  if (!window.allowed) {
    return { run: false, reason: "OUTSIDE_ALLOWED_HOURS", catchUp: false, window };
  }
  const configured = Number.isFinite(input.configuredHour) ? input.configuredHour : 9;
  if (window.hour < configured) {
    return { run: false, reason: "BEFORE_CONFIGURED_HOUR", catchUp: false, window };
  }
  return { run: true, catchUp: window.hour > configured, window };
}

export function planSendWindow(input: SendWindowInput): SendWindowPlan {
  const tz = input.timeZone ?? DEFAULT_TZ;
  const { businessDate, hour, minute, weekday } = parts(input.now, tz);
  const holidays = new Set((input.holidays ?? []).map((d) => d.trim()).filter(Boolean));

  const dayKind: DayKind = holidays.has(businessDate)
    ? "PUBLIC_HOLIDAY"
    : weekday === 0 || weekday === 6
      ? "WEEKEND"
      : "WEEKDAY";

  const windowStart = "08:00";
  const windowEnd = dayKind === "WEEKDAY" ? "20:00" : "18:00";
  const endHour = dayKind === "WEEKDAY" ? 20 : 18;

  const allowed = hour >= 8 && hour < endHour;
  return {
    allowed,
    reason: allowed ? undefined : "OUTSIDE_ALLOWED_HOURS",
    businessDate,
    hour,
    minute,
    dayKind,
    windowStart,
    windowEnd,
    legalBasis:
      "พ.ร.บ.การทวงถามหนี้ พ.ศ. 2558 มาตรา 8 — ติดต่อทวงถามได้ จ.–ศ. 08:00–20:00 น. / วันหยุดราชการ 08:00–18:00 น. และไม่เกินวันละ 1 ครั้ง",
  };
}
