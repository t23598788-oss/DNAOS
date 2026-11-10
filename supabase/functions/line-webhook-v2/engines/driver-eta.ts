import { calculatePlannedEta } from "../../../../engines/eta-calculator.ts";
import { ResponseGateway } from "../engines/response.ts";

/**
 * Driver LINE bot — reads app_configs, computes ETA, replies to the driver.
 * All times: ISO 8601 UTC. Pure function + caller-side DB query.
 */

// Defaults from app_configs (step 2A.1): loading-time-minutes-default=30,
// avg-transit-speed-kmh=45.
const LOADING_MIN_DEFAULT = 30;
const AVG_SPEED_KMH_DEFAULT = 45;

export interface DriverEtaInput {
  license_plate: string;
  distance_km: number;
  dispatch_at: string;             // ISO 8601
  loading_min?: number;            // overrides config default
  avg_speed_kmh?: number;          // overrides config default
}

export interface DriverEtaResult {
  plate: string;
  distance_km: number;
  loading_min: number;
  transit_min: number;
  planned_arrival_at: string;
  eta_text: string;
  is_late: boolean;
  late_by_min: number;
}

/**
 * Compute driver ETA from the trip data already stored in the DB.
 * Returns a ready-to-send LINE reply text (English + Thai).
 */
export async function computeDriverEta(input: DriverEtaInput): Promise<DriverEtaResult> {
  const { distance_km, dispatch_at, loading_min = LOADING_MIN_DEFAULT, avg_speed_kmh = AVG_SPEED_KMH_DEFAULT } = input;

  const eta = calculatePlannedEta({
    distance_km,
    dispatch_at,
    loading_min,
    avg_speed_kmh,
  });

  const arrivalDate = new Date(eta.planned_arrival_at);
  const fmt = (d: Date) => d.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const etaText = `📦 **ETA for plate ${input.license_plate}**\n` +
    `Distance: ${distance_km} km\n` +
    `Load: ${loading_min} min\n` +
    `Transit: ~${eta.transit_min} min\n` +
    `Dispatch: ${fmt(arrivalDate)}\n` +
    `Expected at: ${fmt(arrivalDate)}\n` +
    `Arrival: ${fmt(arrivalDate)}\n\n` +
    `ส่งของถึงที่หมาย: ${fmt(arrivalDate)}`;

  return {
    plate: input.license_plate,
    distance_km,
    loading_min,
    transit_min: eta.transit_min,
    planned_arrival_at: eta.planned_arrival_at,
    eta_text: etaText,
    is_late: false,
    late_by_min: 0,
  };
}
