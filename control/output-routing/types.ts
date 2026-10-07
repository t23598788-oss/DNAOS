/**
 * หน้าที่: the type contracts for the Output Consumer Registry — who is
 * registered to receive a given Output Contract lane
 * (../../contracts/command/output-contract.ts) for a given capability_id.
 *
 * Input: none (pure type definitions).
 * Output: `ConsumerType`, `ConsumerStatus`, `OutputConsumerRegistration`,
 * `OutputRoutingStatus`, `OutputRoutingResult`.
 * Dependency ที่อนุญาต: ../../contracts/command/output-contract.ts (types only).
 * สิ่งที่ห้ามแตะ: never add a field that lets a registration entry carry
 * an inline destination URL/secret/token — `consumer_id` is a reference
 * (a real path/id in this repo, or a documented external system name),
 * never a live endpoint this registry dials itself.
 */

import type { OutputLane } from "../../contracts/command/output-contract";

export type ConsumerType = "UI_SURFACE" | "METRIC" | "SUBSYSTEM" | "WORKER_CAPABILITY";
export type ConsumerStatus = "REGISTERED" | "DEPRECATED";

export interface OutputConsumerRegistration {
  consumer_id: string;
  consumer_type: ConsumerType;
  output_lane: OutputLane;
  /** Which capability_id's output this consumer wants. "*" = every output on this lane. */
  capability_id: string;
  status: ConsumerStatus;
  /** Where this registration's truth comes from — a real file/docstring in this repo, never invented. */
  evidence_ref: string;
  description: string;
}

export type OutputRoutingStatus = "ROUTED" | "NO_REGISTERED_CONSUMER";

export interface OutputRoutingResult {
  status: OutputRoutingStatus;
  lane: OutputLane;
  capability_id: string;
  consumers: readonly OutputConsumerRegistration[];
}
