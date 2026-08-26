/**
 * หน้าที่: derives the LIVE CENSUS. Every `CapabilityRecord` here is COMPUTED
 * from observed facts supplied by `./host-runtime.ts` — nothing is read from a
 * maintained snapshot, and there is deliberately no way to SET a status.
 *
 * The anti-staleness mechanism, in one sentence: a capability counts as
 * VERIFIED only while its CURRENT source digest still equals the digest that
 * was recorded when it was verified; the moment an implementation byte changes
 * the digest moves and the status derives to CHANGED_SINCE_VERIFICATION.
 * That is why `deriveStatus` takes the ledger and the live digest and cannot be
 * told an answer.
 *
 * Input: observations (see `Observation`), which the CLI gathers from the host.
 * Output: `deriveCapability`, `deriveCensus`, `deriveDrift`, `deriveStatus`,
 * `deriveEdges`.
 * Dependency ที่อนุญาต: ./types.ts only — this file is pure, so
 * `./tests/derive.test.ts` can drive it with synthetic observations and prove
 * the state machine without needing a repository in a particular state.
 * สิ่งที่ห้ามแตะ: never let REGISTERED imply VERIFIED. Never return VERIFIED
 * without a ledger record whose digest matches the live one.
 */

import type {
  CapabilityRecord,
  CapabilityStatus,
  CensusDrift,
  GraphEdge,
  LiveCensus,
  RegistrationState,
  RuntimeState,
  TestState,
  VerificationRecord,
} from "./types";

/** Everything the host observed about one capability folder. */
export interface Observation {
  repository: string;
  path: string;
  code_files: readonly string[];
  test_files: readonly string[];
  source_digest: string;
  test_digest: string;
  entrypoint: string | null;
  last_commit: { sha: string; date: string } | null;
  dirty: boolean;
  newest_mtime: string | null;
  importers: readonly string[];
  dependencies: readonly string[];
  registry_matches: readonly string[];
  runtime_refs: readonly string[];
  /** Resolved through the EXISTING registry path lookup — never minted here. `null` when no registered resource covers this path. */
  resource_id: string | null;
  /** OS-evidence answer for "is anything using this right now", when a snapshot was taken. */
  runtime_evidence: { state: RuntimeState; consumers: number; evidence: readonly string[] } | null;
  observed_at: string;
}

const DOMAIN_BY_TOP: Record<string, string> = {
  ai: "AI / model routing",
  audit: "Evidence / provenance",
  config: "Configuration",
  connections: "Connectors / external systems",
  contracts: "Contracts",
  control: "Control plane",
  credentials: "Credentials / secrets",
  "dna-os-circuit": "Circuit language / visualization",
  execution: "Execution",
  governance: "Governance",
  "local-runtime": "Runtime services",
  observability: "Observability",
  permissions: "Permissions / policy",
  providers: "Providers",
  software: "Registry / software knowledge",
  transport: "Ingress / transport",
};

/** Capabilities whose own source touches a real security boundary. Derived from dependencies, not a curated list. */
const SECURITY_MARKERS: Record<string, string> = {
  "execution/process-lock": "cross-process mutex",
  "control/runtime-adapter": "seatbelt sandbox + PTY",
  "control/agent-host": "sandbox profile rendering",
  "permissions/execution-policy": "execution permission decision",
  "permissions/write-gate": "write authorization",
  "permissions/access-control": "identity / membership",
  "credentials/macos-keychain": "secret material",
  "execution/run": "process gate",
};

export function deriveDomain(path: string): string {
  return DOMAIN_BY_TOP[path.split("/")[0]] ?? "Unclassified";
}

function deriveRuntimeState(obs: Observation): RuntimeState {
  // Deterministic OS evidence wins when it exists. The command-string match
  // below is kept as the fallback it always was — not deleted, because a
  // capability observed with no snapshot available must still derive to
  // something honest.
  if (obs.runtime_evidence && obs.runtime_evidence.state !== "SNAPSHOT_UNAVAILABLE") return obs.runtime_evidence.state;
  if (obs.runtime_refs.length > 0) return "RUNNING";
  if (obs.code_files.length === 0) return "NOT_APPLICABLE";
  if (obs.runtime_evidence) return obs.runtime_evidence.state;
  return "UNKNOWN";
}

