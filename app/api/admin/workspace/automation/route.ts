/**
 * GET  /api/admin/workspace/automation — list runnable commands (whitelist below)
 * POST /api/admin/workspace/automation { command: "<key>" } — runs it for real
 *
 * Automation tool's real trigger (Integrated Development Workspace shell,
 * owner, 2026-08-05). Every command below is copied verbatim from
 * package.json's own scripts — never string-built from request input, so
 * there is no command-injection surface (the `command` field only selects a
 * key into COMMANDS, it is never concatenated into a shell string).
 *
 * "build" (next build) is intentionally NOT in this whitelist — a real
 * Next.js production build routinely runs well past typical serverless
 * function time limits, so triggering it synchronously from this API would
 * either time out or block the request; the real trigger for a build stays
 * the existing path (git push -> Vercel, gated by scripts/deploy-gate.ts's
 * prebuild hook). Listed here as NOT_IMPLEMENTED with that reason — not
 * silently omitted.
 */
import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";

const ROOT = process.cwd();

const COMMANDS: Record<string, string> = {
  "type-check": "npx tsc --noEmit",
  sync: "npx tsx scripts/sync-registry.ts && npx tsx scripts/build-arch-book.ts && npx tsx scripts/build-system-control-graph.ts",
  "deploy-gate": "npx tsx scripts/deploy-gate.ts",
  "architecture-check": "npx tsx scripts/check-system-control-graph.ts",
  guard: "bash scripts/governance.sh",
  "dead-code": "npx knip --no-progress",
  duplicates: "npx jscpd",
  test: "npx tsx local-runtime/dependency-discovery-acceptance-test.ts && npx tsx local-runtime/workspace-acceptance-test.ts && npx tsx local-runtime/architecture-drift-acceptance-test.ts && npx tsx local-runtime/runtime-registration-test.ts",
};

const NOT_IMPLEMENTED: Record<string, string> = {
  build: "next build routinely exceeds serverless function time limits — trigger via git push to Vercel instead (scripts/deploy-gate.ts runs as the prebuild hook there)",
};

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    commands: Object.keys(COMMANDS).map((key) => ({ key, command: COMMANDS[key], status: "READY" })),
    not_implemented: Object.entries(NOT_IMPLEMENTED).map(([key, reason]) => ({ key, status: "NOT_IMPLEMENTED", reason })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const key = body?.command;

  if (key && key in NOT_IMPLEMENTED) {
    return NextResponse.json({ status: "NOT_IMPLEMENTED", reason: NOT_IMPLEMENTED[key] }, { status: 501 });
  }
  if (!key || !(key in COMMANDS)) {
    return NextResponse.json({ error: `unknown command — must be one of: ${Object.keys(COMMANDS).join(", ")}` }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const output = execSync(COMMANDS[key], { cwd: ROOT, encoding: "utf8", timeout: 55_000, maxBuffer: 10 * 1024 * 1024 });
    return NextResponse.json({ command: key, exit_code: 0, output, duration_ms: Date.now() - startedAt });
  } catch (e: any) {
    return NextResponse.json(
      {
        command: key,
        exit_code: typeof e.status === "number" ? e.status : 1,
        output: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || e.message,
        duration_ms: Date.now() - startedAt,
      },
      { status: 200 } // real command ran and produced a real failing result — not an API error
    );
  }
}
