/**
 * Compose SemanticNodes/Edges from existing authorities + explicit descriptors.
 * Derived only. Deterministic. No AI. No second central registry.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertSemanticId, canonicalizeSemanticId, kindOf } from "./id";
import { semanticKey } from "./key";
import { PILOT_DESCRIPTORS, INFRA_REPO_ID } from "./pilot-descriptors";
import type {
  SemanticDescriptor,
  SemanticEdge,
  SemanticGraph,
  SemanticId,
  SemanticLifecycleState,
  SemanticNode,
  SemanticRelation,
  SemanticSourceRef,
} from "./types";

export interface DiscoverOptions {
  readonly root?: string;
  readonly commitSha?: string | null;
  /** Extra descriptors for tests (e.g. missing relation targets). */
  readonly extraDescriptors?: readonly SemanticDescriptor[];
  /** When true, skip filesystem existence checks (unit tests with fixtures). */
  readonly skipPathCheck?: boolean;
}

const RELATION_FIELDS: readonly {
  key: keyof SemanticDescriptor;
  relation: SemanticRelation;
}[] = [
  { key: "implements", relation: "IMPLEMENTS" },
  { key: "dependsOn", relation: "DEPENDS_ON" },
  { key: "requires", relation: "REQUIRES" },
  { key: "authorizedBy", relation: "AUTHORIZED_BY" },
  { key: "executedBy", relation: "EXECUTED_BY" },
  { key: "usesConnection", relation: "USES_CONNECTION" },
  { key: "usesCredential", relation: "USES_CREDENTIAL" },
  { key: "reachableAt", relation: "REACHABLE_AT" },
  { key: "verifiedBy", relation: "VERIFIED_BY" },
  { key: "provenBy", relation: "PROVEN_BY" },
  { key: "supersedes", relation: "SUPERSEDES" },
];

