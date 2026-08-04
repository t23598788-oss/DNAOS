/**
 * GET /api/admin/workspace/status — Status Bar + Problems panel's single
 * real data source (Integrated Development Workspace shell, owner,
 * 2026-08-05). Every field cites its real source; nothing computed here
 * that isn't already written by an existing script/table:
 *   - branch: `git rev-parse --abbrev-ref HEAD` (real, read-only)
 *   - build/type_check/deployment: DNA_OS_HEALTH.json (scripts/governance.sh)
 *   - modules: registry/architecture-book.json summary
 *   - database: latest integration_gateway_events database.health.observed
 *   - runtime_environment: process.env.VERCEL_ENV ?? NODE_ENV (real env, not guessed)
 *   - problems: DNA_OS_HEALTH.json failed checks + latest-per-path
 *     dev_loop_check_results with result='fail' (same query deploy-gate.ts
 *     already runs — see scripts/deploy-gate.ts's checkDevLoopGate)
 */
import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";

const ROOT = process.cwd();

function readJSON<T>(relPath: string): T | null {
  const p = join(ROOT, relPath);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function gitBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const health = readJSON<any>("DNA_OS_HEALTH.json");
  const archBook = readJSON<any>("registry/architecture-book.json");
  const db = supabaseAdmin();

  const [{ data: healthEvents }, { data: checkResults }] = await Promise.all([
    db
      .from("integration_gateway_events")
      .select("evidence, occurred_at")
      .eq("provider", "supabase")
      .eq("capability", "database.health.observed")
      .order("occurred_at", { ascending: false })
      .limit(1),
    db.from("dev_loop_check_results").select("path, result, reason, checked_at").order("checked_at", { ascending: false }).limit(200),
  ]);

  const latestPerPath = new Map<string, { result: string; reason: string; path: string }>();
  for (const row of checkResults ?? []) {
    if (!latestPerPath.has(row.path)) latestPerPath.set(row.path, row);
  }
  const devLoopFails = [...latestPerPath.values()].filter((r) => r.result === "fail");
  const devLoopWarnings = [...latestPerPath.values()].filter((r) => r.result === "warning");

  const failedChecks: string[] = health ? Object.entries(health.checks ?? {}).filter(([, v]) => v === 0).map(([k]) => k) : [];

  const problems = [
    ...failedChecks.map((k) => ({ source: "governance" as const, severity: "error" as const, message: `${k} failed` })),
    ...devLoopFails.map((p) => ({ source: "dev_loop" as const, severity: "error" as const, message: `${p.path}: ${p.reason}` })),
    ...devLoopWarnings.map((p) => ({ source: "dev_loop" as const, severity: "warning" as const, message: `${p.path}: ${p.reason}` })),
  ];

  return NextResponse.json({
    branch: gitBranch(),
    build: {
      status: archBook?.summary?.broken === 0 ? "passing" : "failing",
      broken_modules: archBook?.summary?.broken ?? null,
    },
    type_check: health ? (health.checks?.type_check === 1 ? "passing" : "failing") : "UNKNOWN",
    modules: archBook?.summary ?? null,
    database: healthEvents?.[0]
      ? { ...(healthEvents[0].evidence as object), checked_at: healthEvents[0].occurred_at }
      : { status: "UNKNOWN", reason: "no database.health.observed event yet" },
    runtime_environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "UNKNOWN",
    deployment: archBook?.summary?.broken === 0 ? "ready" : "blocked",
    governance_score: health?.governance_score ?? null,
    problems,
    error_count: problems.filter((p) => p.severity === "error").length,
    warning_count: problems.filter((p) => p.severity === "warning").length,
  });
}
