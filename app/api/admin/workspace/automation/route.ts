/**
 * GET  /api/admin/workspace/automation — list runnable commands (whitelist below)
 * POST /api/admin/workspace/automation { command: "<key>" } — runs it for real
 *
 * Automation tool's real trigger (Integrated Development Workspace shell,
 * owner, 2026-08-05). Whitelist + exec logic live in
 * engines/integration-gateway/automationCommands.ts (owner, 2026-08-05) —
 * shared with the Proposal Channel's approve step
 * (app/api/gateway/proposals/[id]/decide/route.ts) so a direct run here and
 * an approved proposal there always run the exact same command the exact
 * same way, never two copies.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { AUTOMATION_COMMANDS, AUTOMATION_NOT_IMPLEMENTED, runAutomationCommand } from "@/engines/integration-gateway/automationCommands";

const ROOT = process.cwd();

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    commands: Object.keys(AUTOMATION_COMMANDS).map((key) => ({ key, command: AUTOMATION_COMMANDS[key], status: "READY" })),
    not_implemented: Object.entries(AUTOMATION_NOT_IMPLEMENTED).map(([key, reason]) => ({ key, status: "NOT_IMPLEMENTED", reason })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const key = body?.command;

  if (key && key in AUTOMATION_NOT_IMPLEMENTED) {
    return NextResponse.json({ status: "NOT_IMPLEMENTED", reason: AUTOMATION_NOT_IMPLEMENTED[key] }, { status: 501 });
  }
  if (!key || !(key in AUTOMATION_COMMANDS)) {
    return NextResponse.json({ error: `unknown command — must be one of: ${Object.keys(AUTOMATION_COMMANDS).join(", ")}` }, { status: 400 });
  }

  return NextResponse.json(runAutomationCommand(key, ROOT));
}
