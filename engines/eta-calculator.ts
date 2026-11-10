/** ETA calculator — pure function, no DB access.
 *  Reads defaults from caller (caller reads app_configs).
 *  All times are ISO 8601 strings.
 */

export interface EtaInput {
  distance_km: number;
  dispatch_at: string;            // ISO 8601
  loading_min: number;            // from config or override
  avg_speed_kmh: number;          // from config or override
}

export interface EtaResult {
  dispatch_at: string;
  loading_min: number;
  transit_min: number;            // = round(distance / speed * 60)
  planned_arrival_at: string;     // dispatch + loading + transit
  breakdown: {
    distance_km: number;
    avg_speed_kmh: number;
  };
}

export function calculatePlannedEta(input: EtaInput): EtaResult {
  if (!Number.isFinite(input.distance_km) || input.distance_km <= 0) {
    throw new Error("ETA_INVALID_DISTANCE: distance_km must be > 0");
  }
  if (!Number.isFinite(input.avg_speed_kmh) || input.avg_speed_kmh <= 0) {
    throw new Error("ETA_INVALID_SPEED: avg_speed_kmh must be > 0");
  }
  if (!Number.isFinite(input.loading_min) || input.loading_min < 0) {
    throw new Error("ETA_INVALID_LOADING: loading_min must be >= 0");
  }
  const dispatchMs = Date.parse(input.dispatch_at);
  if (!Number.isFinite(dispatchMs)) {
    throw new Error("ETA_INVALID_DISPATCH: dispatch_at is not a valid ISO date");
  }
  const transit_min = Math.round((input.distance_km / input.avg_speed_kmh) * 60);
  const arrivalMs = dispatchMs + (input.loading_min + transit_min) * 60_000;
  return {
    dispatch_at: new Date(dispatchMs).toISOString(),
    loading_min: input.loading_min,
    transit_min,
    planned_arrival_at: new Date(arrivalMs).toISOString(),
    breakdown: { distance_km: input.distance_km, avg_speed_kmh: input.avg_speed_kmh },
  };
}

export interface CurrentEtaInput {
  status: "scheduled" | "loading" | "in_transit" | "arrived" | "delivered" | "failed";
  dispatch_at: string | null;
  planned_loading_min: number | null;
  planned_transit_min: number | null;
  planned_arrival_at: string | null;
  now?: string;                   // ISO; defaults to server now
}

export interface CurrentEtaResult {
  status: string;
  remaining_min: number | null;   // null if delivered/failed
  expected_at: string | null;
  is_late: boolean;
  late_by_min: number;            // 0 if not late
}

export function estimateCurrentEta(input: CurrentEtaInput): CurrentEtaResult {
  if (input.status === "delivered" || input.status === "failed") {
    return { status: input.status, remaining_min: null, expected_at: null, is_late: false, late_by_min: 0 };
  }
  const nowMs = input.now ? Date.parse(input.now) : Date.now();
  if (!Number.isFinite(nowMs)) throw new Error("ETA_INVALID_NOW");
  if (!input.planned_arrival_at) {
    return { status: input.status, remaining_min: null, expected_at: null, is_late: false, late_by_min: 0 };
  }
  const plannedMs = Date.parse(input.planned_arrival_at);
  const remaining = Math.max(0, Math.round((plannedMs - nowMs) / 60_000));
  const isLate = nowMs > plannedMs;
  return {
    status: input.status,
    remaining_min: remaining,
    expected_at: new Date(plannedMs).toISOString(),
    is_late: isLate,
    late_by_min: isLate ? Math.round((nowMs - plannedMs) / 60_000) : 0,
  };
}
