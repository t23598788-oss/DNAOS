/**
 * หน้าที่: the circuit view of one machine observation — nodes and DIRECTED
 * edges built only from evidenced relationships (Owner, 2026-08-26).
 *
 * A relationship that could not be proven is not drawn as a fact. It is
 * emitted as an `UNRESOLVED` node so the gap is visible instead of invisible —
 * an absent edge and a disproven edge look identical on a diagram, and only
 * one of them is honest.
 *
 * Input: relationships + correlation candidates + meaning records.
 * Output: nodes/edges, each carrying evidence.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้ามวาด edge ที่ไม่มี evidence.
 */

import type { CorrelationCandidate, MeaningRecord, ObservedRelationship } from "./types";

export function observationCircuitGraph(input: {
  relationships: readonly ObservedRelationship[];
  correlations: readonly CorrelationCandidate[];
  meanings: readonly MeaningRecord[];
}): { nodes: { id: string; kind: string; evidence: readonly string[] }[]; edges: { id: string; from: string; to: string; kind: string; evidence: readonly string[] }[] } {
  const nodes = new Map<string, { id: string; kind: string; evidence: readonly string[] }>();
  const addNode = (id: string, evidence: readonly string[]): void => {
    if (!nodes.has(id)) nodes.set(id, { id, kind: id.split(":")[0], evidence });
  };

  const edges = input.relationships.map((relationship, index) => {
    addNode(relationship.from, relationship.evidence);
    addNode(relationship.to, relationship.evidence);
    return { id: `E${index}_${relationship.kind}`, from: relationship.from, to: relationship.to, kind: relationship.kind, evidence: relationship.evidence };
  });

  // Anything not proven is a visible UNRESOLVED node, never a drawn fact.
  for (const candidate of input.correlations.filter((c) => c.verdict !== "PROVEN")) {
    addNode(`unresolved:${candidate.verdict}:${candidate.pid ?? "no-process"}:${candidate.path}`, [candidate.reason, ...candidate.evidence]);
  }
  for (const meaning of input.meanings.filter((m) => m.meaning_type === "UNKNOWN")) {
    addNode(`unresolved:UNKNOWN:${meaning.source}`, meaning.proof);
  }

  return { nodes: [...nodes.values()], edges };
}
