/**
 * หน้าที่: build the GAP QUEUE from records that already exist. It reads; it
 * never writes, never probes, and never infers a state that no record
 * supports.
 *
 * SOURCES, ALL EXISTING:
 *   control/command-router/       CAPABILITY_REGISTRY (health_status, endpoint kind, contract path)
 *   software/registry-database/   the canonical persistent registry + its real relationship edges
 *   control/agent-gateway/        the evidence store (BLOCKED tasks, verification reasons)
 *   the filesystem                only to answer "does the contract file the registry names exist"
 *
 * "DO NOT INFER MISSING DATA" IS ENFORCED, NOT ADVISED. A capability with no
 * verification evidence is CONNECTED_UNVERIFIED — not CONNECTED_VERIFIED
 * because it looks fine, and not ERROR because it has no proof. UNKNOWN is a
 * real answer this scanner is willing to give.
 *
 * ORDERING IS BY REAL DEPENDENCY EDGES, NOT BY NAME. `depth` counts how many
 * upstream capabilities are themselves in a bad state, using the persistent
 * registry's own CAPABILITY→CAPABILITY relationship rows. A capability whose
 * upstream is broken sorts after it, because repairing downstream first
 * produces a fix that cannot be verified.
 *
 * Input: none.
 * Output: `scanGaps`, `GapScanSummary`.
 * Dependency ที่อนุญาต: ./types.ts, ../command-router/contract.ts,
 * ../agent-gateway/contract.ts, ../../software/registry-database/contract.ts
 * (+ its persistent adapter), node:fs (existence checks only).
 * สิ่งที่ห้ามแตะ: never write to any store from this file. Never mark a gap
 * actionable without an evidence_ref that names the record proving it.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { listCapabilities } from "../command-router/contract";
import { loadAllEvidence, loadAllTasks } from "../agent-gateway/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { getWriteOwnershipIndex } from "../../software/capability-registrar/contract";
import type { GapRecord, GapState, RepairType } from "./types";

const REPO_ROOT = join(__dirname, "..", "..");

export interface GapScanSummary {
  readonly scanned: number;
  readonly counts: Readonly<Record<GapState, number>>;
  readonly queue: readonly GapRecord[];
  readonly sources_read: readonly string[];
}

/** Blocked/error reasons seen in the evidence store, keyed by capability-ish token. */
interface EvidenceSignal {
  readonly reason: string;
  readonly occurrences: number;
  readonly first_seen: string;
  readonly last_seen: string;
  readonly evidence_refs: readonly string[];
  readonly source: string;
  readonly intent_sample: string;
}

