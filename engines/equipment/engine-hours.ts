/**
 * Equipment GPS/Relay — Engine-Hours Accumulator (owner spec 2026-07-24,
 * implemented 2026-08-04 per docs/equipment-maintenance-lock-module.md).
 *
 * Given a stream of telemetry pings (timestamp + engine-running boolean,
 * derived by the caller from VCC >= 13.5V), this computes real accumulated
 * engine-running hours: the time-delta between two CONSECUTIVE pings for
 * the same asset counts as running time only if BOTH pings report the
 * engine running. A single ping never adds hours on its own — hours only
 * accrue across a pair of "still running" observations, which is what a
 * "was the engine on between these two points in time" signal actually
 * supports.
 *
 * MAX_GAP_HOURS reasoning (not an invented business number, an engineering
 * ceiling): the doc states telemetry pings arrive every 10-30s while the
 * engine runs. A gap between consecutive running pings larger than that
 * means either a dropped connection or a missed ping window, not 45
 * minutes of unobserved running. Capping any single delta at 0.5h (30 min)
 * — 60-180x the expected ping interval, generous headroom for a few missed
 * pings in a row — means a real multi-hour connectivity outage cannot be
 * miscounted as multiple hours of engine-running time, while still
 * tolerating normal jitter/missed pings without undercounting real usage.
 */

export const MAX_GAP_HOURS = 0.5

export interface TelemetryPing {
  recordedAt: string // ISO timestamp
  engineRunning: boolean
}

export interface EngineHoursDelta {
  deltaHours: number
  cappedFromHours: number | null // if the raw gap was larger than MAX_GAP_HOURS, the raw value (for logging/audit), else null
}

/**
 * Pure function: given the previous ping (may be null if this is the
 * asset's first-ever ping) and the new incoming ping, compute how many
 * engine-hours to add.
 */
export function computeEngineHoursDelta(previous: TelemetryPing | null, incoming: TelemetryPing): EngineHoursDelta {
  if (!previous || !previous.engineRunning || !incoming.engineRunning) {
    return { deltaHours: 0, cappedFromHours: null }
  }

  const prevMs = new Date(previous.recordedAt).getTime()
  const curMs = new Date(incoming.recordedAt).getTime()
  if (!Number.isFinite(prevMs) || !Number.isFinite(curMs) || curMs <= prevMs) {
    // Out-of-order or malformed timestamp — never subtract hours or trust
    // a negative/zero delta as real running time.
    return { deltaHours: 0, cappedFromHours: null }
  }

  const rawHours = (curMs - prevMs) / (1000 * 60 * 60)
  if (rawHours > MAX_GAP_HOURS) {
    return { deltaHours: MAX_GAP_HOURS, cappedFromHours: rawHours }
  }
  return { deltaHours: rawHours, cappedFromHours: null }
}

export interface AccumulateResult {
  ok: boolean
  error?: string
  deltaHours?: number
  cappedFromHours?: number | null
  newTotalHours?: number
}

/**
 * DB-touching accumulation: reads the most recent prior ping for this
 * asset (strictly before the incoming ping's timestamp), computes the
 * delta, and applies it to equipment_assets.total_engine_hours. Caller is
 * responsible for inserting the new ping row itself (kept separate so the
 * ingestion route controls transactional ordering).
 */
export async function accumulateEngineHours(
  db: any,
  equipmentId: string,
  incoming: TelemetryPing
): Promise<AccumulateResult> {
  const { data: prevRow, error: prevErr } = await db
    .from("equipment_telemetry_pings")
    .select("recorded_at, engine_running")
    .eq("equipment_id", equipmentId)
    .lt("recorded_at", incoming.recordedAt)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (prevErr) {
    return { ok: false, error: `อ่าน telemetry ก่อนหน้าไม่สำเร็จ: ${prevErr.message}` }
  }

  const previous: TelemetryPing | null = prevRow
    ? { recordedAt: prevRow.recorded_at, engineRunning: prevRow.engine_running }
    : null

  const { deltaHours, cappedFromHours } = computeEngineHoursDelta(previous, incoming)

  if (deltaHours <= 0) {
    return { ok: true, deltaHours: 0, cappedFromHours, newTotalHours: undefined }
  }

  const { data: assetRow, error: assetErr } = await db
    .from("equipment_assets")
    .select("total_engine_hours")
    .eq("id", equipmentId)
    .maybeSingle()

  if (assetErr || !assetRow) {
    return { ok: false, error: `อ่าน equipment_assets ไม่สำเร็จ: ${assetErr?.message ?? "ไม่พบเครื่องจักร"}` }
  }

  const newTotalHours = Number(assetRow.total_engine_hours ?? 0) + deltaHours

  const { error: updateErr } = await db
    .from("equipment_assets")
    .update({ total_engine_hours: newTotalHours, updated_at: new Date().toISOString() })
    .eq("id", equipmentId)

  if (updateErr) {
    return { ok: false, error: `อัปเดตชั่วโมงเครื่องไม่สำเร็จ: ${updateErr.message}` }
  }

  return { ok: true, deltaHours, cappedFromHours, newTotalHours }
}
