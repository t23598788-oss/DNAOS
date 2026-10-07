/**
 * หน้าที่: the public boundary of `control/machine-observation/` — the only
 * file another capability folder may import from, per
 * `../../governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Note what is absent and must stay absent: nothing here interrupts, pauses,
 * signals or commands anything. This layer observes and emits; a controller
 * elsewhere decides.
 *
 * Input: re-exports only.
 * Output: process observation, software topology, correlation, meaning, circuit view.
 * Dependency ที่อนุญาต: ./process-observer.ts, ./software-topology.ts,
 * ./correlation.ts, ./meaning.ts, ./circuit-view.ts, ./types.ts,
 * ../service-reload/contract.ts (READ-ONLY re-export only).
 * สิ่งที่ห้ามแตะ: ห้าม export ฟังก์ชันที่สั่งงาน/หยุด process หรือ agent.
 */

export { listProcesses, observeProcesses, findProcessesUnderPath, relationshipsFor, lsofFor, type PsRow } from "./process-observer";
export { topologyFor, candidatePidsForBundle, bundleOf } from "./software-topology";
export { correlate, strongestVerdict } from "./correlation";
export { deriveMeaning } from "./meaning";
export { observationCircuitGraph } from "./circuit-view";
export { runtimeConsumerEvidenceFor, runtimeConsumerSnapshot, candidatePidsForRepo, buildIngestionRecord, type RuntimeConsumerEvidence, type RuntimeConsumerState, type IngestionRecord } from "./lifecycle-bridge";
export { startObservationRuntime, type ObservationRuntimeOptions, type ObservationRuntimeHandle } from "./observer-daemon";
export { appendObservation, readObservations, observationsForResource, observationStoreStatus, rotateIfNeeded, rotatedFiles, OBSERVATION_STORE_FILE, OBSERVATION_RETENTION_POLICY, type ObservationRecord, type ObservationRetentionPolicy, type RotationResult } from "./observation-store";
/**
 * Re-exported so this layer can SAY that a service is running code that has
 * since been replaced on disk — the condition that let a daemon keep deleting
 * observation archives for 15 minutes after the deletion was removed from the
 * source. It reports; it does not act. The executing counterpart
 * (`requestReload`) is deliberately NOT re-exported here, so no import of this
 * contract can reach an execution path.
 */
export { reloadRequiredFor } from "../service-reload/contract";

export type { ProcessObservation, ObservedRelationship, RelationshipKind, CorrelationCandidate, CorrelationVerdict, MeaningRecord, SoftwareTopology } from "./types";
export { onObservation } from "./observation-store";
export type { ObservationListener } from "./observation-store";
export { observationToEvent, startObservationEventBridge, OBSERVATION_EVENT_SOURCE } from "./event-ingress-bridge";
export type { ObservationBridgeHandle } from "./event-ingress-bridge";
export { declareRuntimeTarget, listRuntimeTargets, loadRuntimeTarget, targetsForCapability } from "./runtime-target";
export type { RuntimeObservationTarget, DeclareRuntimeTargetInput, DeclareOutcome, ObservationAuthority, RuntimeTargetProcess, RuntimeTargetNetwork, RuntimeTargetHealth } from "./runtime-target";
export { observeRuntimeTarget, listeningPidsOnPort, probeHttpHealth } from "./target-observer";
export type { RuntimeObservationResult, HttpHealthObservation } from "./target-observer";
export { persistRuntimeObservation } from "./target-observer";
export type { ObservationCorrelation, PersistObservationOutcome, PersistDeps } from "./target-observer";
export { observationStoreFile } from "./observation-store";
