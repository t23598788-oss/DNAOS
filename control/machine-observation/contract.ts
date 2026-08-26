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
 * ./correlation.ts, ./meaning.ts, ./circuit-view.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้าม export ฟังก์ชันที่สั่งงาน/หยุด process หรือ agent.
 */

export { listProcesses, observeProcesses, findProcessesUnderPath, relationshipsFor, lsofFor, type PsRow } from "./process-observer";
export { topologyFor, candidatePidsForBundle, bundleOf } from "./software-topology";
export { correlate, strongestVerdict } from "./correlation";
export { deriveMeaning } from "./meaning";
export { observationCircuitGraph } from "./circuit-view";
export { runtimeConsumerEvidenceFor, buildIngestionRecord, type RuntimeConsumerEvidence, type RuntimeConsumerState, type IngestionRecord } from "./lifecycle-bridge";
export type { ProcessObservation, ObservedRelationship, RelationshipKind, CorrelationCandidate, CorrelationVerdict, MeaningRecord, SoftwareTopology } from "./types";
