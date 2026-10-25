/**
 * GET  /api/gateway/proposals — list recent Integration Gateway proposals
 * POST /api/gateway/proposals { provider, command } — propose a whitelisted
 *      Automation command run (channel='propose') — never runs it.
 *
 * Proposal Channel entry point (owner, 2026-08-05). Reuses
 * engines/integration-gateway/automationCommands.ts's whitelist — a
 * proposal for anything not in AUTOMATION_COMMANDS is rejected outright,
 * same validation the direct-run Automation tool already applies.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { publish } from "@/engines/integration-gateway/event-bus/bus";
import { listPendingProposals } from "@/engines/integration-gateway/evidence/proposalStore";
import { AUTOMATION_COMMANDS } from "@/engines/integration-gateway/automationCommands";
import type { GatewayEvent, GatewayProvider } from "@/engines/integration-gateway/contracts/event";

const ALLOWED_PROVIDERS: GatewayProvider[] = ["vscode", "chatgpt-mcp"];

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const proposals = await listPendingProposals(supabaseAdmin());
  return NextResponse.json({ proposals });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const provider: GatewayProvider = ALLOWED_PROVIDERS.includes(body?.provider) ? body.provider : "vscode";
  const command = body?.command;

  if (!command || !(command in AUTOMATION_COMMANDS)) {
    return NextResponse.json({ error: `command must be one of: ${Object.keys(AUTOMATION_COMMANDS).join(", ")}` }, { status: 400 });
  }

  const event: GatewayEvent = {
    event_id: `EVT-propose-automation-${command}-${Date.now()}`,
    provider,
    capability: "automation.command.proposed",
    channel: "propose",
    action: "propose",
    session_id: null,
    change_id: null,
    evidence: { command, real_command: AUTOMATION_COMMANDS[command], proposed_by: auth.email },
    requested_effect: `run automation command '${command}'`,
    requires_owner_approval: true,
    occurred_at: new Date().toISOString(),
  };

  const result = await publish(supabaseAdmin(), event);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 500 });

  return NextResponse.json({ ok: true, event_id: event.event_id });
}
