/**
 * POST /api/admin/ide/governance/verify — real Live Governance
 * Verification (owner, 2026-08-06, Software Factory Step 4.5). Walks
 * every real rule this Governance Runtime tracks, force-recomputes its
 * status from disk (never a stale cache), and emits one real
 * RULE_VERIFIED/RULE_FAILED/RULE_DECLARED/RULE_UNKNOWN/RULE_GHOST/
 * RULE_DEPRECATED event per rule. Read-only — never writes to a source
 * file, never modifies the Constitution, never auto-fixes anything.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { runGovernanceVerification } from "../../_lib/governanceRuntime";
import { createGovernanceResultArtifact } from "../../_lib/artifactRuntime";

export async function POST() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const result = runGovernanceVerification(auth.email);

  // Real Artifact Pipeline (Step 5) — every real Live Governance
  // Verification becomes a real, immutable GOVERNANCE_RESULT artifact.
  let artifactId: string | null = null;
  try {
    artifactId = createGovernanceResultArtifact(auth.email, auth.id, result.events).artifactId;
  } catch { /* artifact wrapping never blocks the real verification result */ }

  return NextResponse.json({ ok: true, ...result, artifactId });
}
