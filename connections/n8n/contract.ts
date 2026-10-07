/**
 * หน้าที่: the public boundary of `connections/n8n/` — the only file another
 * capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `routeDnaOsEvent` (the one entry point), the central event and
 * decision types, `ROUTE_GROUPS`, `MAX_HOPS`, and the original proven
 * `sendDnaOsEventToN8n` for the first caller that already uses it.
 * Dependency ที่อนุญาต: ./event-router.ts, ./outbound-webhook.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export `__resetLoopState` — it exists for this
 * folder's own tests, and a caller able to clear the loop guard could defeat
 * it from outside. Never export a function that takes a caller-supplied URL.
 */

export { routeDnaOsEvent, resolveOwner, localLoopCheck, MAX_HOPS } from "./event-router";
export type { RouteOptions } from "./event-router";
export { sendDnaOsEventToN8n, sendCentralEventToN8n } from "./outbound-webhook";
export { ROUTE_GROUPS } from "./types";
export type {
  DnaOsCentralEvent, RouterDecision, RouteGroup, RouteStatus, EventSeverity,
  OwnerResolution, AgentDispatchOrder, AgentDispatchResult, HopRecord,
  ErrorTriggerContext, RoutedEventOutcome,
} from "./types";
