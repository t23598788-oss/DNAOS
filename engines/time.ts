import { loadConfigs, getNum, audit, type AuditTrail } from "@/core/config-loader";

export interface TimeInput {
  distance_km: number;
  trips: number;
}

export interface TimeResult {
  hours_per_trip: number;
  total_hours: number;
  audit: AuditTrail;
}

export async function calcTime(input: TimeInput): Promise<TimeResult> {
  const configs = await loadConfigs();
  const avgSpeed = getNum(configs, "avg-speed-kmh");
  const loadUnloadMin = getNum(configs, "load-unload-minutes");

  const driveHours = input.distance_km / avgSpeed;
  const loadHours = loadUnloadMin / 60;
  const roundTrip = (driveHours * 2) + loadHours;
  const total = roundTrip * input.trips;

  const rules = { avg_speed_kmh: avgSpeed, load_unload_minutes: loadUnloadMin, formula: "(distance/speed)*2 + load_time" };

  return {
    hours_per_trip: parseFloat(roundTrip.toFixed(2)),
    total_hours: parseFloat(total.toFixed(2)),
    audit: audit("time", input, rules, { hours_per_trip: roundTrip, total_hours: total }),
  };
}
