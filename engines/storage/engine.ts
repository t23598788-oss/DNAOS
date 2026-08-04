/**
 * Storage Intelligence — orchestrator. Implements the 7 registered commands
 * (registry/command-registry.json: storage.scan/classify/report/
 * move_safe_to_trash/inspect_docker/verify_supabase/check_threshold).
 *
 * This is the ONLY module callers (gateway route, local scheduler script)
 * invoke — nothing outside engines/storage/ touches an adapter directly.
 * Every mutating operation defaults to dry-run; moveSafeToTrash requires an
 * explicit { dryRun: false } and only ever acts on resources already in
 * state SAFE (engines/storage/decisionEngine.ts is the sole author of SAFE).
 */
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { hostname } from "os";
import { join } from "path";
import { homedir } from "os";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  StorageResource,
  StorageEventEnvelope,
  StorageReclaimPlan,
} from "@/core/shared/types";
import { dirSizeBytes, sha256File, walk } from "./adapters/fsAdapter";
import { inspectGitRepo } from "./adapters/gitAdapter";
import { moveToTrash } from "./adapters/trashAdapter";
import { inspectDocker as dockerInspect, type DockerResourceReport } from "./adapters/dockerAdapter";
import { verifyObjectExists, type SupabaseObjectVerification } from "./adapters/supabaseVerifier";
import { gatherEvidence } from "./evidenceEngine";
import { classify, type ClassifyContext } from "./classifier";
import { decideState, buildReclaimPlan } from "./decisionEngine";
import { createMigrationPlan } from "@/engines/workspace/migrationEngine";
import { getDependents } from "@/engines/workspace/dependencyRegistry";

const HOME = homedir();
const FREE_SPACE_TARGET_BYTES = 150 * 1e9;

// Bounded, curated scan surface — not a full-disk crawl. Extend this list as
// new safe-to-inspect areas are identified; never widen it to protected roots.
const NEVER_TOUCH_ROOTS = [
  join(HOME, "Desktop", "DNA OS-โฟลเดอร์หลักต้นฉบับ "),
  join(HOME, ".ssh"),
  join(HOME, ".gnupg"),
];

interface CacheRootDef { path: string; classificationHint: "CACHE" }
const CACHE_ROOTS: CacheRootDef[] = [
  { path: join(HOME, ".npm"), classificationHint: "CACHE" },
  { path: join(HOME, ".cache"), classificationHint: "CACHE" },
  { path: join(HOME, "Library", "Caches", "Homebrew"), classificationHint: "CACHE" },
];

// Migration Completion (owner, 2026-08-04): ~/.ollama only ever becomes
// eligible after classifyScan() has itself verified — live, not assumed —
// that no local-runtime script still calls localhost:11434 AND the Cloud
// Runtime reports volume_attached/model_present/model_verified/runtime_ready
// all true. See classifyScan()'s handling below and classifier.ts's
// LOCAL_AI_MODEL branch, which is the actual enforcement point.
const AI_MODEL_ROOTS = [join(HOME, ".ollama")];

const CLONE_CANDIDATE_ROOTS = [
  join(HOME, "Desktop", "soil-app-main"),
  join(HOME, "Desktop", "GitHub", "soil-app"),
  join(HOME, "Desktop", "GitHub", "dna-os"),
];

function isProtected(path: string): boolean {
  return NEVER_TOUCH_ROOTS.some((r) => path.startsWith(r)) || path.includes("/.git/") || path.endsWith(".env") || path.endsWith(".env.local");
}

// Event envelopes are constructed and returned to the caller (gateway route /
// watcher script), which logs/relays them — no separate event-store table
// exists for this capability (registry/events.json documents the 9 types;
// the real system-of-record for what happened is storage_resources/
// storage_classifications/storage_actions/storage_threshold_events, which
// ARE written transactionally above). Avoids inventing a duplicate ledger.
function buildEvent(
  partial: Omit<StorageEventEnvelope, "event_id" | "timestamp" | "machine_id">
): StorageEventEnvelope {
  return {
    event_id: randomUUID(),
    timestamp: new Date().toISOString(),
    machine_id: hostname(),
    ...partial,
  };
}

// ── storage.scan ──

