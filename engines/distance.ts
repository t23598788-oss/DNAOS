import { supabase } from "@/services/supabase/queries";
import { loadConfigs, getNum, audit, type AuditTrail } from "@/core/config-loader";

export interface DistanceInput {
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
}

export interface DistanceResult {
  distance_km: number;
  nearest_pit?: { id: string; name: string; distance_km: number };
  audit: AuditTrail;
}

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function calcDistance(input: DistanceInput): Promise<DistanceResult> {
  const configs = await loadConfigs(supabase());
  const minDistance = getNum(configs, "minimum-distance");

  const km = haversine(input.from_lat, input.from_lng, input.to_lat, input.to_lng);
  const distance_km = Math.max(km, minDistance);

  return {
    distance_km: parseFloat(distance_km.toFixed(2)),
    audit: audit("distance", input, { minimum_distance: minDistance, formula: "haversine" }, { distance_km }),
  };
}

export async function findNearestPit(lat: number, lng: number, materialTypeId?: string): Promise<DistanceResult> {
  const configs = await loadConfigs(supabase());
  const minDistance = getNum(configs, "minimum-distance");

  let query = supabase()
    .from("pit_profiles")
    .select("id, pit_name, latitude, longitude")
    .is("deleted_at", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  if (materialTypeId) {
    const { data: mats } = await supabase()
      .from("pit_materials")
      .select("pit_profile_id")
      .eq("material_type_id", materialTypeId);
    if (mats && mats.length > 0) {
      query = query.in("id", mats.map((m) => m.pit_profile_id));
    }
  }

  const { data: pits, error } = await query;
  if (error) throw new Error(`distance.findNearestPit: ${error.message}`);

  let nearest: { id: string; name: string; distance_km: number } | undefined;
  let minDist = Infinity;

  for (const pit of pits ?? []) {
    const d = haversine(lat, lng, parseFloat(pit.latitude), parseFloat(pit.longitude));
    if (d < minDist) {
      minDist = d;
      nearest = { id: pit.id, name: pit.pit_name, distance_km: parseFloat(Math.max(d, minDistance).toFixed(2)) };
    }
  }

  return {
    distance_km: nearest?.distance_km ?? minDistance,
    nearest_pit: nearest,
    audit: audit("distance.nearest_pit", { lat, lng, materialTypeId }, { minimum_distance: minDistance, pits_checked: pits?.length ?? 0 }, { nearest }),
  };
}
