import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { selectRuntimeProvider } from "@/engines/integration-gateway/runtime-router";
import { activateStandbyConnect } from "@/engines/integration-gateway/connect-failover";
import { vercelRuntimeProvider } from "@/engines/integration-gateway/adapters/vercel";
import { railwayRuntimeProvider, railwayExternalConnect } from "@/engines/integration-gateway/adapters/railway";

const ROOT = process.cwd();

function getGitInfo() {
  try {
    const hash = execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: "pipe" })
      .toString().trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT, stdio: "pipe" })
      .toString().trim();
    const message = execSync("git log -1 --format=%s", { cwd: ROOT, stdio: "pipe" })
      .toString().trim();
    const author = execSync("git log -1 --format=%an", { cwd: ROOT, stdio: "pipe" })
      .toString().trim();
    const date = execSync("git log -1 --format=%ci", { cwd: ROOT, stdio: "pipe" })
      .toString().trim();
    return { hash, branch, message, author, date };
  } catch {
    return null;
  }
}

function getVercelInfo() {
  const p = join(ROOT, ".vercel/project.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

// GET /api/deploy — ข้อมูล deployment ปัจจุบัน
// Real, live security fix (TASK-001, DNA-000070): was unauthenticated, leaked
// real filesystem paths, git commit history, and Vercel project config.
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const git = getGitInfo();
  const vercel = getVercelInfo();
  const runtimeSelection = await selectRuntimeProvider(
    [vercelRuntimeProvider, railwayRuntimeProvider],
    {
      required_capabilities: ["runtime.render", "runtime.display"],
      max_latency_ms: Number(process.env.RUNTIME_PROVIDER_MAX_LATENCY_MS ?? 3000),
      allow_paid_providers: true,
    },
  );

  return NextResponse.json({
    git,
    vercel,
    runtime_selection: runtimeSelection,
    environment: process.env.NODE_ENV ?? "development",
    platform: process.platform,
    node_version: process.version,
    cwd: ROOT,
  });
}

// POST /api/deploy — owner-initiated failover (BATCH 2, adopted from
// runtime-connect-service-router): promote the standby external connect
// through the failover gate in engines/integration-gateway/connect-failover.
// Same route file, never a parallel deploy route. Fail-closed: the gate only
// succeeds when the standby is actually installed/healthy/at the requested
// release — otherwise the typed rejection code comes back unchanged with 503.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as { release_sha?: string };
  const releaseSha =
    body.release_sha ??
    process.env.RUNTIME_RELEASE_SHA ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    "";

  const result = await activateStandbyConnect(railwayExternalConnect, {
    release_sha: releaseSha,
    required_capabilities: ["runtime.render", "runtime.display"],
    max_latency_ms: Number(process.env.RUNTIME_PROVIDER_MAX_LATENCY_MS ?? 3000),
    allow_paid_providers: true,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
