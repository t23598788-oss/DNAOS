import { supabaseAdmin as supabase } from "@/services/supabase/queries";
import { audit, type AuditTrail } from "@/core/config-loader";
import { decidePublication, type OwnerEvidence, type PublicationState } from "./matching/publication";

export interface DistanceInput {
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
}

export interface DistanceResult {
  distance_km: number;
  nearest_pit?: {
    id: string;
    name: string;
    distance_km: number;
    /** Evidence only — never proof of ownership (engines/matching/publication.ts) */
    owner_evidence: OwnerEvidence;
    owner_verified: boolean;
    publication_state: PublicationState;
  };
  audit: AuditTrail;
}

export interface NearestPitOptions {
  /**
   * Trusted internal jobs only (never an external/user/AI request).
   * External matching MUST stay on published supply: deleted_at IS NULL,
   * is_open = true, and at least one real price > 0.
   */
  includeUnpublished?: boolean;
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
  // No minimum-distance floor (owner, 2026-07-24): "ไม่มีขั้นต่ำระยะทาง...
  // จะวิ่งกิโลเดียวก็ราคานี้อยู่แล้ว" — the real cost is always
  // fuel(real distance) + material + driver wage, even for a 1km job.
  // A floor here would silently overcharge every short-haul trip.
  const km = haversine(input.from_lat, input.from_lng, input.to_lat, input.to_lng);
  const distance_km = parseFloat(km.toFixed(2));

  return {
    distance_km,
    audit: audit("distance", input, { formula: "haversine, no minimum floor" }, { distance_km }),
  };
}

export async function findNearestPit(
  lat: number,
  lng: number,
  materialTypeId?: string,
  options?: NearestPitOptions,
): Promise<DistanceResult> {
  const includeUnpublished = options?.includeUnpublished === true;

  let query = supabase()
    .from("pit_profiles")
    .select("id, pit_name, latitude, longitude, is_open, deleted_at, user_id, line_user_id")
    .is("deleted_at", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  // PUBLICATION BOUNDARY: an external match may only see supply that is open.
  // The query itself stays minimal — the single decision still goes through
  // decidePublication() so price/owner evidence is applied identically here.
  if (!includeUnpublished) query = query.eq("is_open", true);

  const { data: pits, error } = await query;
  if (error) throw new Error(`distance.findNearestPit: ${error.message}`);

  // A pit is a real offer for a material only when the link still exists and
  // carries a real price (> 0). Before this fix an empty/absent price list was
  // silently treated as "no material filter" and every pit could win.
  let linksQuery = supabase()
    .from("pit_materials")
    .select("pit_profile_id, material_type_id, price")
    .is("deleted_at", null);
  if (materialTypeId) linksQuery = linksQuery.eq("material_type_id", materialTypeId);
  const { data: linkRows, error: linkError } = await linksQuery;
  if (linkError) throw new Error(`distance.findNearestPit: ${linkError.message}`);

  const linkedPits = new Set<string>();
  const pricesByPit = new Map<string, number[]>();
  for (const link of (linkRows ?? []) as { pit_profile_id: string; price: number | null }[]) {
    linkedPits.add(link.pit_profile_id);
    const list = pricesByPit.get(link.pit_profile_id) ?? [];
    if (link.price != null) list.push(Number(link.price));
    pricesByPit.set(link.pit_profile_id, list);
  }

  type NearestPit = NonNullable<DistanceResult["nearest_pit"]>;
  let nearest: NearestPit | undefined;
  let minDist = Infinity;
  let pitsChecked = 0;
  let excludedUnpublished = 0;

  for (const pit of pits ?? []) {
    // Material was requested → the pit must actually link that material.
    if (materialTypeId && !linkedPits.has(pit.id)) continue;

    const decision = decidePublication({
      deleted_at: pit.deleted_at,
      is_open: pit.is_open,
      user_id: pit.user_id,
      line_user_id: pit.line_user_id,
      prices: pricesByPit.get(pit.id) ?? [],
    });
    // Internal callers may read unpublished rows, but a public match may not.
    if (!includeUnpublished && !decision.matchable) {
      excludedUnpublished += 1;
      continue;
    }
    pitsChecked += 1;

    const d = haversine(lat, lng, parseFloat(pit.latitude), parseFloat(pit.longitude));
    if (d < minDist) {
      minDist = d;
      nearest = {
        id: pit.id,
        name: pit.pit_name,
        distance_km: parseFloat(d.toFixed(2)),
        owner_evidence: decision.owner_evidence,
        owner_verified: decision.owner_verified,
        publication_state: decision.state,
      };
    }
  }

  return {
    distance_km: nearest?.distance_km ?? 0,
    nearest_pit: nearest,
    audit: audit(
      "distance.nearest_pit",
      { lat, lng, materialTypeId, includeUnpublished },
      { formula: "haversine, no minimum floor" },
      {
        nearest,
        pits_checked: pitsChecked,
        excluded_unpublished_or_unpriced: excludedUnpublished,
        publication_boundary: includeUnpublished ? "INTERNAL_ALL" : "PUBLISHED_ONLY",
      },
    ),
  };
}
