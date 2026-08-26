/**
 * หน้าที่: the public boundary of `control/capability-creation/` — the only
 * file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: the two creation gates, the pre-write packet builder, the creation
 * contract store, and the hand-off into evidence-triggered continuation.
 * Dependency ที่อนุญาต: ./types.ts, ./gate.ts, ./store.ts.
 */
export { evaluateCreationContract, evaluateCompletionGate, buildPreWritePacket } from "./gate";
export type { CompletionGateInput } from "./gate";
export {
  recordCreationContract,
  readCreationContracts,
  currentCreationContract,
  incompleteCapabilities,
  parkMissingConnections,
  creationContractPath,
} from "./store";
export type { CreationRecord, ParkResult } from "./store";
export { deriveWiringEvents, wiringFactsSatisfied, WIRING_NAMESPACES } from "./events";
export type { WiringProbe } from "./events";
export { recordBlockedWork, runContinuationJoin, blockerKeysFor } from "./production";
export type { BlockedWorkInput, RecordBlockedResult, JoinResult } from "./production";
export {
  UNKNOWN,
  TRIGGER_CLASSES,
  LIFECYCLE_ORDER,
  REQUIRED_CONTRACT_FIELDS,
  REQUIRED_NONEMPTY_LISTS,
  ASSIGNED_AT_REGISTRATION,
} from "./types";
export type {
  CapabilityCreationContract,
  CapabilityLifecycleState,
  TriggerClass,
  CreationGateResult,
  PreWritePacket,
  MissingConnection,
} from "./types";
