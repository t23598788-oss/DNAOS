/**
 * Geocoding Service — Longdo Map Search API (owner choice, 2026-07-24).
 *
 * Converts a Thai text address into lat/lng, for the case where a customer
 * types an address instead of sharing a live LINE location pin (the only
 * geocoded-coordinate source that existed before this file — see
 * supabase/functions/line-webhook-v2/handlers/location.ts, which only
 * parses LINE's own already-geocoded location-share string).
 *
 * Same "build the real integration now, gate cleanly on a missing
 * credential" pattern as TASK-017 (LINE_CHANNEL_ACCESS_TOKEN,
 * registry/CHANGELOG.json 2026-07-07/18) — no LONGDO_MAP_API_KEY exists in
 * this environment's .env.local or Vercel project today (checked directly,
 * not assumed), so this returns a clear, structured "not configured" error
 * instead of throwing, until the owner adds the real key.
 *
 * HONESTY NOTE: the request shape below (search.longdo.com/mapsearch/json/
 * search, `data[].lon`/`data[].lat`) matches Longdo's own published Search
 * API documentation, but has NOT been exercised against a live key in this
 * session — no key exists to test against. Verify the response shape for
 * real once LONGDO_MAP_API_KEY is set, per Rule 109 (verify before trusting).
 */

export interface GeocodeResult {
  ok: boolean;
  lat?: number;
  lng?: number;
  matchedAddress?: string;
  error?: string;
}

const LONGDO_SEARCH_URL = "https://search.longdo.com/mapsearch/json/search";

export async function geocodeThaiAddress(addressText: string): Promise<GeocodeResult> {
  const key = process.env.LONGDO_MAP_API_KEY;
  if (!key) {
    return {
      ok: false,
      error: "LONGDO_MAP_API_KEY ยังไม่ได้ตั้งค่า — ดู .env.local.example",
    };
  }

  const trimmed = addressText.trim();
  if (!trimmed) {
    return { ok: false, error: "ที่อยู่ว่างเปล่า" };
  }

  const url = `${LONGDO_SEARCH_URL}?key=${encodeURIComponent(key)}&keyword=${encodeURIComponent(trimmed)}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    return { ok: false, error: `เรียก Longdo API ไม่สำเร็จ: ${(e as Error).message}` };
  }

  if (!res.ok) {
    return { ok: false, error: `Longdo API ตอบกลับผิดพลาด: HTTP ${res.status}` };
  }

  const data = await res.json().catch(() => null) as { data?: { lon?: number; lat?: number; name?: string }[] } | null;
  const first = data?.data?.[0];
  if (!first || first.lat == null || first.lon == null) {
    return { ok: false, error: `ไม่พบพิกัดสำหรับที่อยู่นี้: "${trimmed}"` };
  }

  return {
    ok: true,
    lat: first.lat,
    lng: first.lon,
    matchedAddress: first.name ?? trimmed,
  };
}