function deriveTestState(obs: Observation): TestState {
  return obs.test_files.length > 0 ? "HAS_TESTS" : "NO_TESTS";
}

function deriveRegistrationState(obs: Observation): RegistrationState {
  if (obs.registry_matches.length === 0) return "UNREGISTERED";
  // Every current registry row carries verified_at:null — registration alone
  // says nothing about health, so a registered-but-unverified row is STALE the
  // moment its source has moved past whatever was registered.
  return obs.registry_matches.every((m) => m.endsWith("@unverified")) ? "REGISTERED_STALE" : "REGISTERED";
}

/**
 * THE STATE MACHINE. Ordering matters and is deliberate: structural verdicts
 * (no code, no callers) come before evidence-based ones, because a folder with
 * no implementation cannot be "verified" no matter what a ledger claims.
 */
export function deriveStatus(
  obs: Observation,
  ledger: readonly VerificationRecord[],
  reverificationQueue: ReadonlySet<string> = new Set(),
): { status: CapabilityStatus; reason: string; last_verified: string | null } {
  const key = capabilityKey(obs.repository, obs.path);

  if (obs.code_files.length === 0) {
    return { status: "DECLARED_ONLY", reason: "folder contains documentation/data but no .ts/.mjs implementation", last_verified: null };
  }

  if (reverificationQueue.has(key)) {
    return { status: "VERIFYING", reason: "queued for re-verification and currently being verified", last_verified: null };
  }

  const mine = ledger.filter((r) => r.capability_key === key);
  const latest = mine.length > 0 ? mine[mine.length - 1] : null;

  if (!latest) {
    // A capability with a LIVE process is wired by definition, whatever the
    // import graph says. transport/owner-command-http has no importers and no
    // contract.ts, yet runs as launchd com.dnaos.owner-command-http — calling
    // that UNWIRED was a false negative that would have sent someone to delete
    // a running service.
    if (obs.runtime_refs.length > 0) {
      return { status: "UNVERIFIED", reason: `running live (${obs.runtime_refs.length} process ref(s)) but no verification evidence recorded`, last_verified: null };
    }
    if (obs.importers.length === 0 && !obs.entrypoint) {
      return { status: "UNWIRED", reason: "no verification evidence, no importers, no public contract.ts, and no live process", last_verified: null };
    }
    return {
      status: "UNVERIFIED",
      reason: obs.test_files.length > 0
        ? `has ${obs.test_files.length} test file(s) but no verification evidence recorded in the ledger`
        : "no tests and no verification evidence",
      last_verified: null,
    };
  }

  if (latest.outcome === "BLOCKED") {
    return { status: "BLOCKED", reason: `ledger records BLOCKED: ${latest.evidence_ref}`, last_verified: latest.verified_at };
  }
  if (latest.outcome === "FAILED") {
    return { status: "FAILED", reason: `last verification FAILED: ${latest.evidence_ref}`, last_verified: latest.verified_at };
  }

  // The anti-staleness comparison. This is the mechanism the Owner directive demands.
  if (latest.source_digest !== obs.source_digest) {
    return {
      status: "CHANGED_SINCE_VERIFICATION",
      reason: `source digest moved ${latest.source_digest} -> ${obs.source_digest} since verification at ${latest.verified_at}; prior evidence (${latest.evidence_ref}) no longer covers this code`,
      last_verified: latest.verified_at,
    };
  }

  if (latest.outcome === "PARTIAL") {
    return { status: "PARTIAL", reason: `verified PARTIAL against the current source: ${latest.evidence_ref}`, last_verified: latest.verified_at };
  }
  return { status: "VERIFIED", reason: `evidence matches the current source digest ${obs.source_digest}: ${latest.evidence_ref}`, last_verified: latest.verified_at };
}

