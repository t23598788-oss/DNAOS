import { calculatePlannedEta, estimateCurrentEta } from "../engines/eta-calculator";

// Defaults from app_configs
const LOADING_MIN_DEFAULT = 30;
const AVG_SPEED_KMH_DEFAULT = 45;

function testPlannedEta() {
  console.log("=== TEST: calculatePlannedEta ===");
  const input = {
    distance_km: 100,
    dispatch_at: "2026-11-03T08:00:00Z",
    loading_min: LOADING_MIN_DEFAULT,
    avg_speed_kmh: AVG_SPEED_KMH_DEFAULT,
  };
  const result = calculatePlannedEta(input);
  console.log("Input:", JSON.stringify(input));
  console.log("Result:", JSON.stringify(result, null, 2));

  // Verify: transit = round(100/45*60) = round(133.33) = 133
  const expectedTransit = Math.round((100 / 45) * 60);
  console.log("Expected transit_min:", expectedTransit, "Got:", result.transit_min);

  // Verify: arrival = 08:00 + (30 + 133) min = 10:03
  const expectedArrival = new Date(Date.parse("2026-11-03T08:00:00Z") + (30 + 133) * 60000).toISOString();
  console.log("Expected arrival:", expectedArrival, "Got:", result.planned_arrival_at);

  // Invalid cases
  try {
    calculatePlannedEta({ ...input, distance_km: 0 });
    console.log("FAIL: distance 0 should throw");
  } catch (e: any) {
    console.log("OK: distance 0 throws:", e.message);
  }

  try {
    calculatePlannedEta({ ...input, avg_speed_kmh: 0 });
    console.log("FAIL: speed 0 should throw");
  } catch (e: any) {
    console.log("OK: speed 0 throws:", e.message);
  }

  console.log("\n=== END TEST: calculatePlannedEta ===");
}

function testCurrentEta() {
  console.log("=== TEST: estimateCurrentEta ===");
  const now = "2026-11-03T08:30:00Z";
  const eta = calculatePlannedEta({
    distance_km: 100,
    dispatch_at: "2026-11-03T08:00:00Z",
    loading_min: LOADING_MIN_DEFAULT,
    avg_speed_kmh: AVG_SPEED_KMH_DEFAULT,
  });

  // scheduled — still in future
  const r1 = estimateCurrentEta({
    status: "scheduled",
    dispatch_at: eta.dispatch_at,
    planned_loading_min: eta.loading_min,
    planned_transit_min: eta.transit_min,
    planned_arrival_at: eta.planned_arrival_at,
    now: now,
  });
  console.log("scheduled @ 08:30 (arrival 10:03):", JSON.stringify(r1));
  console.log("  -> is_late:", r1.is_late, "remaining:", r1.remaining_min, "(should be 93)");

  // same time — should show late (arrival is in the past)
  const r2 = estimateCurrentEta({
    status: "scheduled",
    dispatch_at: eta.dispatch_at,
    planned_loading_min: eta.loading_min,
    planned_transit_min: eta.transit_min,
    planned_arrival_at: eta.planned_arrival_at,
    now: eta.planned_arrival_at,
  });
  console.log("scheduled @ arrival time:", JSON.stringify(r2));
  console.log("  -> is_late:", r2.is_late, "late_by_min:", r2.late_by_min);

  // delivered
  const r3 = estimateCurrentEta({
    status: "delivered",
    dispatch_at: eta.dispatch_at,
    planned_loading_min: eta.loading_min,
    planned_transit_min: eta.transit_min,
    planned_arrival_at: eta.planned_arrival_at,
    now: now,
  });
  console.log("delivered:", JSON.stringify(r3));

  // failed
  const r4 = estimateCurrentEta({
    status: "failed",
    dispatch_at: eta.dispatch_at,
    planned_loading_min: eta.loading_min,
    planned_transit_min: eta.transit_min,
    planned_arrival_at: eta.planned_arrival_at,
    now: now,
  });
  console.log("failed:", JSON.stringify(r4));

  // in_transit — arrived early
  const r5 = estimateCurrentEta({
    status: "in_transit",
    dispatch_at: eta.dispatch_at,
    planned_loading_min: eta.loading_min,
    planned_transit_min: eta.transit_min,
    planned_arrival_at: eta.planned_arrival_at,
    now: eta.planned_arrival_at,
  });
  console.log("in_transit @ arrival time:", JSON.stringify(r5));
  console.log("  -> is_late:", r5.is_late, "remaining:", r5.remaining_min);

  console.log("\n=== END TEST: estimateCurrentEta ===");
}

testPlannedEta();
testCurrentEta();
