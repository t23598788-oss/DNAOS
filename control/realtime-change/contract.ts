/**
 * หน้าที่: the public boundary of `control/realtime-change/` — the only file
 * another capability folder may import from, per
 * `../../governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: the observer, path resolution, impact resolution, the two delivery
 * channels, and the circuit graph.
 * Dependency ที่อนุญาต: ./observer.ts, ./path-resolution.ts, ./impact.ts,
 * ./interrupt.ts, ./circuit-view.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้าม export อะไรที่อนุญาต write/execution ให้ผู้รับ interrupt.
 */

export { startObserving, stopObserving, observationStatus, currentWatchScopes } from "./observer";
export { resolvePath, resolveCapabilityForPath, resolveResourceForPath, toRepoRelative, type PathResolution } from "./path-resolution";
export { buildImpactContext, findRelatedWork, buildInterrupt, type RelatedWork } from "./impact";
export { deliverInterrupt, deliverContext, readAck, readInterrupt, writeAck, INBOX_DIR, INTERRUPT_FILE, CONTEXT_FILE, ACK_FILE } from "./interrupt";
export { changeFlowCircuitGraph } from "./circuit-view";
export type { ChangeEvent, ChangeImpactContext, InterruptSignal, AgentAck, ObservationStatus, WatchScope } from "./types";
