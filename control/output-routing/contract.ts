/**
 * หน้าที่: the public boundary of `control/output-routing/` — the only
 * file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 * `./consumer-registry.ts` and `./output-router.ts` stay reachable only
 * through here.
 *
 * Input: re-exports only.
 * Output: `resolveOutputConsumers`, `listOutputConsumers`, plus every
 * type a caller needs.
 * Dependency ที่อนุญาต: ./output-router.ts, ./consumer-registry.ts, ./types.ts.
 */

export { resolveOutputConsumers } from "./output-router";
export { listOutputConsumers, OUTPUT_CONSUMER_REGISTRY } from "./consumer-registry";
export type { ConsumerType, ConsumerStatus, OutputConsumerRegistration, OutputRoutingStatus, OutputRoutingResult } from "./types";
