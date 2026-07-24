import { supabaseAdmin as supabase } from "@/services/supabase/queries";

export interface EnrichedRecord {
  id: string;
  name: string;
  type?: string;
  address?: string;
  phone?: string;
  lat?: number;
  lng?: number;
  distance_km?: number;
  materials?: string[];
  prices?: Record<string, number>;
  extra?: Record<string, unknown>;
}

export async function enrichPitResults(
  pits: Record<string, unknown>[],
  userLat?: number,
  userLng?: number,
  calcDistanceFn?: (input: { from_lat: number; from_lng: number; to_lat: number; to_lng: number }) => Promise<{ distance_km: number }>,
): Promise<EnrichedRecord[]> {
  const results: EnrichedRecord[] = [];

  for (const pit of pits) {
    const id = (pit.id ?? pit.pit_id) as string;
    const lat = parseFloat(String(pit.latitude ?? pit.lat ?? 0));
    const lng = parseFloat(String(pit.longitude ?? pit.lng ?? 0));

    // ดึงวัสดุ + ราคาจาก pit_materials
    const { data: mats } = await supabase()
      .from("pit_materials")
      .select("material_type_id, price")
      .eq("pit_profile_id", id)
      .is("deleted_at", null);

    const matIds = (mats ?? []).map((m) => m.material_type_id);
    let materialNames: string[] = [];
    const prices: Record<string, number> = {};

    if (matIds.length > 0) {
      const { data: matTypes } = await supabase()
        .from("material_types")
        .select("id, name")
        .in("id", matIds);

      for (const m of mats ?? []) {
        const matName = matTypes?.find((t) => t.id === m.material_type_id)?.name ?? "ไม่ทราบ";
        materialNames.push(matName);
        prices[matName] = m.price;
      }
    }

    let distance_km: number | undefined;
    if (userLat && userLng && lat && lng && calcDistanceFn) {
      const dist = await calcDistanceFn({ from_lat: userLat, from_lng: userLng, to_lat: lat, to_lng: lng });
      distance_km = dist.distance_km;
    }

    results.push({
      id,
      name: String(pit.pit_name ?? pit.name ?? "-"),
      address: String(pit.address ?? "-"),
      lat,
      lng,
      distance_km,
      materials: materialNames.length > 0 ? materialNames : undefined,
      prices: Object.keys(prices).length > 0 ? prices : undefined,
    });
  }

  // เรียงตามระยะทาง (ถ้ามี)
  if (results[0]?.distance_km !== undefined) {
    results.sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999));
  }

  return results;
}

export async function enrichPartnerResults(
  partners: Record<string, unknown>[]
): Promise<EnrichedRecord[]> {
  return partners.map((p) => ({
    id: String(p.id ?? ""),
    name: String(p.name ?? "-"),
    type: String(p.partner_type_label ?? p.type ?? "-"),
    phone: String(p.phone ?? "-"),
    address: String(p.address ?? "-"),
  }));
}
