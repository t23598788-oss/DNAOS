/**
 * หน้าที่: the public boundary of `control/runtime-endpoint-registry/`.
 * Other capability folders import only this file.
 *
 * Input: re-exports.
 * Output: resolveRuntimeEndpoint, registration helpers, types.
 * Dependency ที่อนุญาต: ./resolver.ts, ./registry.ts, ./host-runtime.ts, ./types.ts
 * สิ่งที่ห้ามแตะ: ห้าม re-export Railway GraphQL หรือ credential resolvers.
 */

export type {
  RuntimeEndpointFailReason,
  RuntimeEndpointPurpose,
  RuntimeEndpointRegistration,
  RuntimeEndpointResolution,
  RuntimeEndpointScope,
  RuntimeEndpointSource,
  RuntimeEndpointStatus,
  RuntimeEndpointTransport,
  RuntimeServiceId,
} from "./types";

export { resolveRuntimeEndpoint, joinEndpointAddress } from "./resolver";
export type { ResolveRuntimeEndpointInput } from "./resolver";
export {
  listRuntimeEndpoints,
  registerRuntimeEndpoint,
  removeRuntimeEndpoint,
  replaceRuntimeEndpointsForTests,
  validateRuntimeEndpoint,
} from "./registry";
export type { RegistrationRejection } from "./registry";
export { ensureRuntimeEndpointsLoaded, resetRuntimeEndpointsForTests } from "./host-runtime";
export { LOCAL_CORE_SERVICES, localEndpointsFromServices } from "./local-from-services";
