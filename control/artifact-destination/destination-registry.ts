/**
 * หน้าที่: the ONE real mapping this whole capability reads from — never
 * hardcoded inside ./resolver.ts's logic. Two layers, both data, not
 * decision code:
 *
 * 1. resource_type -> DestinationClass — a fixed classification table
 *    (same discipline as control/event-pipeline/domain-classification.ts's
 *    SOFTWARE_RESOURCE_TYPE_DOMAIN).
 * 2. DestinationClass -> backing capability — resolved through this
 *    repo's REAL, already-registered capabilities only. SOURCE_AUTHORITY
 *    is backed by the real `github` entry in
 *    control/command-router/capability-registry.ts (re-checked live via
 *    getCapability() every call, never assumed CONNECTED). The
 *    registry-internal classes (CAPABILITY_GRAPH, EVIDENCE_STORE,
 *    SYSTEM_REGISTRY) are backed by software/registry-database/ itself —
 *    the same store an artifact was just written into, not a new
 *    capability. UI_REGISTRY, VERSION_STORE, and DEPLOYMENT_CANDIDATE
 *    deliberately have NO backing entry — no real capability implements
 *    them in this repo today, and none is invented here to fill the gap.
 *
 * GitHub/Vercel/Supabase are never named as a destination directly in
 * ./resolver.ts's code — "github" only ever appears here, as one
 * mapping entry among others, resolved the same way every other entry is.
 *
 * Input: none (module-level constants).
 * Output: `RESOURCE_TYPE_DESTINATION_CLASS`, `DESTINATION_CLASS_BACKING`.
 * Dependency ที่อนุญาต: ./types.ts, ../command-router/contract.ts (getCapability only).
 * สิ่งที่ห้ามแตะ: never add a DESTINATION_CLASS_BACKING entry whose
 * checkAvailable() cannot be traced to a real, already-registered
 * capability or store. Never widen RESOURCE_TYPE_DESTINATION_CLASS to
 * cover a business resource_type — this table only ever receives
 * resource_type values that already passed Domain Classification.
 */

import { getCapability } from "../command-router/contract";
import type { DestinationClass } from "./types";

export const RESOURCE_TYPE_DESTINATION_CLASS: Readonly<Record<string, DestinationClass>> = {
  SOURCE_REFERENCE: "SOURCE_AUTHORITY",
  TEST_RESULT: "EVIDENCE_STORE",
  CAPABILITY: "CAPABILITY_GRAPH",
  MODULE: "CAPABILITY_GRAPH",
  API: "CAPABILITY_GRAPH",
  ADAPTER: "CAPABILITY_GRAPH",
  UI_SURFACE: "UI_REGISTRY",
  AI_INGRESS: "SYSTEM_REGISTRY",
  SYSTEM_SERVICE: "SYSTEM_REGISTRY",
  EXECUTION_EVIDENCE: "EVIDENCE_STORE",
  REGISTRATION_EVIDENCE: "EVIDENCE_STORE",
};

export interface DestinationClassBacking {
  destination_capability_id: string;
  evidence_ref: string;
  checkAvailable(): boolean;
}

export const DESTINATION_CLASS_BACKING: Readonly<Partial<Record<DestinationClass, DestinationClassBacking>>> = {
  SOURCE_AUTHORITY: {
    destination_capability_id: "github",
    evidence_ref: "control/command-router/capability-registry.ts#github",
    checkAvailable: () => getCapability("github")?.health_status === "CONNECTED",
  },
  CAPABILITY_GRAPH: {
    destination_capability_id: "software-registry",
    evidence_ref: "software/registry-database/ (capabilities/relationships tables) — the same store the artifact was just registered into",
    checkAvailable: () => true,
  },
  EVIDENCE_STORE: {
    destination_capability_id: "software-registry",
    evidence_ref: "software/registry-database/ (evidence/registration_events tables)",
    checkAvailable: () => true,
  },
  SYSTEM_REGISTRY: {
    destination_capability_id: "software-registry",
    evidence_ref: "software/registry-database/ (resources/capabilities tables — AI_INGRESS/SYSTEM_SERVICE rows and their relationships)",
    checkAvailable: () => true,
  },
  // UI_REGISTRY, VERSION_STORE, DEPLOYMENT_CANDIDATE: no entry — no real
  // capability backs these today. resolver.ts reports NOT_AVAILABLE for
  // any resource_type that maps to one of these classes.
};