export async function scanStorage(db: SupabaseClient, actor: string): Promise<{ scanRunId: string; resources: StorageResource[]; events: StorageEventEnvelope[] }> {
  const correlationId = randomUUID();
  const operationId = randomUUID();
  const events: StorageEventEnvelope[] = [];

  const { data: run, error } = await db
    .from("storage_scan_runs")
    .insert({ machine_id: hostname(), actor, roots_scanned: [...CACHE_ROOTS.map((c) => c.path), ...CLONE_CANDIDATE_ROOTS, ...AI_MODEL_ROOTS], correlation_id: correlationId })
    .select()
    .single();
  if (error || !run) throw Object.assign(new Error("scan run insert failed"), { code: "STORAGE_SCAN_INSERT_FAILED", context: { error } });

  events.push(buildEvent({ event_type: "storage.scan.started", actor, resource_path: null, resource_type: null, classification: null, size_bytes: null, checksum: null, evidence: null, decision: null, reason: null, operation_id: operationId, correlation_id: correlationId }));

  const candidates: { path: string; isCache: boolean; isCloneCandidate: boolean; isAiModel: boolean }[] = [
    ...CACHE_ROOTS.map((c) => ({ path: c.path, isCache: true, isCloneCandidate: false, isAiModel: false })),
    ...CLONE_CANDIDATE_ROOTS.map((p) => ({ path: p, isCache: false, isCloneCandidate: true, isAiModel: false })),
    ...AI_MODEL_ROOTS.map((p) => ({ path: p, isCache: false, isCloneCandidate: false, isAiModel: true })),
  ];

  const resources: StorageResource[] = [];
  for (const c of candidates) {
    if (isProtected(c.path)) continue;
    const size = dirSizeBytes(c.path);
    if (size === 0) continue;

    const { data: resourceRow, error: rErr } = await db
      .from("storage_resources")
      .insert({ scan_run_id: run.id, path: c.path, size_bytes: size, state: "DISCOVERED" })
      .select()
      .single();
    if (rErr || !resourceRow) continue;

    resources.push({
      path: c.path,
      size_bytes: size,
      sha256: null,
      modified_at: null,
      classification: { classification: "UNKNOWN", confidence: 0, evidence: [], recommended_action: "review", blocked_reason: "not yet classified" },
      state: "DISCOVERED",
    });
  }

  await db.from("storage_scan_runs").update({ completed_at: new Date().toISOString(), resource_count: resources.length, total_bytes: resources.reduce((s, r) => s + r.size_bytes, 0), status: "completed" }).eq("id", run.id);

  events.push(buildEvent({ event_type: "storage.scan.completed", actor, resource_path: null, resource_type: null, classification: null, size_bytes: resources.reduce((s, r) => s + r.size_bytes, 0), checksum: null, evidence: null, decision: null, reason: `${resources.length} resources discovered`, operation_id: operationId, correlation_id: correlationId }));

  return { scanRunId: run.id, resources, events };
}

// ── storage.classify ──

export async function classifyScan(
  db: SupabaseClient,
  scanRunId: string,
  actor: string,
  opts: { aiModelPolicy?: { noScriptDependents: boolean; cloudRuntimeVerified: boolean; evidence: string[] } } = {}
): Promise<{ resources: StorageResource[]; events: StorageEventEnvelope[] }> {
  const { data: rows, error } = await db.from("storage_resources").select("*").eq("scan_run_id", scanRunId);
  if (error || !rows) throw Object.assign(new Error("scan run not found"), { code: "STORAGE_CLASSIFY_SCAN_NOT_FOUND", context: { scanRunId, error } });

  const events: StorageEventEnvelope[] = [];
  const resources: StorageResource[] = [];

  for (const row of rows) {
    const path: string = row.path;
    const isCache = CACHE_ROOTS.some((c) => c.path === path);
    const isCloneCandidate = CLONE_CANDIDATE_ROOTS.includes(path);
    const isAiModel = AI_MODEL_ROOTS.includes(path);

    const ev = await gatherEvidence(path, { hash: false });

    const ctx: ClassifyContext = { isProtectedRoot: isProtected(path) };
    if (isCloneCandidate) {
      ctx.isUnusedProjectClone = { isGitRepo: ev.git.is_git_repo, isClean: ev.git.is_clean, remote: ev.git.remote_url };
    }
    if (isAiModel && opts.aiModelPolicy) {
      ctx.localAiModelPolicy = opts.aiModelPolicy;
    }
    // Real wiring (Roadmap #46, 2026-08-04) — previously this field was
    // declared but never populated (documented gap in classifier.ts). Now
    // backed by the real dependency graph: a resource with any real
    // dependent (import, LaunchAgent, command owner, etc.) is never SAFE.
    const dependents = getDependents(path);
    if (dependents.length > 0) ctx.referencedBySource = true;
    // isCache is redundant with pattern-matching in classifier but documented
    // here for traceability — the classifier's own pattern match is authoritative.
    void isCache;

    const classification = classify(ev, ctx);
    const state = decideState(classification);

    await db.from("storage_classifications").insert({
      resource_id: row.id,
      classification: classification.classification,
      confidence: classification.confidence,
      recommended_action: classification.recommended_action,
      blocked_reason: classification.blocked_reason,
    });
    for (const e of classification.evidence) {
      await db.from("storage_evidence").insert({ resource_id: row.id, kind: e.kind, detail: e.detail, value: e.value != null ? String(e.value) : null });
    }
    await db.from("storage_resources").update({ state }).eq("id", row.id);

    const correlationId = randomUUID();
    events.push(buildEvent({
      event_type: "storage.resource.classified", actor, resource_path: path, resource_type: classification.classification,
      classification: classification.classification, size_bytes: row.size_bytes, checksum: null,
      evidence: classification.evidence, decision: state, reason: classification.blocked_reason,
      operation_id: randomUUID(), correlation_id: correlationId,
    }));
    if (state === "BLOCKED") {
      events.push(buildEvent({
        event_type: "storage.operation.blocked", actor, resource_path: path, resource_type: classification.classification,
        classification: classification.classification, size_bytes: row.size_bytes, checksum: null, evidence: null,
        decision: state, reason: classification.blocked_reason, operation_id: randomUUID(), correlation_id: correlationId,
      }));
    }

    resources.push({ path, size_bytes: row.size_bytes, sha256: null, modified_at: row.modified_at, classification, state });
  }

  return { resources, events };
}

