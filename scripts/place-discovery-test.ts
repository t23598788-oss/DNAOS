/**
 * Regression test for engines/place-discovery.ts.
 *
 * Proves, with the network fully stubbed (globalThis.fetch is replaced and no
 * live Google request is ever made): the Google Places Text Search request
 * shape (endpoint, POST, X-Goog-Api-Key, X-Goog-FieldMask, Thai/TH bias),
 * normalization of a Google response into DiscoveredPlace, Place-ID
 * de-duplication across queries, and fail-closed behaviour when no credential
 * is configured (fetch must never be called). Runs keyless: the test deletes
 * GOOGLE_PLACES_API_KEY/GOOGLE_MAPS_API_KEY itself, so `npm run
 * place-discovery:test` needs no real key and a missing credential cannot
 * break build or CI.
 */
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

    // ── Failure behaviour (STEP 4): every path below is stubbed, never live ──

    // 1. Network failure must fail closed — a rejected fetch never throws out of
    //    the engine and never yields a partially-trusted result.
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const networkFailure = await searchGooglePlaces("หินคลุก ขอนแก่น");
    assert.equal(networkFailure.ok, false);
    assert.equal(networkFailure.places.length, 0);
    assert.match(networkFailure.error ?? "", /เรียก Google Places ไม่สำเร็จ/);

    // 2. A non-OK HTTP status must fail closed, with the real status surfaced
    //    (a 403 from a missing/invalid key is the realistic production case).
    globalThis.fetch = (async () =>
      new Response("denied", { status: 403 })) as typeof fetch;
    const httpFailure = await searchGooglePlaces("ลูกรัง ขอนแก่น");
    assert.equal(httpFailure.ok, false);
    assert.equal(httpFailure.places.length, 0);
    assert.match(httpFailure.error ?? "", /HTTP 403/);

    // 3. A malformed (non-JSON) body must never throw and never fabricate a
    //    place. Contract as implemented: it degrades to an empty, unverified
    //    list rather than inventing data — asserted as-is, not guessed at.
    globalThis.fetch = (async () =>
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })) as typeof fetch;
    const malformed = await searchGooglePlaces("ดินถม ขอนแก่น");
    assert.equal(malformed.ok, true);
    assert.equal(malformed.places.length, 0);
    assert.equal(malformed.query, "ดินถม ขอนแก่น");

    // 4. A well-formed 200 body with an empty places list is also empty/honest.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    const empty = await searchGooglePlaces("ปูนผสมเสร็จ ขอนแก่น");
    assert.equal(empty.ok, true);
    assert.equal(empty.places.length, 0);

    console.log("place-discovery:test PASS");
    console.log("checks: missing-credential fail-closed (fetch not called), Google request shape, Thai/TH bias, normalization, Place ID dedupe, network-failure fail-closed, HTTP-status fail-closed, malformed-body no-throw/no-fabrication");
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
