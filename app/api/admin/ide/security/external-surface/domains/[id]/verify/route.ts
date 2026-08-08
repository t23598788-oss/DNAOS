/**
 * POST /api/admin/ide/security/external-surface/domains/[id]/verify —
 * real, separate, explicit Owner verification of a Domain Asset (owner,
 * 2026-08-08, Software Factory Step 13.7). SUPER_ADMIN_ONLY. Only a
 * verified Domain Asset may ever be scanned.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { SUPER_ADMIN_ONLY } from "@/core/auth/session";
import { verifyDomainAsset, DomainAssetError } from "../../../../../_lib/domainAssetRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "ASSET_ALREADY_VERIFIED" || code === "INVALID_REQUEST") return 409;
  return 500;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(SUPER_ADMIN_ONLY);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  let body: { verificationMethod?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const verificationMethod = typeof body.verificationMethod === "string" ? body.verificationMethod : "";
  try {
    const asset = verifyDomainAsset(id, auth.id, verificationMethod);
    return NextResponse.json({ ok: true, asset });
  } catch (e) {
    const code = e instanceof DomainAssetError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