function gitSha(root: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function sourceFor(
  d: SemanticDescriptor,
  commitSha: string | null,
  fallbackPath: string,
): SemanticSourceRef {
  const impl = d.implementation;
  return {
    repositoryId: impl?.repositoryId ?? d.ownerRepository ?? INFRA_REPO_ID,
    commitSha,
    path: impl?.path ?? fallbackPath,
    symbol: impl?.symbol,
  };
}

function baseState(d: SemanticDescriptor, pathOk: boolean): SemanticLifecycleState {
  if (!pathOk && d.implementation) return "IDENTIFIED";
  if (d.declaredCanonical) return "CANONICAL";
  return "IDENTIFIED";
}

function edgesFromDescriptor(
  d: SemanticDescriptor,
  source: SemanticSourceRef,
): SemanticEdge[] {
  const out: SemanticEdge[] = [];
  const from = assertSemanticId(d.id);
  if (d.ownerRepository) {
    out.push({
      from: assertSemanticId(d.ownerRepository),
      relation: "OWNS",
      to: from,
      source,
    });
  }
  for (const { key, relation } of RELATION_FIELDS) {
    const targets = d[key];
    if (!Array.isArray(targets)) continue;
    for (const toRaw of targets) {
      const to = canonicalizeSemanticId(String(toRaw));
      if (!to) continue;
      out.push({ from, relation, to, source });
    }
  }
  return out;
}

/**
 * Discovery order (compose, do not replace authorities):
 * 1) explicit semantic descriptors (pilot + extra)
 * 2) optional live endpoint IDs already shaped as SemanticId (registry)
 * Repository/capability registries remain authoritative elsewhere —
 * this scanner only projects known SemanticIds into a derived graph.
 */
export function discoverSemanticGraph(options: DiscoverOptions = {}): SemanticGraph {
  const root = options.root ?? process.cwd();
  const commitSha = options.commitSha !== undefined ? options.commitSha : gitSha(root);
  const descriptors = [...PILOT_DESCRIPTORS, ...(options.extraDescriptors ?? [])];

  const nodeMap = new Map<SemanticId, SemanticNode>();
  const edges: SemanticEdge[] = [];
  const duplicateIds: SemanticId[] = [];

  for (const d of descriptors) {
    const id = assertSemanticId(d.id);
    const kind = kindOf(id);
    if (!kind || kind !== d.kind) {
      throw new Error(`KIND_MISMATCH:${id}`);
    }
    if (nodeMap.has(id)) {
      duplicateIds.push(id);
      continue;
    }
    const source = sourceFor(d, commitSha, "control/semantic-identity/pilot-descriptors.ts");
    const pathOk =
      options.skipPathCheck ||
      !d.implementation ||
      existsSync(join(root, d.implementation.path));
    let state = baseState(d, pathOk);

    nodeMap.set(id, {
      id,
      kind,
      semantic_key: semanticKey(id),
      title: d.title ?? null,
      ownerRepository: d.ownerRepository ? assertSemanticId(d.ownerRepository) : null,
      implementation: d.implementation
        ? {
            repositoryId: assertSemanticId(d.implementation.repositoryId),
            path: d.implementation.path,
            symbol: d.implementation.symbol,
          }
        : null,
      declaredCanonical: Boolean(d.declaredCanonical),
      state,
      source,
    });
    edges.push(...edgesFromDescriptor(d, source));
  }

  // Placeholder nodes for relation targets not yet discovered → AWAITING_RELATION later
  for (const e of edges) {
    if (!nodeMap.has(e.to)) {
      const kind = kindOf(e.to);
      if (!kind) continue;
      nodeMap.set(e.to, {
        id: e.to,
        kind,
        semantic_key: semanticKey(e.to),
        title: null,
        ownerRepository: null,
        implementation: null,
        declaredCanonical: false,
        state: "AWAITING_RELATION",
        source: e.source,
      });
    }
  }

  // Enrich lifecycle: LINKED if has edges; RESOLVED if all targets exist and not awaiting;
  // VERIFIED if has VERIFIED_BY edge to an existing test node; PROVEN only via observation API.
  const edgeList = [...edges].sort(compareEdge);
  for (const node of nodeMap.values()) {
    if (node.state === "AWAITING_RELATION") continue;
    const outgoing = edgeList.filter((e) => e.from === node.id);
    const incoming = edgeList.filter((e) => e.to === node.id);
    let state: SemanticLifecycleState = node.state;
    if (outgoing.length + incoming.length > 0) {
      if (state === "IDENTIFIED" || state === "DISCOVERED" || state === "CLASSIFIED") {
        state = "LINKED";
      }
    }
    const awaiting = outgoing.some((e) => nodeMap.get(e.to)?.state === "AWAITING_RELATION");
    if (awaiting) {
      state = "AWAITING_RELATION";
    } else if (outgoing.length > 0 || node.implementation) {
      if (state === "LINKED" || state === "IDENTIFIED") state = "RESOLVED";
    }
    const verified = outgoing.some(
      (e) => e.relation === "VERIFIED_BY" && nodeMap.has(e.to) && nodeMap.get(e.to)!.state !== "AWAITING_RELATION",
    );
    if (verified && (state === "RESOLVED" || state === "LINKED" || state === "CANONICAL")) {
      // CANONICAL stays distinct: keep CANONICAL if declared; still record verified via doctor counts
      if (state !== "CANONICAL") state = "VERIFIED";
    }
    // Never promote static discovery to PROVEN here.
    nodeMap.set(node.id, { ...node, state });
  }

  if (duplicateIds.length > 0) {
    // Surface as invariant via doctor; mark nodes ERROR-equivalent state remains CANONICAL/IDENTIFIED
    // Doctor counts duplicates separately.
  }

  const nodes = [...nodeMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    nodes,
    edges: edgeList,
    source_revision: commitSha,
    derived: true,
    authoritative: false,
  };
}

function compareEdge(a: SemanticEdge, b: SemanticEdge): number {
  return (
    a.from.localeCompare(b.from) ||
    a.relation.localeCompare(b.relation) ||
    a.to.localeCompare(b.to) ||
    a.source.path.localeCompare(b.source.path)
  );
}

export function graphFingerprint(graph: SemanticGraph): string {
  const payload = JSON.stringify({
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      key: n.semantic_key,
      state: n.state,
      path: n.implementation?.path ?? null,
      symbol: n.implementation?.symbol ?? null,
    })),
    edges: graph.edges.map((e) => ({
      from: e.from,
      relation: e.relation,
      to: e.to,
      path: e.source.path,
    })),
  });
  return payload;
}
