/**
 * หน้าที่: the Output Routing resolver — the ONLY place that decides
 * where a `DnaOsOutput` (../../contracts/command/output-contract.ts) goes.
 * It never hardcodes a destination for a given capability_id; it only
 * reads ./consumer-registry.ts and reports whichever REGISTERED
 * consumer(s) actually claimed that lane+capability_id, or
 * NO_REGISTERED_CONSUMER if none did. Adding/removing a route means
 * editing the registry, never this function.
 *
 * Input: a `DnaOsOutput`.
 * Output: `OutputRoutingResult`.
 * Dependency ที่อนุญาต: ./consumer-registry.ts, ./types.ts,
 * ../../contracts/command/output-contract.ts (types only).
 * สิ่งที่ห้ามแตะ: never return a consumer whose `status` is not
 * "REGISTERED". Never fall back to a default/guessed consumer when none
 * matches — NO_REGISTERED_CONSUMER is the correct, honest answer.
 */

import type { DnaOsOutput } from "../../contracts/command/output-contract";
import { OUTPUT_CONSUMER_REGISTRY } from "./consumer-registry";
import type { OutputRoutingResult } from "./types";

export function resolveOutputConsumers(output: DnaOsOutput): OutputRoutingResult {
  const consumers = OUTPUT_CONSUMER_REGISTRY.filter(
    (consumer) =>
      consumer.status === "REGISTERED" &&
      consumer.output_lane === output.lane &&
      (consumer.capability_id === "*" || consumer.capability_id === output.capability_id),
  );
  return {
    status: consumers.length > 0 ? "ROUTED" : "NO_REGISTERED_CONSUMER",
    lane: output.lane,
    capability_id: output.capability_id,
    consumers,
  };
}
