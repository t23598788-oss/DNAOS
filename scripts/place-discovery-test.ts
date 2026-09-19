import assert from "node:assert/strict";
import {
  discoverKhonKaenMaterialPlaces,
  searchGooglePlaces,
} from "@/engines/place-discovery";

async function main() {
  const originalFetch = globalThis.fetch;
  const originalPlacesKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalMapsKey = process.env.GOOGLE_MAPS_API_KEY;

  try {
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("fetch must not run without credentials");
    }) as typeof fetch;

    const missing = await searchGooglePlaces("บ่อทราย ขอนแก่น");
    assert.equal(missing.ok, false);
    assert.equal(fetchCalled, false);
    assert.match(missing.error ?? "", /GOOGLE_PLACES_API_KEY|GOOGLE_MAPS_API_KEY/);

    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    const seenQueries: string[] = [];

    globalThis.fetch = (async (input, init) => {
      assert.equal(String(input), "https://places.googleapis.com/v1/places:searchText");
      assert.equal(init?.method, "POST");

      const headers = new Headers(init?.headers);
      assert.equal(headers.get("X-Goog-Api-Key"), "test-key");
      assert.match(headers.get("X-Goog-FieldMask") ?? "", /places\.id/);
      assert.match(headers.get("X-Goog-FieldMask") ?? "", /places\.location/);

      const body = JSON.parse(String(init?.body ?? "{}")) as { textQuery?: string; regionCode?: string; languageCode?: string };
      assert.equal(body.regionCode, "TH");
      assert.equal(body.languageCode, "th");
      seenQueries.push(body.textQuery ?? "");

      const places = body.textQuery?.includes("ทราย")
        ? [
            {
              id: "place-sand-1",
              displayName: { text: "บ่อทรายทดสอบ" },
              formattedAddress: "ขอนแก่น ประเทศไทย",
              location: { latitude: 16.44, longitude: 102.84 },
              primaryType: "store",
              businessStatus: "OPERATIONAL",
              googleMapsUri: "https://maps.google.com/?cid=test",
            },
            {
              id: "place-shared",
              displayName: { text: "วัสดุก่อสร้างร่วม" },
              location: { latitude: 16.45, longitude: 102.85 },
            },
          ]
        : [
            {
              id: "place-rock-1",
              displayName: { text: "โรงโม่หินทดสอบ" },
              location: { latitude: 16.46, longitude: 102.86 },
            },
            {
              id: "place-shared",
              displayName: { text: "วัสดุก่อสร้างร่วม" },
              location: { latitude: 16.45, longitude: 102.85 },
            },
          ];

      return new Response(JSON.stringify({ places }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const batch = await discoverKhonKaenMaterialPlaces([
      "บ่อทราย ขอนแก่น",
      "โรงโม่หิน ขอนแก่น",
    ]);

    assert.equal(batch.ok, true);
    assert.equal(batch.errors.length, 0);
    assert.equal(batch.places.length, 3);
    assert.deepEqual(seenQueries, ["บ่อทราย ขอนแก่น", "โรงโม่หิน ขอนแก่น"]);

    const sand = batch.places.find((place) => place.external_place_id === "place-sand-1");
    assert.equal(sand?.name, "บ่อทรายทดสอบ");
    assert.equal(sand?.lat, 16.44);
    assert.equal(sand?.lng, 102.84);
    assert.equal(sand?.discovered_from_query, "บ่อทราย ขอนแก่น");

    console.log("place-discovery:test PASS");
    console.log("checks: missing-credential fail-closed, Google request shape, Thai/TH bias, normalization, Place ID dedupe");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPlacesKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = originalPlacesKey;
    if (originalMapsKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalMapsKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
