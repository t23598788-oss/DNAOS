/**
 * POST /api/gateway/proposals/[id]/decide { decision: "approved" | "rejected" }
 *
 * The ONLY path that turns a Proposal Channel row into a real run — and
 * only for the exact whitelisted command it named (owner, 2026-08-05).
 * Approval executes via engines/integration-gateway/automationCommands.ts's
 * runAutomationCommand() — the identical function/whitelist the direct-run
 * Automation tool uses, never a second exec path. Rejection just records
 * the decision. No Execution Channel exists — this route is deliberately
 * narrow (whitelisted Automation commands only), not a general "run
 * anything approved" surface.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { decideProposal, listPendingProposals } from "@/engines/integration-gateway/evidence/proposalStore";
import { AUTOMATION_COMMANDS, runAutomationCommand } from "@/engines/integration-gateway/automationCommands";

const ROOT = process.cwd();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const decision = body?.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
  }

  const db = supabaseAdmin();

  if (decision === "rejected") {
    const result = await decideProposal(db, id, "rejected", auth.email);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ ok: true, proposal: result.proposal });
  }

  // Look up the proposal's own evidence.command rather than trusting a
  // client-supplied command — the request body only ever carries the
  // decision, never what to run.
  const pending = await listPendingProposals(db);
  const proposal = pending.find((p) => p.id === id && p.status === "pending");
  if (!proposal) return NextResponse.json({ error: "proposal not found or already decided" }, { status: 404 });

  // A Connect approval request carries no command to run — approving it only
  // records the Owner's decision, and the Connect route (POST
  // /api/admin/connectors) then checks for exactly that approved row. Same
  // store, same route, no second approval mechanism.
  if (proposal.capability === "connect.approval.requested") {
    const approvedOnly = await decideProposal(db, id, "approved", auth.email, {
      approved_only: true,
      note: "connect approval — no command executed",
    });
    if (!approvedOnly.ok) return NextResponse.json({ error: approvedOnly.error }, { status: 500 });
    return NextResponse.json({ ok: true, proposal: approvedOnly.proposal });
  }

  const command = (proposal.evidence as any)?.command;
  if (!command || !(command in AUTOMATION_COMMANDS)) {
    const result = await decideProposal(db, id, "approved", auth.email, { exit_code: 1, output: `proposal's command '${command}' is no longer in the whitelist` });
    return NextResponse.json({ error: "proposal command no longer whitelisted", proposal: result.proposal }, { status: 409 });
  }

  const runResult = runAutomationCommand(command, ROOT);
  const result = await decideProposal(db, id, "approved", auth.email, runResult as any);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({ ok: true, proposal: result.proposal, run_result: runResult });
}