export function capabilityKey(repository: string, path: string): string {
  return `${repository}:${path}`;
}

export function deriveCapability(
  obs: Observation,
  ledger: readonly VerificationRecord[],
  reverificationQueue?: ReadonlySet<string>,
): CapabilityRecord {
  const { status, reason, last_verified } = deriveStatus(obs, ledger, reverificationQueue);
  const key = capabilityKey(obs.repository, obs.path);
  const name = obs.path.split("/").slice(1).join("/") || obs.path;
  const registrationState = deriveRegistrationState(obs);
  const securityBoundary = Object.entries(SECURITY_MARKERS)
    .filter(([p]) => obs.path === p || obs.dependencies.includes(p))
    .map(([p, label]) => `${p} (${label})`);

  return {
    capability_key: key,
    capability_id: obs.registry_matches[0]?.split("@")[0] ?? null,
    // The identity the registry already holds for this path. Populated only
    // when the resolver proved it; never invented here.
    resource_id: obs.resource_id,
    canonical_name: name,
    domain: deriveDomain(obs.path),
    repository: obs.repository,
    path: obs.path,
    entrypoint: obs.entrypoint,
    version_commit: obs.last_commit?.sha ?? null,
    last_changed: obs.last_commit?.date ?? obs.newest_mtime,
    owner_boundary: obs.path.split("/")[0],
    input_contract: [],
    output_contract: [],
    dependencies: obs.dependencies,
    callers: obs.importers,
    downstream: [],
    runtime_state: deriveRuntimeState(obs),
    test_state: deriveTestState(obs),
    test_files: obs.test_files,
    verification_state: status,
    evidence_references: ledger.filter((r) => r.capability_key === key).map((r) => r.evidence_ref),
    registration_state: registrationState,
    registry_matches: obs.registry_matches,
    lineage: ledger.filter((r) => r.capability_key === key).map((r) => `${r.verified_at}:${r.outcome}:${r.source_digest}`),
    supersedes: [],
    duplicates: obs.registry_matches.length > 1 ? obs.registry_matches : [],
    security_boundary: securityBoundary,
    source_digest: obs.source_digest,
    last_observed: obs.observed_at,
    last_verified,
    current_status: status,
    status_reason: reason,
  };
}

/** Drift between the previous census and this one. Empty previous = first run, everything is ADDED. */
export function deriveDrift(previous: readonly CapabilityRecord[], current: readonly CapabilityRecord[]): CensusDrift[] {
  const drift: CensusDrift[] = [];
  const prevByKey = new Map(previous.map((c) => [c.capability_key, c]));
  const currByKey = new Map(current.map((c) => [c.capability_key, c]));

  for (const cur of current) {
    const prev = prevByKey.get(cur.capability_key);
    if (!prev) {
      drift.push({ capability_key: cur.capability_key, change: "CAPABILITY_ADDED", detail: `new capability at ${cur.path}` });
      continue;
    }
    if (prev.source_digest !== cur.source_digest) {
      drift.push({ capability_key: cur.capability_key, change: "SOURCE_CHANGED", detail: `${prev.source_digest} -> ${cur.source_digest}` });
    }
    if (prev.dependencies.join(",") !== cur.dependencies.join(",")) {
      drift.push({ capability_key: cur.capability_key, change: "DEPENDENCY_CHANGED", detail: `${prev.dependencies.length} -> ${cur.dependencies.length} dependencies` });
    }
    if (prev.callers.join(",") !== cur.callers.join(",")) {
      drift.push({ capability_key: cur.capability_key, change: "CONNECTION_CHANGED", detail: `${prev.callers.length} -> ${cur.callers.length} callers` });
    }
    if (prev.runtime_state !== cur.runtime_state) {
      drift.push({ capability_key: cur.capability_key, change: "RUNTIME_CHANGED", detail: `${prev.runtime_state} -> ${cur.runtime_state}` });
    }
    if (prev.test_files.join(",") !== cur.test_files.join(",")) {
      drift.push({ capability_key: cur.capability_key, change: "TEST_CHANGED", detail: `${prev.test_files.length} -> ${cur.test_files.length} test files` });
    }
    if (prev.evidence_references.length !== cur.evidence_references.length) {
      drift.push({ capability_key: cur.capability_key, change: "EVIDENCE_CHANGED", detail: `${prev.evidence_references.length} -> ${cur.evidence_references.length} evidence records` });
    }
    if (prev.registry_matches.join(",") !== cur.registry_matches.join(",")) {
      drift.push({ capability_key: cur.capability_key, change: "REGISTRY_CHANGED", detail: `${prev.registration_state} -> ${cur.registration_state}` });
    }
  }

  for (const prev of previous) {
    if (currByKey.has(prev.capability_key)) continue;
    const movedTo = current.find((c) => c.source_digest === prev.source_digest && c.source_digest !== "NO_SOURCE");
    drift.push(
      movedTo
        ? { capability_key: prev.capability_key, change: "CAPABILITY_MOVED", detail: `same source digest now at ${movedTo.path}` }
        : { capability_key: prev.capability_key, change: "CAPABILITY_REMOVED", detail: `no longer present at ${prev.path}` },
    );
  }
  return drift;
}

