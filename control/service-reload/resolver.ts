/**
 * หน้าที่: the missing connection — SOURCE CHANGE -> SERVICE IMPACT -> GATE ->
 * `../runtime-control/` -> HEALTH -> REVISION PROOF -> EVIDENCE.
 *
 * WHY THIS EXISTS AT ALL. Everything either side of it already existed:
 * `control/runtime-control/` is the registered lifecycle authority (it already
 * knows `machine-observer`, its label, its port and its health path), and
 * `control/post-commit-verification/` is the verification path. Nothing mapped
 * a changed FILE to a registered SERVICE, so a source change and a running
 * process had no way to be related — which is how a daemon kept executing
 * code that had been replaced on disk 15 minutes earlier.
 *
 * WHAT IT IS NOT: a restart system. There is no launchctl call, no kill, no
 * spawn, and no supervision loop in this folder. It asks `runOperation` and
 * reports what came back.
 *
 * THE IMPACT MAP IS NOT HARD-CODED. A service's source root is read out of that
 * service's OWN plist — the entrypoint launchd is configured to run — so the
 * mapping is whatever the system is really configured to do, and it stays
 * correct when that configuration changes.
 *
 * Input: changed absolute paths.
 * Output: `resolveServiceImpact`, `computeSourceRevision`, `requestReload`.
 * Dependency ที่อนุญาต: ./types.ts, ../runtime-control/contract.ts, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามให้ observation layer หรือไฟล์นี้เรียก launchctl/kill เอง.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { runWorkingTreeVerification, resolveWorkingTreeRevision } from "../working-tree-verification/contract";
import { findVerificationForCommit } from "../post-commit-verification/contract";
import { runOperation, SERVICES } from "../runtime-control/contract";

/**
 * ตัวตนของ capability นี้เมื่อมันเป็นผู้ขอเอง ใช้เฉพาะเส้นทาง AUTOMATIC เท่านั้น
 * ห้ามใช้กับ trigger OWNER เพราะโหมดที่ผู้เรียกประกาศไม่ใช่ตัวตนที่พิสูจน์แล้ว
 */
const SERVICE_RELOAD_REQUESTER_IDENTITY = { identity_id: "identity-service-reload", kind: "service" } as const;
import type { ServiceId } from "../runtime-control/contract";
import type {
  ServiceImpact, SourceRevision, ReloadGate, ReloadOutcome, RevisionProof, GateStatus, ReloadTrigger,
} from "./types";

function plistStrings(xml: string, key: string): string[] {
  const arr = xml.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`));
  if (arr) return [...arr[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]);
  const one = xml.match(new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`));
  return one ? [one[1]] : [];
}

/**
 * The directory whose contents that service actually runs, taken from its own
 * LaunchAgent: the first ProgramArguments entry that looks like a script and
 * really exists on disk, resolved against WorkingDirectory when relative.
 */
export function serviceSourceRoot(serviceId: ServiceId): { root: string | null; evidence: string[] } {
  const def = SERVICES[serviceId];
  const evidence: string[] = [];
  if (!existsSync(def.plist_path)) {
    return { root: null, evidence: [`plist ${def.plist_path} is not installed, so no source root can be read from configuration`] };
  }
  const xml = readFileSync(def.plist_path, "utf8");
  const wd = plistStrings(xml, "WorkingDirectory")[0] ?? null;
  const args = plistStrings(xml, "ProgramArguments");
  for (const a of args) {
    if (!/\.(ts|tsx|mjs|cjs|js)$/.test(a)) continue;
    const abs = isAbsolute(a) ? a : wd ? join(wd, a) : null;
    if (!abs || !existsSync(abs)) continue;
    evidence.push(`${def.plist_path} runs "${a}"${wd ? ` from WorkingDirectory ${wd}` : ""}; that entrypoint exists at ${abs}`);
    return { root: dirname(abs), evidence };
  }
  return { root: null, evidence: [`${def.plist_path} names no ProgramArguments entrypoint that exists on disk`] };
}

