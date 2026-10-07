/**
 * Compose SemanticNodes/Edges from existing authorities + explicit descriptors.
 * Derived only. Deterministic. No AI. No second central registry.
 *
 * Returns BOTH a usable derived graph AND discovery diagnostics.
 * Invalid declarations must never silently disappear.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalizeSemanticId, kindOf } from "./id";
import { semanticKey } from "./key";
import { PILOT_DESCRIPTORS, INFRA_REPO_ID, PILOT_DESCRIPTOR_SOURCE } from "./pilot-descriptors";
import type {
  SemanticDescriptor,
  SemanticDiagnostic,
  SemanticDiscoveryDiagnostics,
  SemanticDiscoveryResult,
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

function gitDirty(root: string): boolean {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function symbolPresent(root: string, path: string, symbol: string | undefined): boolean {
  if (!symbol) return true;
  try {
    const text = readFileSync(join(root, path), "utf8");
    return text.includes(symbol);
  } catch {
    return false;
  }
}

function emptyDiagnostics(): SemanticDiscoveryDiagnostics {
  return {
    duplicate_ids: [],
    invalid_ids: [],
    missing_sources: [],
    missing_targets: [],
    unresolved_references: [],
    invalid_implementations: [],
  };
}

function sourceFor(
  d: SemanticDescriptor,
  commitSha: string | null,
  fallbackPath: string,
  ownerRepository: SemanticId | null,
): SemanticSourceRef {
  const impl = d.implementation;
  return {
    repositoryId: impl?.repositoryId
      ? (canonicalizeSemanticId(impl.repositoryId) ?? INFRA_REPO_ID)
      : ownerRepository ?? INFRA_REPO_ID,
    commitSha,
    path: impl?.path ?? fallbackPath,
    symbol: impl?.symbol,
  };
}

function descriptorEdgeSource(
  d: SemanticDescriptor,
  commitSha: string | null,
  ownerRepository: SemanticId | null,
): SemanticSourceRef {
  return {
    repositoryId: ownerRepository ?? INFRA_REPO_ID,
    commitSha,
    path: PILOT_DESCRIPTOR_SOURCE.path,
    symbol: PILOT_DESCRIPTOR_SOURCE.symbol,
  };
}

function baseState(d: SemanticDescriptor, pathOk: boolean): SemanticLifecycleState {
  // Declared implementation that failed validation stays IDENTIFIED — not RESOLVED.
  if (!pathOk && d.implementation) return "IDENTIFIED";
  if (d.declaredCanonical) return "CANONICAL";
  return "IDENTIFIED";
}

function placeholderNode(id: SemanticId, source: SemanticSourceRef): SemanticNode | null {
  const kind = kindOf(id);
  if (!kind) return null;
  return {
    id,
    kind,
    semantic_key: semanticKey(id),
    title: null,
    ownerRepository: null,
    implementation: null,
    declaredCanonical: false,
    synthetic: true,
    state: "AWAITING_RELATION",
    source,
  };
}

function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/**
 * Full discovery: usable derived graph + deterministic diagnostics.
 */