export function deriveCensus(
  repository: string,
  headCommit: string | null,
  observations: readonly Observation[],
  ledger: readonly VerificationRecord[],
  previous: readonly CapabilityRecord[] = [],
  reverificationQueue?: ReadonlySet<string>,
): LiveCensus {
  const capabilities = observations.map((o) => deriveCapability(o, ledger, reverificationQueue));
  const totals: Record<string, number> = {};
  const bump = (k: string): void => { totals[k] = (totals[k] ?? 0) + 1; };
  for (const c of capabilities) {
    bump(`status:${c.current_status}`);
    bump(`registration:${c.registration_state}`);
    bump(`runtime:${c.runtime_state}`);
    bump(`test:${c.test_state}`);
  }
  totals["capabilities:total"] = capabilities.length;
  return {
    generated_at: observations[0]?.observed_at ?? "unknown",
    repository,
    head_commit: headCommit,
    capabilities,
    drift: deriveDrift(previous, capabilities),
    totals,
  };
}

/**
 * Edges derived from real declared dependencies. State is derived from BOTH
 * endpoints' verification: an edge is only CONNECTED_VERIFIED when both ends
 * are verified, because a verified caller into unverified code is not a
 * verified connection.
 */
export function deriveEdges(capabilities: readonly CapabilityRecord[]): GraphEdge[] {
  const byPath = new Map(capabilities.map((c) => [c.path, c]));
  const edges: GraphEdge[] = [];
  for (const cap of capabilities) {
    for (const dep of cap.dependencies) {
      if (dep === cap.path) continue; // a capability is not its own edge
      const target = byPath.get(dep);
      if (!target) {
        edges.push({ from: cap.path, to: dep, state: "BROKEN", reason: `declared dependency ${dep} is not a discovered capability` });
        continue;
      }
      if (cap.current_status === "DECLARED_ONLY" || target.current_status === "DECLARED_ONLY") {
        edges.push({ from: cap.path, to: dep, state: "DECLARED_ONLY", reason: "one endpoint has no implementation" });
        continue;
      }
      const bothVerified = cap.current_status === "VERIFIED" && target.current_status === "VERIFIED";
      const eitherStale = cap.current_status === "CHANGED_SINCE_VERIFICATION" || target.current_status === "CHANGED_SINCE_VERIFICATION";
      edges.push({
        from: cap.path,
        to: dep,
        state: bothVerified ? "CONNECTED_VERIFIED" : "CONNECTED_UNVERIFIED",
        reason: bothVerified
          ? "both endpoints verified against their current source"
          : eitherStale
            ? "an endpoint changed since its verification"
            : `endpoint states: ${cap.current_status} -> ${target.current_status}`,
      });
    }
  }
  return edges;
}
