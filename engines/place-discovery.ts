/**
 * External place discovery for construction-material suppliers.
 *
 * Reuses the existing location/matching pipeline:
 * discovered place -> GPS/name/address -> existing material matching/ranking.
 *
 * This module is read-only discovery. It does not write pit_profiles,
 * pit_materials, contacts, prices, or any production data.
 *
 * Google Places API (New) Text Search requires an API key and an explicit
 * X-Goog-FieldMask. Missing credentials fail closed with a structured result.
 */

export interface DiscoveredPlace {
  provider: "google_places";
  external_place_id: string;
  name: string;
  formatted_address?: string;
  lat?: number;
  lng?: number;
  primary_type?: string;
  business_status?: string;
  google_maps_uri?: string;
  discovered_from_query: string;
}

export interface PlaceDiscoveryResult {
  ok: boolean;
  query: string;
  places: DiscoveredPlace[];
  error?: string;
}

export interface GooglePlacesDiscoveryOptions {
  apiKey?: string;
  regionCode?: string;
  languageCode?: string;
}

const GOOGLE_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.primaryType",
  "places.businessStatus",
  "places.googleMapsUri",
].join(",");

export const KHON_KAEN_MATERIAL_DISCOVERY_QUERIES = [
  "โรงโม่หิน ขอนแก่น",
  "บ่อทราย ขอนแก่น",
  "ทรายก่อสร้าง ขอนแก่น",
  "หินคลุก ขอนแก่น",
  "ลูกรัง ขอนแก่น",
  "ดินถม ขอนแก่น",
  "คอนกรีตผสมเสร็จ ขอนแก่น",
  "ปูนผสมเสร็จ ขอนแก่น",
  "วัสดุก่อสร้าง ขอนแก่น",
] as const;

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  businessStatus?: string;
  googleMapsUri?: string;
};

type GoogleTextSearchResponse = {
  places?: GooglePlace[];
};

function resolveApiKey(explicit?: string): string | undefined {
  return explicit
    ?? process.env.GOOGLE_PLACES_API_KEY
    ?? process.env.GOOGLE_MAPS_API_KEY;
}

export async function searchGooglePlaces(
  textQuery: string,
  options: GooglePlacesDiscoveryOptions = {},
): Promise<PlaceDiscoveryResult> {
  const query = textQuery.trim();
  if (!query) {
    return { ok: false, query, places: [], error: "คำค้นว่างเปล่า" };
  }

  const apiKey = resolveApiKey(options.apiKey);
  if (!apiKey) {
    return {
      ok: false,
      query,
      places: [],
      error: "GOOGLE_PLACES_API_KEY หรือ GOOGLE_MAPS_API_KEY ยังไม่ได้ตั้งค่า",
    };
  }

  let response: Response;
  try {
    response = await fetch(GOOGLE_TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: query,
        regionCode: options.regionCode ?? "TH",
        languageCode: options.languageCode ?? "th",
      }),
    });
  } catch (error) {
    return {
      ok: false,
      query,
      places: [],
      error: `เรียก Google Places ไม่สำเร็จ: ${(error as Error).message}`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      query,
      places: [],
      error: `Google Places ตอบ HTTP ${response.status}`,
    };
  }

  const payload = await response.json().catch(() => null) as GoogleTextSearchResponse | null;
  const places = (payload?.places ?? [])
    .filter((place): place is GooglePlace & { id: string } => Boolean(place.id))
    .map((place) => ({
      provider: "google_places" as const,
      external_place_id: place.id,
      name: place.displayName?.text?.trim() || place.formattedAddress?.trim() || place.id,
      formatted_address: place.formattedAddress,
      lat: place.location?.latitude,
      lng: place.location?.longitude,
      primary_type: place.primaryType,
      business_status: place.businessStatus,
      google_maps_uri: place.googleMapsUri,
      discovered_from_query: query,
    }));

  return { ok: true, query, places };
}

/**
 * Runs a caller-selected query set and de-duplicates by Google Place ID.
 * No persistence happens here; callers decide which candidates are real
 * enough to review/import into the existing business tables.
 */
export async function discoverKhonKaenMaterialPlaces(
  queries: readonly string[] = KHON_KAEN_MATERIAL_DISCOVERY_QUERIES,
  options: GooglePlacesDiscoveryOptions = {},
): Promise<{ ok: boolean; places: DiscoveredPlace[]; errors: string[] }> {
  const byPlaceId = new Map<string, DiscoveredPlace>();
  const errors: string[] = [];

  for (const query of queries) {
    const result = await searchGooglePlaces(query, options);
    if (!result.ok) {
      errors.push(`${query}: ${result.error ?? "ค้นหาไม่สำเร็จ"}`);
      continue;
    }
    for (const place of result.places) {
      if (!byPlaceId.has(place.external_place_id)) {
        byPlaceId.set(place.external_place_id, place);
      }
    }
  }

  return {
    ok: errors.length === 0,
    places: Array.from(byPlaceId.values()),
    errors,
  };
}
