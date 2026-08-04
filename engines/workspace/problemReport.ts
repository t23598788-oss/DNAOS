/**
 * Dev Loop problem-report boundary.
 * Reporting only: no repair, approval, registry write, deploy, or AI call.
 *
 * Rule 71 fix (owner, 2026-08-05): this file used to import
 * @supabase/supabase-js directly and self-construct a client from env vars
 * when the caller didn't pass one — a real engines/ -> Supabase-client
 * violation (caught by scripts/pre-commit-check.sh Guard 3). Every caller
 * must now inject an already-authenticated client via opts.db, same
 * dependency-injection pattern already used across engines/workspace/*
 * (fileExistenceRegistry.ts, snapshotStore.ts, lockManager.ts, etc. — see
 * their `import type { SupabaseClient }`). Real callers updated to inject:
 * scripts/deploy-gate.ts, app/api/internal/ai/gateway/route.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dispatchEvent } from "@/core/runtime/engine";

const ROOT = join(__dirname, "../..");
export const DEFAULT_PROBLEM_REPORT_PATH = join(ROOT, "local-runtime", "dev-loop-problem-report.json");

type HealthDb = {
  from(table: string): {
    upsert(row: Record<string, unknown>, options?: { onConflict?: string }): PromiseLike<{ error: unknown | null }>;
  };
};
export type DevLoopProblemSeverity = "warning" | "critical";

export interface DevLoopProblemReport {
  report_id: string;
  status: "open" | "resolved";
  source: string;
  occurred_at: string;
  severity: DevLoopProblemSeverity;
  check_name: string;
  cause: string;
  evidence_refs: string[];
  affected_files: string[];
  recommended_owner_action: string;
  owner_alert: {
    channel: "dna_os_governance_ui";
    spoken_summary: string;
    voice_session_note: string;
  };
}

export function buildDevLoopProblemReport(input: {
  source: string;
  severity: DevLoopProblemSeverity;
  checkName: string;
  cause: string;
  evidenceRefs?: string[];
  affectedFiles?: string[];
  recommendedOwnerAction: string;
  now?: string;
}): DevLoopProblemReport {
  const occurredAt = input.now ?? new Date().toISOString();
  const fingerprint = [input.source, input.checkName, input.cause, ...(input.evidenceRefs ?? [])].join("|");
  const reportId = `dev-loop-${Buffer.from(fingerprint).toString("base64url").slice(0, 32)}`;
  return {
    report_id: reportId,
    status: "open",
    source: input.source,
    occurred_at: occurredAt,
    severity: input.severity,
    check_name: input.checkName,
    cause: input.cause,
    evidence_refs: input.evidenceRefs ?? [],
    affected_files: input.affectedFiles ?? [],
    recommended_owner_action: input.recommendedOwnerAction,
    owner_alert: {
      channel: "dna_os_governance_ui",
      spoken_summary: `DNA OS ตรวจพบ ${input.checkName}: ${input.cause}`,
      voice_session_note: "แสดงข้อความนี้ในบทสนทนาที่กำลังเปิดอยู่ได้ แต่ background process ไม่สามารถเปิดหรือพูดเข้า voice session ที่ปิดไปแล้วได้",
    },
  };
}

export function shouldUpdateOpenReport(previous: DevLoopProblemReport | null, next: DevLoopProblemReport, windowMs = 10 * 60 * 1000): boolean {
  if (!previous || previous.report_id !== next.report_id) return true;
  return new Date(next.occurred_at).getTime() - new Date(previous.occurred_at).getTime() >= windowMs;
}

export function resolveDevLoopProblem(previous: DevLoopProblemReport, now = new Date().toISOString()): DevLoopProblemReport {
  return { ...previous, status: "resolved", occurred_at: now };
}

function readArtifact(path: string): DevLoopProblemReport | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as DevLoopProblemReport;
  } catch {
    return null;
  }
}

function writeArtifact(path: string, report: DevLoopProblemReport): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function resolveDb(db?: HealthDb): HealthDb | null {
  return db ?? null;
}

export async function persistDevLoopProblemReport(
  report: DevLoopProblemReport,
  opts: { db?: HealthDb; artifactPath?: string; dedupWindowMs?: number } = {},
): Promise<{ written: boolean; deduplicated: boolean; report: DevLoopProblemReport }> {
  const artifactPath = opts.artifactPath ?? DEFAULT_PROBLEM_REPORT_PATH;
  const previous = readArtifact(artifactPath);
  if (!shouldUpdateOpenReport(previous?.status === "open" ? previous : null, report, opts.dedupWindowMs)) {
    return { written: false, deduplicated: true, report: previous ?? report };
  }

  writeArtifact(artifactPath, report);
  const db = resolveDb(opts.db);
  if (db) {
    await db.from("system_health_status").upsert({
      service_key: "dna_os_dev_loop",
      check_kind: "dev_loop_gate",
      status: "degraded",
      consecutive_failures: 1,
      last_check_at: report.occurred_at,
      last_error: report.cause,
      last_alert_at: new Date().toISOString(),
      detail: report,
    }, { onConflict: "service_key" });
  }
  dispatchEvent("DEV_LOOP_PROBLEM_REPORTED", "engines/workspace/problemReport", {
    report_id: report.report_id,
    severity: report.severity,
    owner_alert: report.owner_alert,
    evidence_refs: report.evidence_refs,
  });
  return { written: true, deduplicated: false, report };
}

export async function resolvePersistedDevLoopProblem(
  opts: { db?: HealthDb; artifactPath?: string } = {},
): Promise<DevLoopProblemReport | null> {
  const artifactPath = opts.artifactPath ?? DEFAULT_PROBLEM_REPORT_PATH;
  const previous = readArtifact(artifactPath);
  if (!previous || previous.status === "resolved") return previous;
  const resolved = resolveDevLoopProblem(previous);
  writeArtifact(artifactPath, resolved);
  const db = resolveDb(opts.db);
  if (db) {
    await db.from("system_health_status").upsert({
      service_key: "dna_os_dev_loop",
      check_kind: "dev_loop_gate",
      status: "healthy",
      consecutive_failures: 0,
      last_check_at: resolved.occurred_at,
      last_error: null,
      detail: resolved,
    }, { onConflict: "service_key" });
  }
  dispatchEvent("DEV_LOOP_PROBLEM_RESOLVED", "engines/workspace/problemReport", { report_id: resolved.report_id });
  return resolved;
}