export function discoverSemantic(options: DiscoverOptions = {}): SemanticDiscoveryResult {
  const root = options.root ?? process.cwd();
  const headSha = options.commitSha !== undefined ? options.commitSha : gitSha(root);
  const dirty = options.commitSha !== undefined ? false : gitDirty(root);
  const commitSha = dirty && headSha ? `${headSha}+dirty` : headSha;
  if (dirty && options.commitSha === undefined) {
    // Dirty trees are labeled; graph is not claimed reproducible from clean HEAD alone.
  }
  const descriptors = [...PILOT_DESCRIPTORS, ...(options.extraDescriptors ?? [])];

  const nodeMap = new Map<SemanticId, SemanticNode>();
  const declaredNodes = new Set<SemanticId>();
  const placeholderIds = new Set<SemanticId>();
  const edges: SemanticEdge[] = [];
  const duplicateIds: SemanticId[] = [];
  const invalidIds: SemanticDiagnostic[] = [];
  const invalidImplementations: SemanticDiagnostic[] = [];
  const implementationResolved = new Set<SemanticId>();
  const implementationBroken = new Set<SemanticId>();

  for (const d of descriptors) {
    const id = canonicalizeSemanticId(String(d.id));
    if (!id) {
      invalidIds.push({
        code: "INVALID_SEMANTIC_ID",
        message: "descriptor id failed canonicalization",
        raw: String(d.id),
        field: "id",
        descriptor_id: String(d.id),
      });
      continue;
    }
    const kind = kindOf(id);
    if (!kind || kind !== d.kind) {
      invalidIds.push({
        code: "INVALID_SEMANTIC_ID",
        message: `KIND_MISMATCH:${id}`,
        raw: String(d.id),
        field: "kind",
        descriptor_id: id,
      });
      continue;
    }

    let ownerRepository: SemanticId | null = null;
    if (d.ownerRepository) {
      const owner = canonicalizeSemanticId(String(d.ownerRepository));
      if (!owner) {
        invalidIds.push({
          code: "INVALID_SEMANTIC_ID",
          message: "ownerRepository failed canonicalization",
          raw: String(d.ownerRepository),
          field: "ownerRepository",
          descriptor_id: id,
        });
      } else {
        ownerRepository = owner;
      }
    }

    const source = sourceFor(d, commitSha, "control/semantic-identity/pilot-descriptors.ts", ownerRepository);
    const edgeSource = descriptorEdgeSource(d, commitSha, ownerRepository);

    // Duplicate declaration: keep first node, but retain alternate OWNS for authority conflict diagnosis.
    if (nodeMap.has(id) && declaredNodes.has(id)) {
      duplicateIds.push(id);
      if (ownerRepository) {
        edges.push({
          from: ownerRepository,
          relation: "OWNS",
          to: id,
          source: edgeSource,
        });
      }
      continue;
    }

    let implRef = null as SemanticNode["implementation"];
    if (d.implementation) {
      const repoId = canonicalizeSemanticId(String(d.implementation.repositoryId));
      if (!repoId) {
        invalidIds.push({
          code: "INVALID_SEMANTIC_ID",
          message: "implementation.repositoryId failed canonicalization",
          raw: String(d.implementation.repositoryId),
          field: "implementation.repositoryId",
          descriptor_id: id,
        });
        implementationBroken.add(id);
        invalidImplementations.push({
          code: "MISSING_IMPLEMENTATION",
          message: "implementation declared but repositoryId is invalid",
          descriptor_id: id,
          raw: String(d.implementation.repositoryId),
          field: "implementation.repositoryId",
        });
      } else {
        implRef = {
          repositoryId: repoId,
          path: d.implementation.path,
          symbol: d.implementation.symbol,
        };
      }
    }

    const pathOk =
      options.skipPathCheck ||
      !implRef ||
      existsSync(join(root, implRef.path));
    const symbolOk =
      options.skipPathCheck ||
      !implRef ||
      !implRef.symbol ||
      symbolPresent(root, implRef.path, implRef.symbol);
    if (implRef && pathOk && symbolOk) {
      implementationResolved.add(id);
    }
    if (implRef && pathOk && !symbolOk) {
      implementationBroken.add(id);
      invalidImplementations.push({
        code: "MISSING_IMPLEMENTATION",
        message: "implementation path exists but declared symbol was not found",
        descriptor_id: id,
        path: implRef.path,
        field: "implementation.symbol",
        raw: implRef.symbol,
      });
    }
    if (implRef && !pathOk) {
      implementationBroken.add(id);
      invalidImplementations.push({
        code: "MISSING_IMPLEMENTATION",
        message: "implementation declared but path does not exist",
        descriptor_id: id,
        path: implRef.path,
        field: "implementation.path",
      });
    }

    const state = baseState(
      { ...d, implementation: implRef ?? undefined },
      pathOk && symbolOk && !implementationBroken.has(id),
    );

    nodeMap.set(id, {
      id,
      kind,
      semantic_key: semanticKey(id),
      title: d.title ?? null,
      ownerRepository,
      implementation: implRef,
      declaredCanonical: Boolean(d.declaredCanonical),
      synthetic: false,
      state,
      source,
    });
    declaredNodes.add(id);

    if (ownerRepository) {
      edges.push({
        from: ownerRepository,
        relation: "OWNS",
        to: id,
        source: edgeSource,
      });
    }

    for (const { key, relation } of RELATION_FIELDS) {
      const targets = d[key];
      if (!Array.isArray(targets)) continue;
      for (const toRaw of targets) {
        const to = canonicalizeSemanticId(String(toRaw));
        if (!to) {
          invalidIds.push({
            code: "INVALID_SEMANTIC_ID",
            message: `relation target failed canonicalization (${String(key)})`,
            raw: String(toRaw),
            field: String(key),
            relation,
            descriptor_id: id,
          });
          continue;
        }
        edges.push({ from: id, relation, to, source: edgeSource });
      }
    }
  }

  // Classify missing endpoints against descriptor-backed nodes (not placeholder-mutated map).
  const missingSources: SemanticId[] = [];
  const missingTargets: SemanticId[] = [];
  for (const e of edges) {
    if (!declaredNodes.has(e.from)) {
      missingSources.push(e.from);
      if (!nodeMap.has(e.from)) {
        const ph = placeholderNode(e.from, e.source);
        if (ph) {
          nodeMap.set(e.from, ph);
          placeholderIds.add(e.from);
        } else {
          invalidIds.push({
            code: "MISSING_EDGE_SOURCE",
            message: "edge source is not a valid SemanticId and has no node",
            raw: e.from,
            edge_from: e.from,
            edge_to: e.to,
            relation: e.relation,
          });
        }
      }
    }
    if (!declaredNodes.has(e.to)) {
      missingTargets.push(e.to);
      if (!nodeMap.has(e.to)) {
        const ph = placeholderNode(e.to, e.source);
        if (ph) {
          nodeMap.set(e.to, ph);
          placeholderIds.add(e.to);
        } else {
          invalidIds.push({
            code: "MISSING_EDGE_TARGET",
            message: "edge target is not a valid SemanticId and has no node",
            raw: e.to,
            edge_from: e.from,
            edge_to: e.to,
            relation: e.relation,
          });
        }
      } else {
        placeholderIds.add(e.to);
      }
    }
  }

  const edgeList = dedupeEdges([...edges].sort(compareEdge));

  // Fixed-point lifecycle: propagate AWAITING through neighbors before promoting RESOLVED.
  let changed = true;
  let guard = 0;
  while (changed && guard < nodeMap.size + 2) {
    changed = false;
    guard += 1;
    for (const node of [...nodeMap.values()]) {
      if (placeholderIds.has(node.id) || node.state === "AWAITING_RELATION" && !declaredNodes.has(node.id)) {
        continue;
      }
      if (!declaredNodes.has(node.id)) continue;

      const outgoing = edgeList.filter((e) => e.from === node.id);
      const incoming = edgeList.filter((e) => e.to === node.id);
      let state: SemanticLifecycleState =
        node.declaredCanonical && !implementationBroken.has(node.id) ? "CANONICAL" : "IDENTIFIED";
      if (implementationBroken.has(node.id)) {
        state = "IDENTIFIED";
      }
      if (outgoing.length + incoming.length > 0 && state === "IDENTIFIED") {
        state = "LINKED";
      }

      // Propagate awaiting only toward dependents (outgoing dependency-like edges),
      // never through incoming OWNS into unrelated siblings.
      const DEPENDENCY_LIKE = new Set<SemanticRelation>([
        "DEPENDS_ON",
        "REQUIRES",
        "VERIFIED_BY",
        "PROVEN_BY",
        "IMPLEMENTS",
        "AUTHORIZED_BY",
        "EXECUTED_BY",
        "USES_CONNECTION",
        "USES_CREDENTIAL",
        "REACHABLE_AT",
      ]);
      const neighborAwaiting = outgoing.some((e) => {
        if (!DEPENDENCY_LIKE.has(e.relation)) return false;
        const other = e.to;
        return nodeMap.get(other)?.state === "AWAITING_RELATION" || placeholderIds.has(other);
      });
      const implBroken = implementationBroken.has(node.id) || (Boolean(node.implementation) && !implementationResolved.has(node.id));

      if (neighborAwaiting) {
        state = "AWAITING_RELATION";
      } else if (!implBroken && (outgoing.length > 0 || implementationResolved.has(node.id))) {
        if (state === "LINKED" || state === "IDENTIFIED") state = "RESOLVED";
      }

      const verified = outgoing.some((e) => {
        if (e.relation !== "VERIFIED_BY") return false;
        const target = nodeMap.get(e.to);
        if (!target || !declaredNodes.has(e.to) || target.synthetic) return false;
        if (implementationBroken.has(e.to)) return false;
        return (
          target.state === "RESOLVED" ||
          target.state === "VERIFIED" ||
          target.state === "CANONICAL" ||
          target.state === "PROVEN"
        );
      });
      if (verified && !implBroken && !neighborAwaiting && (state === "RESOLVED" || state === "CANONICAL")) {
        if (state !== "CANONICAL") state = "VERIFIED";
      }

      if (state !== node.state) {
        nodeMap.set(node.id, { ...node, state });
        changed = true;
      }
    }
  }

  const missing_sources = uniqueSorted(missingSources);
  const missing_targets = uniqueSorted(missingTargets);
  const unresolved_references = uniqueSorted([...missing_sources, ...missing_targets]);

  const nodes = [...nodeMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  const graph: SemanticGraph = {
    nodes,
    edges: edgeList,
    source_revision: commitSha,
    derived: true,
    authoritative: false,
  };

  const diagnostics: SemanticDiscoveryDiagnostics = {
    duplicate_ids: [...duplicateIds].sort((a, b) => a.localeCompare(b)),
    invalid_ids: invalidIds,
    missing_sources,
    missing_targets,
    unresolved_references,
    invalid_implementations: invalidImplementations,
  };

  return { graph, diagnostics };
}

/** Graph-only convenience — callers that need integrity must use discoverSemantic. */
export function discoverSemanticGraph(options: DiscoverOptions = {}): SemanticGraph {
  return discoverSemantic(options).graph;
}

export function emptyDiscoveryDiagnostics(): SemanticDiscoveryDiagnostics {
  return emptyDiagnostics();
}

function compareEdge(a: SemanticEdge, b: SemanticEdge): number {
  return (
    a.from.localeCompare(b.from) ||
    a.relation.localeCompare(b.relation) ||
    a.to.localeCompare(b.to) ||
    a.source.path.localeCompare(b.source.path)
  );
}

function dedupeEdges(edges: readonly SemanticEdge[]): SemanticEdge[] {
  const seen = new Set<string>();
  const out: SemanticEdge[] = [];
  for (const e of edges) {
    const key = `${e.from}\0${e.relation}\0${e.to}\0${e.source.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
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