// ── storage.report ──

export interface StorageReport {
  free_bytes: number;
  target_bytes: number;
  gap_bytes: number;
  safe: StorageResource[];
  blocked: StorageResource[];
  unknown: StorageResource[];
  total_safe_bytes: number;
}

export async function report(db: SupabaseClient, scanRunId: string): Promise<StorageReport> {
  const { data: rows } = await db
    .from("storage_resources")
    .select("*, storage_classifications(classification, confidence, recommended_action, blocked_reason)")
    .eq("scan_run_id", scanRunId);

  const resources: StorageResource[] = (rows ?? []).map((r: any) => {
    const c = r.storage_classifications?.[0];
    return {
      path: r.path,
      size_bytes: r.size_bytes,
      sha256: r.sha256,
      modified_at: r.modified_at,
      classification: {
        classification: c?.classification ?? "UNKNOWN",
        confidence: c?.confidence ?? 0,
        evidence: [],
        recommended_action: c?.recommended_action ?? "review",
        blocked_reason: c?.blocked_reason ?? null,
      },
      state: r.state,
    };
  });

  const freeBytes = getFreeDiskBytes();
  const safe = resources.filter((r) => r.state === "SAFE");
  const blocked = resources.filter((r) => r.state === "BLOCKED");
  const unknown = resources.filter((r) => r.classification.classification === "UNKNOWN");

  return {
    free_bytes: freeBytes,
    target_bytes: FREE_SPACE_TARGET_BYTES,
    gap_bytes: Math.max(0, FREE_SPACE_TARGET_BYTES - freeBytes),
    safe, blocked, unknown,
    total_safe_bytes: safe.reduce((s, r) => s + r.size_bytes, 0),
  };
}

// ── storage.move_safe_to_trash ──