/** Which registered service (if any) owns these changed paths. */
export function resolveServiceImpact(changedPaths: readonly string[]): ServiceImpact {
  const evidence: string[] = [];
  for (const serviceId of Object.keys(SERVICES) as ServiceId[]) {
    const { root, evidence: rootEvidence } = serviceSourceRoot(serviceId);
    if (!root) continue;
    const owned = changedPaths.filter((p) => p === root || p.startsWith(`${root}/`));
    if (owned.length === 0) continue;
    evidence.push(...rootEvidence);
    evidence.push(`${owned.length} changed path(s) are inside that source root`);
    return { service_id: serviceId, changed_paths: owned, source_root: root, status: "RESOLVED", evidence };
  }
  return {
    service_id: null, changed_paths: changedPaths, source_root: null,
    status: changedPaths.length === 0 ? "NO_SERVICE_IMPACT" : "UNRESOLVED_RESOURCE",
    evidence: ["no registered service's plist points its entrypoint at a directory containing these paths"],
  };
}

/** A derived revision identity for a source tree — see ./types.ts. */
export function computeSourceRevision(sourceRoot: string): SourceRevision {
  const files: { path: string; size: number; mtime: string }[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return;
    for (const name of readdirSync(dir).sort()) {
      if (name === "data" || name === "tests" || name === "node_modules") continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full, depth + 1); continue; }
      if (!/\.(ts|tsx|mjs|cjs|js)$/.test(name)) continue;
      files.push({ path: full.slice(sourceRoot.length + 1), size: st.size, mtime: st.mtime.toISOString() });
    }
  };
  walk(sourceRoot, 0);
  const digest = createHash("sha256")
    .update(files.map((f) => `${f.path}:${f.size}:${f.mtime}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  const newest = files.reduce((acc, f) => (f.mtime > acc ? f.mtime : acc), "");
  return { source_root: sourceRoot, revision_digest: digest, file_count: files.length, newest_mtime: newest, files };
}

/** Process start time from `ps`, never inferred from the restart returning SUCCESS. */
function processStartedAt(pid: number): string | null {
  try {
    const out = execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();
    if (!out) return null;
    const t = Date.parse(out);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  } catch {
    return null;
  }
}

/**
 * The gate. It runs this repository's OWN declared required checks — it does
 * not invent a check, and it no longer runs a `tsc` of its own.
 *
 * WHICH AUTHORITY APPLIES IS DECIDED BY GIT, NOT BY THE CALLER:
 *
 *   impacted source is DIRTY -> ../working-tree-verification/ runs the required
 *     checks against a deterministic digest of the uncommitted state.
 *     Authority: WORKING_TREE_VERIFIED (owner-triggered reload only).
 *
 *   impacted source is CLEAN -> the tree equals HEAD, so the authority that
 *     applies is a commit's, and ../post-commit-verification/ owns it. This
 *     flow does not run it (its input needs a task_id and a real
 *     source-execution record, neither of which a reload has); it reports
 *     UNRESOLVED and names what is missing.
 *
 * The blast-radius rule is kept where it still applies: a check failure is
 * reported with the files it came from, and a pre-existing failure in a folder
 * the impacted service does not reference is named in `unresolved_reasons`
 * rather than silently dropped or allowed to make a correct service
 * unreloadable.
 */
export async function runReloadGate(repoRoot: string, sourceRoot: string | null): Promise<ReloadGate> {
  const checks: { name: string; status: GateStatus; detail: string; command: string | null }[] = [];
  const unresolved: string[] = [];

  const revision = resolveWorkingTreeRevision(repoRoot);
  if (revision === null) {
    return { status: "UNRESOLVED", authority: "NONE", verified_revision: null, checks, unresolved_reasons: ["git could not report the state of the working tree, so neither authority could be established"] };
  }

  const rel = sourceRoot && sourceRoot.startsWith(repoRoot) ? sourceRoot.slice(repoRoot.length + 1) : null;
  const impactedDirty = rel === null ? [] : revision.dirty_paths.filter((d) => d.path === rel || d.path.startsWith(`${rel}/`));

  if (impactedDirty.length === 0) {
    // CLEAN: the tree equals HEAD, so the authority that applies is the
    // commit's. This does not RUN post-commit verification — running it needs a
    // task_id and a persisted SUCCEEDED source-execution record, and a reload
    // request has neither. It reads whether a verdict already exists. A reload
    // that could trigger its own verification would be a reload verifying
    // itself.
    const existing = findVerificationForCommit(revision.head_sha, repoRoot);
    if (existing !== null && existing.status === "VERIFIED") {
      checks.push({
        name: "post_commit_verification",
        status: "PASSED",
        detail: `commit ${revision.head_sha.slice(0, 12)} was verified by ${existing.verification_id} (${existing.reason_code})`,
        command: null,
      });
      return { status: "PASSED", authority: "COMMIT_VERIFIED", verified_revision: revision.head_sha, checks, unresolved_reasons: unresolved };
    }

    unresolved.push(
      existing === null
        ? `the impacted source ${rel ?? "(unresolved)"} is clean at HEAD ${revision.head_sha.slice(0, 12)}, and control/post-commit-verification holds no verification record for that commit. Nothing here can create one: running it requires a task_id and a persisted SUCCEEDED source-execution record for the artifact, which a reload request does not carry.`
        : `HEAD ${revision.head_sha.slice(0, 12)} has a verification record (${existing.verification_id}) but its status is ${existing.status} (${existing.reason_code}), not VERIFIED.`
    );
    checks.push({
      name: "post_commit_verification",
      status: existing === null ? "UNRESOLVED" : existing.status === "FAILED" ? "FAILED" : "UNRESOLVED",
      detail: existing === null ? `no record for HEAD ${revision.head_sha.slice(0, 12)}` : `record ${existing.verification_id} is ${existing.status}`,
      command: null,
    });
    const cleanStatus: GateStatus = existing !== null && existing.status === "FAILED" ? "FAILED" : "UNRESOLVED";
    return { status: cleanStatus, authority: "NONE", verified_revision: revision.head_sha, checks, unresolved_reasons: unresolved };
  }

  const verification = await runWorkingTreeVerification(
    { repo_root: repoRoot, claimed_changed_paths: impactedDirty.map((d) => join(repoRoot, d.path)), correlation_id: `reload-${revision.working_tree_digest.slice(0, 12)}` },
    { saveCheckEvidence: (check) => check.check_id },
  );

  for (const check of verification.checks) {
    checks.push({
      name: check.check_type,
      status: check.status,
      detail: `${check.command_reference} exited ${String(check.exit_code)} (${check.status})`,
      command: check.command_reference,
    });
  }

  if (verification.unverified_claims.length > 0) {
    unresolved.push(`git does not report these claimed paths as changed: ${verification.unverified_claims.join(", ")}`);
  }
  if (verification.status !== "WORKING_TREE_VERIFIED") {
    unresolved.push(`working-tree verification returned ${verification.status} (${verification.reason_code})`);
  }

  const status: GateStatus = verification.status === "WORKING_TREE_VERIFIED" ? "PASSED" : verification.status === "FAILED" ? "FAILED" : "UNRESOLVED";
  return {
    status,
    // Never stronger than what was actually established, and never
    // COMMIT_VERIFIED from this branch — the change is uncommitted by definition.
    authority: status === "PASSED" ? "WORKING_TREE_VERIFIED" : "NONE",
    verified_revision: verification.revision?.working_tree_digest ?? null,
    checks,
    unresolved_reasons: unresolved,
  };
}

/*
 * READINESS LIVES IN runtime-control, NOT HERE (Owner, 2026-08-26).
 *
 * This file briefly carried its own post-restart health poll, to work around
 * runtime-control recording FAILED for restarts that had plainly worked. That
 * was treating the symptom, and it created a second opinion about whether a
 * service is up. The cause is fixed at the source instead: runOperation now
 * polls health to each service's own declared `readiness_timeout_ms` rather
 * than sampling it once, ~200ms after launchd forks. So this capability asks,
 * and believes the answer.
 */

export interface ReloadRequest {
  changed_paths: readonly string[];
  repo_root: string;
  /**
   * Who is asking. AUTOMATIC is refused unless the gate established
   * COMMIT_VERIFIED authority — an unattended action never runs on a tree that
   * can change between the check and the act. Defaults to OWNER.
   */
  trigger?: ReloadTrigger;
  /** Default false: resolving and gating happens, nothing is asked of runtime-control. */
  execute?: boolean;
}

/**
 * The whole flow. With `execute: false` (the default) it resolves impact, runs
 * the gate and reports SERVICE_RELOAD_REQUIRED without asking runtime-control
 * for anything — which is the mode the observation layer uses, because the
 * observation layer may report but never act.
 */
export async function requestReload(req: ReloadRequest): Promise<ReloadOutcome> {
  const observed_at = new Date().toISOString();
  const impact = resolveServiceImpact(req.changed_paths);

  if (impact.status !== "RESOLVED" || impact.service_id === null || impact.source_root === null) {
    return {
      decision: impact.status === "NO_SERVICE_IMPACT" ? "NOT_REQUIRED" : "BLOCKED_UNRESOLVED_IMPACT",
      impact, revision: null,
      gate: { status: "UNRESOLVED", authority: "NONE", verified_revision: null, checks: [], unresolved_reasons: ["impact was not resolved, so no gate was run"] },
      operation: null, proof: null, health_after: null,
      reason: impact.evidence[0] ?? "no service impact",
      observed_at,
    };
  }

  const revision = computeSourceRevision(impact.source_root);
  const gate = await runReloadGate(req.repo_root, impact.source_root);

  if (gate.status !== "PASSED") {
    return {
      decision: "BLOCKED_BY_GATE", impact, revision, gate, operation: null, proof: null, health_after: null,
      reason: `gate status ${gate.status}: ${gate.checks.find((c) => c.status !== "PASSED")?.detail ?? "no passing gate"}`,
      observed_at,
    };
  }

  const trigger: ReloadTrigger = req.trigger ?? "OWNER";
  if (trigger === "AUTOMATIC" && gate.authority !== "COMMIT_VERIFIED") {
    return {
      decision: "BLOCKED_INSUFFICIENT_AUTHORITY", impact, revision, gate, operation: null, proof: null, health_after: null,
      reason: `an AUTOMATIC reload requires COMMIT_VERIFIED authority; this gate established ${gate.authority}. An owner may still reload this now.`,
      observed_at,
    };
  }

  if (!req.execute) {
    return {
      decision: "NOT_REQUIRED", impact, revision, gate, operation: null, proof: null, health_after: null,
      reason: "SERVICE_RELOAD_REQUIRED — reported only; no execution was requested",
      observed_at,
    };
  }

  // EXECUTION BOUNDARY. This is the only line in this capability that causes a
  // process to change, and it is a call into runtime-control, not an action.
  // ── ผู้ขอของเส้นทางนี้ (2026-08-29) ──
  // AUTOMATIC: ผู้ขอคือ capability นี้เอง มันตัดสินใจเองจาก commit ที่ผ่าน
  // การยืนยันแล้ว โดยไม่มีคนสั่ง — เป็น SERVICE ที่มีตัวตนเสถียรตามแบบแผน
  // `identity-<capability>` ที่ใช้อยู่แล้วในระบบ
  // OWNER: `trigger` เป็นเพียงโหมดที่ผู้เรียกประกาศเอง ไม่ใช่ตัวตนที่ผ่านการ
  // ยืนยัน `ReloadRequest` ไม่มี identity_id ใด ๆ จึง **ไม่ใส่ผู้ขอ** แทนที่จะ
  // แต่ง "owner" ขึ้นมา — ตัวตนที่แต่งขึ้นอ่านย้อนหลังแล้วแยกไม่ออกจากของจริง
  const reloadRequest = trigger === "AUTOMATIC"
    ? {
        requested_by: SERVICE_RELOAD_REQUESTER_IDENTITY,
        // รูปแบบ correlation_id เดียวกับที่ capability นี้ใช้อยู่แล้วที่ด้านบนของไฟล์
        lineage: { correlation_id: `reload-${revision.revision_digest.slice(0, 12)}` },
      }
    : undefined;
  const operation = await runOperation(impact.service_id, "restart", reloadRequest);

  const healthStatus = operation.health_after?.http_status ?? null;
  const healthy = operation.health_after?.healthy ?? false;

  const pidAfter = operation.pid_after ?? null;
  const startedAt = pidAfter !== null ? processStartedAt(pidAfter) : null;
  const loadedCurrent = startedAt !== null && revision.newest_mtime !== "" && startedAt > revision.newest_mtime;
  const proof: RevisionProof = {
    pid_before: operation.pid_before ?? null,
    pid_after: pidAfter,
    pid_changed: (operation.pid_before ?? null) !== pidAfter,
    process_started_at: startedAt,
    loaded_current_revision: loadedCurrent,
    revision_digest: revision.revision_digest,
    evidence: [
      `launchd reported pid ${String(operation.pid_before)} before and ${String(pidAfter)} after`,
      startedAt
        ? `ps reports pid ${pidAfter} started at ${startedAt}; the newest source mtime in ${impact.source_root} is ${revision.newest_mtime}`
        : `ps could not report a start time for pid ${String(pidAfter)}`,
      loadedCurrent
        ? "the process started strictly after the newest source file was written, so it necessarily read the current bytes at import time"
        : "the process did NOT start after the newest source write — it may still hold an older revision in memory",
    ],
  };

  return {
    // The service is RELOADED when the process was really replaced, is serving,
    // and is proven to hold the current revision. runtime-control's own
    // `result` can read FAILED purely because its bounded settle wait expired
    // before a slow cold start finished — that is a timing verdict, not a
    // reload verdict, so it is carried in `operation` and explained rather than
    // copied.
    decision: operation.result === "SUCCESS" && proof.pid_changed && proof.loaded_current_revision ? "RELOADED" : "RELOAD_FAILED",
    impact, revision, gate, operation, proof,
    health_after: { http_status: healthStatus, healthy, source: "RUNTIME_CONTROL_EVIDENCE", waited_ms: operation.readiness_wait_ms },
    reason: operation.result !== "SUCCESS"
      ? `runtime-control reported ${operation.result}: ${operation.failure_reason ?? "no reason given"}`
      : !proof.pid_changed
        ? `launchd did not replace the process (pid stayed ${String(proof.pid_after)})`
        : !proof.loaded_current_revision
          ? "the process is serving but cannot be proven to hold the current revision"
          : `restarted and proven to be running the current revision; it answered health ${operation.readiness_wait_ms}ms after launchd reported the new pid`,
    observed_at,
  };
}

/**
 * READ-ONLY. The whole of what the observation layer is allowed to know: does a
 * running service predate its own source? No gate is run, nothing is executed,
 * and nothing here can be turned into an execution by a caller — a report is
 * the only thing that comes back. Acting on it means calling `requestReload`
 * with `execute: true`, which is a decision that belongs to an owner-triggered
 * path, not to an observer.
 */
export function reloadRequiredFor(serviceId: ServiceId): {
  service_id: ServiceId;
  status: "SERVICE_RELOAD_REQUIRED" | "CURRENT" | "NOT_RUNNING" | "UNRESOLVED";
  pid: number | null;
  process_started_at: string | null;
  newest_source_mtime: string | null;
  revision_digest: string | null;
  evidence: readonly string[];
} {
  const { root, evidence } = serviceSourceRoot(serviceId);
  if (!root) {
    return { service_id: serviceId, status: "UNRESOLVED", pid: null, process_started_at: null, newest_source_mtime: null, revision_digest: null, evidence };
  }
  const rev = computeSourceRevision(root);
  let pid: number | null = null;
  try {
    const row = execFileSync("/bin/sh", ["-c", `launchctl list | grep ${SERVICES[serviceId].launchd_label} || true`], { encoding: "utf8" }).trim();
    const first = row.split(/\s+/)[0];
    if (/^\d+$/.test(first)) pid = Number(first);
  } catch { pid = null; }
  if (pid === null) {
    return { service_id: serviceId, status: "NOT_RUNNING", pid: null, process_started_at: null, newest_source_mtime: rev.newest_mtime, revision_digest: rev.revision_digest, evidence: [...evidence, "launchctl lists no running pid for this label"] };
  }
  const started = processStartedAt(pid);
  const stale = started !== null && rev.newest_mtime !== "" && started < rev.newest_mtime;
  return {
    service_id: serviceId,
    status: started === null ? "UNRESOLVED" : stale ? "SERVICE_RELOAD_REQUIRED" : "CURRENT",
    pid,
    process_started_at: started,
    newest_source_mtime: rev.newest_mtime,
    revision_digest: rev.revision_digest,
    evidence: [...evidence, `pid ${pid} started ${started}; newest source mtime ${rev.newest_mtime}`],
  };
}

/**
 * POINT 4 — LIFECYCLE COMPLETION -> AUTOMATIC RELOAD.
 *
 * The one entry point allowed to reload without an owner present, and the only
 * caller that can ever reach COMMIT_VERIFIED authority. Given a commit that
 * this repository's own verification has already recorded as VERIFIED, it
 * resolves which files that commit touched, resolves which registered services
 * own them, and reloads each one through runtime-control.
 *
 * WHY THIS IS SAFE TO RUN UNATTENDED, stated as conditions rather than as
 * confidence:
 *   - the changed paths come from `git diff-tree` on the commit itself, not
 *     from a caller's list;
 *   - the gate re-reads the verification record for HEAD rather than trusting
 *     the argument, and refuses if the tree has drifted off that commit;
 *   - a dirty working tree downgrades the authority to WORKING_TREE_VERIFIED,
 *     which `requestReload` then refuses for an AUTOMATIC trigger. A machine
 *     mid-edit does not get reloaded behind the owner's back.
 *
 * It reloads only services that are ACTUALLY STALE. A service whose process
 * already started after its newest source write is left alone — restarting a
 * current process is a real interruption bought for nothing.
 */
export async function reloadForVerifiedCommit(commitSha: string, repoRoot: string): Promise<{
  commit_sha: string;
  verification_id: string | null;
  changed_paths: readonly string[];
  services_impacted: readonly ServiceId[];
  services_already_current: readonly ServiceId[];
  outcomes: readonly ReloadOutcome[];
  reason: string;
}> {
  const verification = findVerificationForCommit(commitSha, repoRoot);
  if (verification === null || verification.status !== "VERIFIED") {
    return {
      commit_sha: commitSha,
      verification_id: verification?.verification_id ?? null,
      changed_paths: [], services_impacted: [], services_already_current: [], outcomes: [],
      reason: verification === null
        ? `no verification record exists for ${commitSha.slice(0, 12)} — a lifecycle that has not completed does not trigger a reload`
        : `verification ${verification.verification_id} for ${commitSha.slice(0, 12)} is ${verification.status}, not VERIFIED`,
    };
  }

  let changed: string[];
  try {
    changed = execFileSync("/usr/bin/git", ["diff-tree", "--no-commit-id", "--name-only", "-r", commitSha], { cwd: repoRoot, encoding: "utf8" })
      .split("\n").map((l) => l.trim()).filter(Boolean).map((rel) => join(repoRoot, rel));
  } catch {
    return {
      commit_sha: commitSha, verification_id: verification.verification_id,
      changed_paths: [], services_impacted: [], services_already_current: [], outcomes: [],
      reason: `git could not list the files changed by ${commitSha.slice(0, 12)}`,
    };
  }

  // One commit can touch several services; each is resolved and reloaded on its
  // own evidence, and one service's failure does not suppress another's reload.
  const impacted = new Set<ServiceId>();
  for (const serviceId of Object.keys(SERVICES) as ServiceId[]) {
    const { root } = serviceSourceRoot(serviceId);
    if (root && changed.some((p) => p === root || p.startsWith(`${root}/`))) impacted.add(serviceId);
  }

  const outcomes: ReloadOutcome[] = [];
  const alreadyCurrent: ServiceId[] = [];
  for (const serviceId of impacted) {
    if (reloadRequiredFor(serviceId).status !== "SERVICE_RELOAD_REQUIRED") {
      alreadyCurrent.push(serviceId);
      continue;
    }
    const { root } = serviceSourceRoot(serviceId);
    outcomes.push(await requestReload({
      changed_paths: changed.filter((p) => root !== null && (p === root || p.startsWith(`${root}/`))),
      repo_root: repoRoot,
      trigger: "AUTOMATIC",
      execute: true,
    }));
  }

  return {
    commit_sha: commitSha,
    verification_id: verification.verification_id,
    changed_paths: changed,
    services_impacted: [...impacted],
    services_already_current: alreadyCurrent,
    outcomes,
    reason: impacted.size === 0
      ? `commit ${commitSha.slice(0, 12)} is verified but touches no registered service's source root`
      : `commit ${commitSha.slice(0, 12)} verified by ${verification.verification_id}; ${impacted.size} service(s) impacted, ${alreadyCurrent.length} already current`,
  };
}