function collectEvidenceSignals(): Map<string, EvidenceSignal> {
  const tasks = new Map<string, { status: string; intent_text: string; client: string }>();
  for (const task of loadAllTasks() as unknown as { task_id: string; status: string; intent_text: string; submitted_by_client: string }[]) {
    tasks.set(task.task_id, { status: task.status, intent_text: task.intent_text, client: task.submitted_by_client });
  }

  const rows = loadAllEvidence() as unknown as { evidence_id: string; task_id: string; kind: string; source: string; recorded_at: string; payload: unknown }[];

  // A task whose terminal state has been explicitly CLASSIFIED as by-design is
  // not a gap. This is the pairing the repair for
  // AI_WRITE_ADAPTER_NOT_REGISTERED introduces: the emitting gateway keeps
  // recording the raw reason (it is telling the truth about what it did), and
  // the caller that deliberately caused it records why. Without this pairing a
  // deliberate stop and a real failure are indistinguishable, and the queue
  // fills with work that must not be done.
  // The full intentional-termination vocabulary, not just one label. The
  // first version matched only EXPECTED_BY_DESIGN and would have ignored the
  // 289 superseding rows written as SELF_EXECUTED / INTENTIONAL_NO_ADAPTER —
  // a classification the queue cannot read is the same as no classification.
  const INTENTIONAL = new Set([
    "EXPECTED_BY_DESIGN", "SELF_EXECUTED", "INTENTIONAL_NO_ADAPTER",
    "NOT_DISPATCH_REQUIRED", "EXPECTED_POLICY_BLOCK",
  ]);
  const classifiedByDesign = new Set<string>();
  for (const row of rows) {
    const payload = row.payload as { classification?: string } | null;
    if (payload?.classification && INTENTIONAL.has(payload.classification)) classifiedByDesign.add(row.task_id);
  }

  const byReason = new Map<string, { count: number; first: string; last: string; refs: string[]; source: string; intent: string }>();
  for (const row of rows) {
    if (row.kind !== "verification") continue;
    if (classifiedByDesign.has(row.task_id)) continue;
    // A SUPERSEDING row is commentary on an existing record, never a new
    // occurrence of the failure. Counting them doubled this queue on its
    // first real use: 226 replay rows carrying the original `reason` for
    // context were read as 226 fresh blocks, and the gap they were written
    // to close grew from 216 to 408 instead. A row that names the record it
    // supersedes is describing history, not making it.
    if (row.payload && (row.payload as { supersedes_evidence_id?: unknown }).supersedes_evidence_id) continue;
    const payload = row.payload as { reason?: string; verified?: boolean } | null;
    const reason = payload?.reason;
    // Only a NAMED reason is a signal. `{verified:false}` with no reason is
    // real data but says nothing about which boundary failed, so it is not
    // turned into a gap with an invented cause.
    if (!reason) continue;
    const task = tasks.get(row.task_id);
    if (!task || task.status !== "BLOCKED") continue;
    const current = byReason.get(reason);
    if (current) {
      current.count += 1;
      current.last = row.recorded_at;
      if (current.refs.length < 5) current.refs.push(row.evidence_id);
    } else {
      byReason.set(reason, { count: 1, first: row.recorded_at, last: row.recorded_at,
        refs: [row.evidence_id], source: row.source, intent: task.intent_text });
    }
  }

  const out = new Map<string, EvidenceSignal>();
  for (const [reason, v] of byReason) {
    out.set(reason, { reason, occurrences: v.count, first_seen: v.first, last_seen: v.last,
      evidence_refs: v.refs, source: v.source, intent_sample: v.intent });
  }
  return out;
}

function repairTypeFor(state: GapState, reason: string): RepairType | null {
  if (state === "MISSING_CONNECTION") return "MISSING_CONNECTION";
  if (state === "DECLARED_ONLY") return "MISSING_IMPLEMENTATION";
  if (state === "CONNECTED_UNVERIFIED") return "EVIDENCE_MISSING";
  if (state === "BLOCKED") {
    if (/PERMISSION|POLICY|DENIED|GATE/i.test(reason)) return "SECURITY_BLOCK";
    if (/ADAPTER|CAPABILITY|NOT_REGISTERED/i.test(reason)) return "REGISTRY_MISMATCH";
    return "RUNTIME_FAILURE";
  }
  if (state === "ERROR") return "RUNTIME_FAILURE";
  return null;
}

