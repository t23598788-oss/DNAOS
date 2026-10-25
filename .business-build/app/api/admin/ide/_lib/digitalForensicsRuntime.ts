/**
 * Digital Forensics Runtime (owner, 2026-08-08, Software Factory Step
 * 13.25, Section 9). Read-only chain classification over the real,
 * already-existing artifactRuntime.ts#computeLineage() — never a second
 * lineage store. Classifies real lineage nodes into the real Chain
 * categories the mission requires, purely as a read-only view.
 */
import { computeLineage, getArtifact } from "./artifactRuntime";

export type ForensicChainType = "REQUEST_CHAIN" | "RUNTIME_CHAIN" | "API_CHAIN" | "EXECUTION_CHAIN" | "FILE_CHAIN" | "NETWORK_CHAIN" | "EVENT_CHAIN" | "CORRELATION";

const TYPE_TO_CHAIN: Record<string, ForensicChainType> = {
  EXECUTION_RESULT: "EXECUTION_CHAIN", CHANGE_SET_MANIFEST: "FILE_CHAIN", SOURCE_DIFF: "FILE_CHAIN",
  WORKSPACE_SESSION: "REQUEST_CHAIN", INTENT_RECORD: "REQUEST_CHAIN", AI_CONTEXT_PACKAGE: "API_CHAIN",
  CODE_WORKER_PROPOSAL: "API_CHAIN", NATIVE_FACTORY_RUN: "RUNTIME_CHAIN", OUTCOME_REPORT: "RUNTIME_CHAIN",
  SECURITY_EXECUTION_GATE_RECORD: "EVENT_CHAIN",
};

export interface ForensicTimelineEntry {
  artifactId: string;
  artifactType: string;
  chainType: ForensicChainType;
  displayName: string;
  status: string;
}

export interface ForensicTimeline {
  rootArtifactId: string;
  ancestors: ForensicTimelineEntry[];
  descendants: ForensicTimelineEntry[];
  correlation: { totalNodes: number; chainTypesPresent: ForensicChainType[] };
}

function classify(artifactType: string): ForensicChainType {
  return TYPE_TO_CHAIN[artifactType] ?? "CORRELATION";
}

/** Real, read-only forensic timeline — reuses computeLineage()'s real
 * ancestor/descendant walk exactly as-is, only adding a real
 * chain-type classification label. Never mutates, never a second store. */
export function buildForensicTimeline(artifactId: string, ownerId: string): ForensicTimeline {
  getArtifact(artifactId, ownerId);
  const lineage = computeLineage(artifactId, ownerId);
  const toEntry = (n: { artifactId: string; artifactType: string; displayName: string; status: string }): ForensicTimelineEntry => ({
    artifactId: n.artifactId, artifactType: n.artifactType, chainType: classify(n.artifactType), displayName: n.displayName, status: n.status,
  });
  const ancestors = lineage.ancestors.map(toEntry);
  const descendants = lineage.descendants.map(toEntry);
  const chainTypesPresent = [...new Set([...ancestors, ...descendants].map((e) => e.chainType))];
  return { rootArtifactId: artifactId, ancestors, descendants, correlation: { totalNodes: ancestors.length + descendants.length, chainTypesPresent } };
}
