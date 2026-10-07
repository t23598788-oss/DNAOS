/**
 * หน้าที่: the ONLY module outside this folder is allowed to import from —
 * the public contract of `control/command-router/`. `router.ts` (routing
 * logic), `capability-registry.ts` (registry data), and `host-runtime.ts`
 * (ambient id/time) are private implementation. Mirrors this repo's
 * existing pattern (see `../../execution/run/contract.ts`,
 * `../../permissions/execution-policy/contract.ts`,
 * `../../connections/github/adapter-contract.ts`).
 *
 * `../owner-command/` must depend on this file only, never reach past it
 * into `./router.ts` or `./capability-registry.ts` directly.
 *
 * Input: re-exports only.
 * Output: `routeOwnerCommand`, `classifyCommand`, `listCapabilities`,
 * `listCapabilitySummaries`, `getCapability`, `classifyOutput` (the SYSTEM_STATE/WORK_ITEM Output
 * Contract lane for a `CapabilityResult`), plus every type a caller needs
 * to build a request or read a decision/registration.
 * Dependency ที่อนุญาต: ./router.ts, ./capability-registry.ts, ./types.ts,
 * ./output-classifier.ts.
 * สิ่งที่ห้ามแตะ: never re-export ./host-runtime.ts here — it stays
 * private so id/time generation can change without breaking callers.
 *
 * NOT_YET_BUILT: no runtime caller yet — see ./tests/router.test.ts.
 */

export { classifyCommand, routeOwnerCommand } from "./router";
export type { RouteOptions } from "./router";
export { CAPABILITY_REGISTRY, getCapability, listCapabilities, listCapabilitySummaries } from "./capability-registry";
export type { CapabilityHealthStatus, CapabilityRegistration, CapabilitySummary, ClassificationOutcome, EndpointReference, PermissionRequirement, RouterStep } from "./types";
export { classifyOutput } from "./output-classifier";
