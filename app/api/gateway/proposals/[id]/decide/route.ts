/**
 * POST /api/gateway/proposals/[id]/decide { decision: "approved" | "rejected" }
 *
 * The ONLY path that turns a Proposal Channel row into a real run — and
 * only for the exact whitelisted command it named (owner, 2026-08-05).
 *
 * Owner verification (owner directive 2026-09-22, plan step 2): an approval is
 * no longer something an ADMIN_TIER session can assert by itself. It must carry
 * proof produced by -DNA-OS-INFRASTRUCTURE-'s owner-authentication — Touch ID /
 * device passcode via control/owner-authentication/native/owner-verify, a
 * single-use challenge, and (across a runtime boundary) the HMAC-signed artifact
 * its remote-verification-transport issues. This route verifies NOTHING itself:
 * it hands the artifact to the infrastructure's own transport route
 * (POST /owner/session/from-verification-artifact, core/owner-verification-client.ts)
 * and trusts only that verdict. No verdict = no decision: the proposal is left
 * exactly as it was (still pending) and no command runs. Rejections are
 * deliberately NOT gated — rejecting grants no authority.
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
import { recordApprovedProposal } from "@/engines/workspace/devLoopSession";
import { OWNER_VERIFICATION_PATH, verifyOwnerArtifact } from "@/core/owner-verification-client";

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

  // ── Owner-verification gate (approvals only) ────────────────────────────────
  // Nothing below this point writes anything until the infrastructure has
  // verified the owner. A failure here returns immediately, so the proposal keeps
  // its current status (pending) and no command is executed.
  let ownerIdentity: string | null = null;
  let ownerVerificationEvidence: Record<string, unknown> | null = null;
  if (decision === "approved") {
    const artifact = (body as { owner_verification_artifact?: unknown })?.owner_verification_artifact;
    if (artifact === undefined || artifact === null || typeof artifact !== "object") {
      return NextResponse.json(
        {
          ok: false,
          error: "OWNER_VERIFICATION_REQUIRED",
          transport: OWNER_VERIFICATION_PATH,
          detail:
            "an approval must carry owner_verification_artifact produced by the infrastructure owner-authentication (Touch ID / device passcode); an admin session by itself is not owner proof",
        },
        { status: 403 }
      );
    }
    const verdict = await verifyOwnerArtifact(artifact);
    if (!verdict.ok) {
      // The infrastructure is the only authority on whether an owner was
      // verified — report its own code/detail and leave the proposal untouched.
      return NextResponse.json(
        {
          ok: false,
          error: "OWNER_VERIFICATION_FAILED",
          code: verdict.code,
          detail: verdict.detail,
          http_status: verdict.http_status,
          proposal_status: "pending",
        },
        { status: verdict.http_status >= 400 && verdict.http_status < 600 ? verdict.http_status : 403 }
      );
    }
    ownerIdentity = verdict.owner_identity;
    ownerVerificationEvidence = {
      owner_session_id: verdict.owner_session_id,
      owner_identity: verdict.owner_identity,
      expires_at: verdict.expires_at,
      authenticated_via: verdict.authenticated_via,
      evidence_reference: verdict.evidence_reference,
      verified_by: verdict.verified_by,
    };
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

  // Every path below is an approval, so the identity recorded as the decider is
  // the one the infrastructure verified (never this caller's session email), and
  // the verification evidence travels with the decision.
  if (!ownerIdentity) {
    return NextResponse.json({ ok: false, error: "OWNER_VERIFICATION_REQUIRED" }, { status: 403 });
  }
  const decidedBy = ownerIdentity;

  // A Connect approval request — and its destructive cousins from the Provider
  // Credentials UI (connector.rotate.requested / connector.disconnect.requested)
  // — carry no command to run: approving them only records the Owner's
  // decision. The executing routes (POST /api/admin/connectors, the rotate and
  // DELETE connector routes) then check for exactly that approved row. Same
  // store, same route, no second approval mechanism. (BATCH 1 merge: main's
  // broader capability match + branch's owner-verification gate + P6 release.)
  if (proposal.capability === "connect.approval.requested" || proposal.capability.startsWith("connector.")) {
    const approvedOnly = await decideProposal(db, id, "approved", decidedBy, {
      approved_only: true,
      note: "connect approval — owner-verified; no command executed",
      owner_verification: ownerVerificationEvidence,
    });
    if (!approvedOnly.ok) return NextResponse.json({ error: approvedOnly.error }, { status: 500 });
    // Core chain wiring (P6): an owner-verified approval is released into the
    // ledger through the existing safe writer; a ledger failure is reported but
    // never re-runs the approval itself.
    const released = await recordApprovedProposal(db, {
      ownerIdentity: decidedBy,
      proposalId: id,
      command: null,
      files: [],
      summary: `owner-verified approval of ${proposal.capability} (${id}) — no command executed`,
    });
    return NextResponse.json({ ok: true, proposal: approvedOnly.proposal, release: released });
  }

  const command = (proposal.evidence as any)?.command;
  if (!command || !(command in AUTOMATION_COMMANDS)) {
    const result = await decideProposal(db, id, "approved", decidedBy, {
      exit_code: 1,
      output: `proposal's command '${command}' is no longer in the whitelist`,
      owner_verification: ownerVerificationEvidence,
    });
    return NextResponse.json({ error: "proposal command no longer whitelisted", proposal: result.proposal }, { status: 409 });
  }

  const runResult = runAutomationCommand(command, ROOT);
  const result = await decideProposal(db, id, "approved", decidedBy, {
    ...(runResult as unknown as Record<string, unknown>),
    owner_verification: ownerVerificationEvidence,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  // Core chain wiring (P6): the executed, owner-verified approval is recorded in
  // the release ledger through the existing safe writer (Rule 116 lock path).
  const released = await recordApprovedProposal(db, {
    ownerIdentity: decidedBy,
    proposalId: id,
    command,
    files: [`proposal:${id}`],
    summary: `owner-verified approval executed automation command '${command}' (${id})`,
  });

  return NextResponse.json({ ok: true, proposal: result.proposal, run_result: runResult, release: released });
}
