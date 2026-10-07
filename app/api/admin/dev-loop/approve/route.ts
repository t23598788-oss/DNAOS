/**
 * POST /api/admin/dev-loop/approve — Owner approves or rejects a PROPOSED
 * registry patch (dev_loop_registry_proposals). This endpoint only ever
 * flips `status` — it never writes registry/module-registry.json itself;
 * applying an approved patch stays scripts/sync-registry.ts's job, run by
 * the Owner (or a follow-up script reading approved rows) as a separate,
 * deliberate step. Same auth convention as every other /api/admin/* write.
 *
 * Owner verification (owner directive 2026-09-22): approving a registry patch is
 * a privileged mutation, so an ADMIN_TIER session is permission only — never
 * owner proof. The approval must carry an artifact verified by
 * -DNA-OS-INFRASTRUCTURE-'s owner-authentication through the SAME shared client
 * the gateway proposal decision uses (core/owner-verification-client.ts), and the
 * identity recorded as decider is the one the infrastructure verified. Rejections
 * are deliberately NOT gated (rejecting grants no authority).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { OWNER_VERIFICATION_PATH, verifyOwnerArtifact } from "@/core/owner-verification-client";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const { id, decision } = body ?? {};
  if (!id || (decision !== "approved" && decision !== "rejected")) {
    return NextResponse.json({ error: "ต้องระบุ id และ decision ('approved' หรือ 'rejected')" }, { status: 400 });
  }

  // ── Owner-verification gate (approvals only) ──────────────────────────────
  // Nothing is written until the infrastructure has verified the owner: a failed
  // or missing verdict leaves the proposal pending.
  let decidedBy: string = auth.email;
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
    decidedBy = verdict.owner_identity;
    ownerVerificationEvidence = {
      owner_session_id: verdict.owner_session_id,
      owner_identity: verdict.owner_identity,
      expires_at: verdict.expires_at,
      authenticated_via: verdict.authenticated_via,
      evidence_reference: verdict.evidence_reference,
      verified_by: verdict.verified_by,
    };
  }

  const { data, error } = await supabaseAdmin()
    .from("dev_loop_registry_proposals")
    .update({
      status: decision,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      owner_verification: ownerVerificationEvidence,
    })
    .eq("id", id)
    .eq("status", "pending") // never re-decide an already-decided proposal
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "proposal not found or already decided" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, proposal: data });
}
