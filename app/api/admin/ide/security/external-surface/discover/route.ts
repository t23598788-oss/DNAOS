/**
 * POST /api/admin/ide/security/external-surface/discover — real,
 * gated External Attack Surface Discovery run (owner, 2026-08-08,
 * Software Factory Step 13.7). DISABLED_ROLE_TIER. Requires a real,
 * verified Domain Asset AND a real, ALLOWED Security Execution Gate
 * decision — the full real safety checklist, every time.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { DISABLED_ROLE_TIER } from "@/core/auth/session";
import { runExternalDiscovery, ExternalAttackSurfaceError } from "../../../_lib/externalAttackSurfaceRuntime";
import { DomainAssetError } from "../../../_lib/domainAssetRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "DOMAIN_NOT_VERIFIED" || code === "GATE_BLOCKED") return 409;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(DISABLED_ROLE_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: Partial<{ domainAssetId: string; ownerIntent: string; authorization: string; riskAssessment: string; rollback: string; stopCondition: string; legalNotice: string }>;
  try { body = await req.json(); } catch { body = {}; }
  const domainAssetId = body.domainAssetId ?? "";
  if (!domainAssetId) return errorResponse("INVALID_REQUEST", "real domainAssetId is required", 400);

  try {
    const report = await runExternalDiscovery(
      domainAssetId, auth.id, auth.email,
      body.ownerIntent ?? "", body.authorization ?? "", body.riskAssessment ?? "",
      body.rollback ?? "", body.stopCondition ?? "", body.legalNotice ?? "",
    );
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    const code = e instanceof ExternalAttackSurfaceError ? e.code : e instanceof DomainAssetError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