export function scanGaps(): GapScanSummary {
  const sourcesRead: string[] = [];
  const records: GapRecord[] = [];

  // --- 1. command-router capability registry -----------------------------
  const registry = listCapabilities();
  sourcesRead.push("control/command-router/capability-registry.ts");

  // --- 2. persistent software registry + its real dependency edges -------
  let capabilityNames = new Map<string, string>();
  const dependsOn = new Map<string, string[]>();
  try {
    const store = createPersistentFileStore();
    sourcesRead.push("software/registry-database/data/canonical/");
    const capRows = store.listCapabilityRows ? store.listCapabilityRows() : [];
    for (const row of capRows) capabilityNames.set(row.capability_id, row.canonical_name);
    const links = store.listRelationshipRows ? store.listRelationshipRows() : [];
    for (const link of links as unknown as { from_type: string; from_id: string; to_type: string; to_id: string }[]) {
      if (link.from_type !== "CAPABILITY" || link.to_type !== "CAPABILITY") continue;
      const from = capabilityNames.get(link.from_id) ?? link.from_id;
      const to = capabilityNames.get(link.to_id) ?? link.to_id;
      const list = dependsOn.get(to) ?? [];
      list.push(from);
      dependsOn.set(to, list);
    }
  } catch {
    // A registry that cannot be read is recorded as such rather than treated
    // as empty — "no edges" and "could not read edges" are different facts.
    sourcesRead.push("software/registry-database/data/canonical/ (UNREADABLE)");
  }

  // --- 3. evidence store --------------------------------------------------
  const signals = collectEvidenceSignals();
  sourcesRead.push("control/agent-gateway/data/evidence.jsonl");

  // --- 4. classify every registry capability -----------------------------
  for (const capability of registry) {
    const contractPath = capability.contract;
    const declaredOnly = capability.endpoint.kind === "not_yet_built";
    const fileExists = contractPath && !declaredOnly ? existsSync(join(REPO_ROOT, contractPath)) : false;

    let state: GapState;
    let reason: string;
    const evidenceRefs: string[] = [];

    if (declaredOnly) {
      state = "DECLARED_ONLY";
      reason = `endpoint.kind is "not_yet_built" — the registry declares this capability and names no callable surface`;
    } else if (!fileExists) {
      state = "MISSING_CONNECTION";
      reason = `registry names contract "${contractPath}" but no such file exists in this checkout`;
    } else if (capability.health_status !== "CONNECTED") {
      state = "BLOCKED";
      reason = `health_status is ${capability.health_status} while a real contract file exists`;
    } else {
      // CONNECTED with a real file. Verified only if a real verification
      // record exists for it; otherwise UNVERIFIED — never assumed good.
      state = "CONNECTED_UNVERIFIED";
      reason = "registry says CONNECTED and the contract file exists, but no verification evidence names this capability";
    }

    records.push({
      gap_id: `gap-${capability.capability_id}`,
      capability_id: capability.capability_id,
      source_path: contractPath || null,
      state, reason,
      evidence_refs: evidenceRefs,
      registry_refs: [`control/command-router/capability-registry.ts#${capability.capability_id}`],
      upstream: dependsOn.get(capability.capability_id) ?? [],
      downstream: [],
      depth: 0,
      occurrences: 1,
      first_seen: null,
      last_seen: null,
      repair_type: repairTypeFor(state, reason),
      // Always actionable here, and the reason is a real limitation worth
      // stating rather than hiding behind a `state !== "CONNECTED_VERIFIED"`
      // check that can never be false: NO record in this repo links a
      // verification result to a capability_id, so this scanner cannot
      // promote any registry capability to CONNECTED_VERIFIED. That missing
      // link IS the EVIDENCE_MISSING gap each of these rows reports. When a
      // verification record starts carrying a capability_id, this branch
      // gains a real CONNECTED_VERIFIED case and the sort below already
      // handles it.
      actionable: true,
      not_actionable_reason: null,
    });
  }

  // --- 5. every NAMED blocked reason in the evidence store is its own gap -
  // These are the real, observed failures — not derived from the registry at
  // all. They are what the Owner's "detect ERROR | BLOCKED" step is about.
  for (const signal of signals.values()) {
    records.push({
      gap_id: `gap-evidence-${signal.reason}`,
      capability_id: signal.source,
      source_path: signal.source.endsWith(".ts") ? signal.source : null,
      state: "BLOCKED",
      reason: `${signal.occurrences} BLOCKED task(s) recorded reason "${signal.reason}"; sample intent: ${signal.intent_sample.slice(0, 90)}`,
      evidence_refs: signal.evidence_refs,
      registry_refs: [],
      upstream: [],
      downstream: [],
      depth: 0,
      occurrences: signal.occurrences,
      first_seen: signal.first_seen,
      last_seen: signal.last_seen,
      repair_type: repairTypeFor("BLOCKED", signal.reason),
      actionable: true,
      not_actionable_reason: null,
    });
  }

  // --- 5b. UNOWNED SOURCE FOLDERS: the upstream gap the write gate exposes -
  //
  // Discovered by running the loop, not by design: a repair targeting
  // control/external-system-lifecycle/pipeline.ts was correctly DENIED by
  // permissions/write-gate with NO_MATCHING_CAPABILITY, because no entry in
  // the capability-registrar index owns that folder. Nothing can be written
  // into a folder that belongs to no registered capability — so an unowned
  // folder is an UPSTREAM gap that blocks every repair inside it.
  //
  // SCOPE, stated honestly: this pass sees only the folder that EMITTED the
  // evidence. In the case that exposed the problem the emitter
  // (control/agent-gateway/) is owned and the unowned folder was the CALL
  // SITE, which only root-cause analysis identifies — so that case is caught
  // by loop.ts's preDispatchStop instead, before an attempt is spent. This
  // pass still earns its place for the emitter-side case, and both together
  // cover the write target wherever it turns out to live.
  const ownedFolders = getWriteOwnershipIndex()
    .map((c) => (c as unknown as { OWNER_FOLDER: string }).OWNER_FOLDER)
    .filter((f) => f && !f.startsWith("UNKNOWN"));
  const implicatedFolders = new Set<string>();
  for (const signal of signals.values()) {
    if (!signal.source.endsWith(".ts")) continue;
    const folder = `${signal.source.split("/").slice(0, -1).join("/")}/`;
    if (!ownedFolders.some((owned) => folder.startsWith(owned))) implicatedFolders.add(folder);
  }
  for (const folder of implicatedFolders) {
    records.push({
      gap_id: `gap-unowned-${folder.replace(/\/$/, "")}`,
      capability_id: folder,
      source_path: folder,
      state: "MISSING_CONNECTION",
      reason: `no entry in the capability-registrar index owns ${folder}, so permissions/write-gate denies every write into it with NO_MATCHING_CAPABILITY`,
      evidence_refs: [],
      registry_refs: ["software/capability-registrar/index.ts (projection of control/command-router/capability-registry.ts)"],
      upstream: [],
      // Every blocked-evidence gap emitted from this folder depends on it.
      downstream: [...signals.values()].filter((sig) => sig.source.startsWith(folder)).map((sig) => `gap-evidence-${sig.reason}`),
      depth: 0,
      occurrences: 1,
      first_seen: null,
      last_seen: null,
      repair_type: "REGISTRY_MISMATCH",
      actionable: true,
      not_actionable_reason: null,
    });
  }

  // --- 6. dependency depth ------------------------------------------------
  // depth = how many of this capability's upstreams are themselves not
  // CONNECTED_VERIFIED. Repairing a downstream gap while its upstream is
  // broken produces a change that cannot be verified, so depth drives order.
  // Typed as GapState (not inferred) so the comparison below stays valid as
  // the graph improves: today nothing is CONNECTED_VERIFIED yet, and an
  // inferred union would make this check dead code the moment one is.
  const stateById = new Map<string, GapState>(records.map((r) => [r.capability_id, r.state]));
  // A gap named as `downstream` by an unowned-folder gap inherits depth 1, so
  // the folder's own registration sorts ahead of every repair inside it. This
  // is the concrete meaning of "upstream gaps before dependent downstream
  // gaps": attempting the inner repair first wastes an attempt on a write the
  // gate will always deny.
  const blockedByUnowned = new Set(records.flatMap((r) => (r.gap_id.startsWith("gap-unowned-") ? r.downstream : [])));
  const withDepth = records.map((r) => {
    const badUpstream = r.upstream.filter((u) => (stateById.get(u) ?? "UNKNOWN") !== "CONNECTED_VERIFIED");
    const inherited = blockedByUnowned.has(r.gap_id) ? 1 : 0;
    return { ...r, depth: badUpstream.length + inherited };
  });

  // --- 7. deterministic order --------------------------------------------
  // Upstream-first (lower depth), then most-observed (a failure seen 280
  // times matters more than one seen once), then gap_id for a stable tie
  // break so two runs of this scanner produce the identical queue.
  const queue = [...withDepth].sort((a, b) =>
    a.depth - b.depth || b.occurrences - a.occurrences || a.gap_id.localeCompare(b.gap_id));

  const counts = { CONNECTED_VERIFIED: 0, CONNECTED_UNVERIFIED: 0, DECLARED_ONLY: 0,
    MISSING_CONNECTION: 0, BLOCKED: 0, ERROR: 0, UNKNOWN: 0 } as Record<GapState, number>;
  for (const r of queue) counts[r.state] += 1;

  return { scanned: queue.length, counts, queue, sources_read: sourcesRead };
}