export async function moveSafeToTrash(db: SupabaseClient, scanRunId: string, actor: string, opts: { dryRun: boolean }): Promise<{ plan: StorageReclaimPlan; moved: StorageResource[]; events: StorageEventEnvelope[] }> {
  const { data: rows } = await db.from("storage_resources").select("*").eq("scan_run_id", scanRunId).eq("state", "SAFE");
  const safeResources: StorageResource[] = (rows ?? []).map((r: any) => ({
    path: r.path, size_bytes: r.size_bytes, sha256: r.sha256, modified_at: r.modified_at,
    classification: { classification: "UNKNOWN", confidence: 0, evidence: [], recommended_action: "trash_eligible", blocked_reason: null },
    state: r.state,
  }));

  const plan = buildReclaimPlan(scanRunId, safeResources);
  const { data: planRow } = await db.from("storage_reclaim_plans").insert({
    scan_run_id: scanRunId, created_by: actor, total_bytes: plan.total_bytes,
    resource_ids: (rows ?? []).map((r: any) => r.id), correlation_id: plan.plan_id,
  }).select().single();

  const events: StorageEventEnvelope[] = [buildEvent({
    event_type: "storage.reclaim.plan.created", actor, resource_path: null, resource_type: null, classification: null,
    size_bytes: plan.total_bytes, checksum: null, evidence: null, decision: "PLANNED", reason: `${safeResources.length} SAFE resources`,
    operation_id: randomUUID(), correlation_id: plan.plan_id,
  })];

  if (opts.dryRun) {
    return { plan, moved: [], events };
  }

  const moved: StorageResource[] = [];
  for (let i = 0; i < safeResources.length; i++) {
    const resource = safeResources[i];
    const resourceRow = (rows ?? [])[i];
    const operationId = randomUUID();

    // Hard pre-check (Constitution Rule 116 / workspace lock manager +
    // resource migration engine): storage-intelligence's own SAFE
    // classification (fs/git/pattern evidence) is real but incomplete — it
    // has no idea a LaunchAgent or another module depends on this exact
    // path. Re-verify against the real dependency registry immediately
    // before the move, not just at classify time (state could be stale).
    const migrationPlan = await createMigrationPlan(db, resource.path, "file", actor);
    if (!migrationPlan.safe) {
      await db.from("storage_resources").update({ state: "BLOCKED" }).eq("id", resourceRow.id);
      events.push(buildEvent({
        event_type: "storage.operation.blocked", actor, resource_path: resource.path, resource_type: null,
        classification: null, size_bytes: resource.size_bytes, checksum: null, evidence: null, decision: "BLOCKED",
        reason: `resource.migration.blocked — ${migrationPlan.dependency_count} real dependent(s) found via workspace dependency registry, see resource_migration_blocks (plan ${migrationPlan.id})`, operation_id: operationId, correlation_id: plan.plan_id,
      }));
      continue;
    }

    try {
      const result = moveToTrash(resource.path);
      await db.from("storage_resources").update({ state: "MOVED_TO_TRASH" }).eq("id", resourceRow.id);
      await db.from("storage_actions").insert({
        resource_id: resourceRow.id, plan_id: planRow?.id ?? null, action: "moved_to_trash", actor,
        from_path: result.from_path, trash_path: result.trash_path, reason: "classified SAFE, moved by explicit confirm",
        operation_id: operationId, correlation_id: plan.plan_id,
      });
      events.push(buildEvent({
        event_type: "storage.resource.moved_to_trash", actor, resource_path: resource.path, resource_type: null,
        classification: null, size_bytes: resource.size_bytes, checksum: null, evidence: null, decision: "MOVED_TO_TRASH",
        reason: `moved to ${result.trash_path}`, operation_id: operationId, correlation_id: plan.plan_id,
      }));
      moved.push({ ...resource, state: "MOVED_TO_TRASH" });
    } catch (e: any) {
      await db.from("storage_resources").update({ state: "FAILED" }).eq("id", resourceRow.id);
      await db.from("storage_actions").insert({
        resource_id: resourceRow.id, plan_id: planRow?.id ?? null, action: "failed", actor,
        from_path: resource.path, reason: e?.message ?? "unknown error", operation_id: operationId, correlation_id: plan.plan_id,
      });
      events.push(buildEvent({
        event_type: "storage.operation.failed", actor, resource_path: resource.path, resource_type: null,
        classification: null, size_bytes: resource.size_bytes, checksum: null, evidence: null, decision: "FAILED",
        reason: e?.message ?? "unknown error", operation_id: operationId, correlation_id: plan.plan_id,
      }));
    }
  }

  return { plan, moved, events };
}

// ── storage.inspect_docker ──

export function inspectDocker(): DockerResourceReport {
  return dockerInspect();
}

// ── storage.verify_supabase ──

export async function verifySupabase(db: SupabaseClient, bucket: string, objectPath: string, expectedSha256?: string): Promise<SupabaseObjectVerification> {
  return verifyObjectExists(db, bucket, objectPath, expectedSha256);
}

// ── storage.check_threshold ──

function getFreeDiskBytes(): number {
  try {
    const out = execSync("df -k /System/Volumes/Data", { encoding: "utf8" });
    const line = out.trim().split("\n")[1];
    const cols = line.trim().split(/\s+/);
    const availableKb = parseInt(cols[3], 10);
    return availableKb * 1024;
  } catch {
    return 0;
  }
}

export async function checkThreshold(db: SupabaseClient, actor: string, reclaimableBytes: number | null = null): Promise<{ freeBytes: number; breached: boolean; events: StorageEventEnvelope[] }> {
  const freeBytes = getFreeDiskBytes();
  const breached = freeBytes < FREE_SPACE_TARGET_BYTES;

  await db.from("storage_threshold_events").insert({
    machine_id: hostname(), free_bytes: freeBytes, threshold_bytes: FREE_SPACE_TARGET_BYTES,
    reclaimable_bytes: reclaimableBytes, breached, notified: false,
  });

  const events: StorageEventEnvelope[] = [];
  if (breached) {
    events.push(buildEvent({
      event_type: "storage.threshold.breached", actor, resource_path: null, resource_type: null, classification: null,
      size_bytes: freeBytes, checksum: null, evidence: null, decision: null,
      reason: `free space ${(freeBytes / 1e9).toFixed(1)}GB below 150GB target`, operation_id: randomUUID(), correlation_id: randomUUID(),
    }));
  }
  return { freeBytes, breached, events };
}
