/**
 * POST/GET /api/admin/ide/security/external-surface/domains — real,
 * Owner-only Domain Asset registration/listing (owner, 2026-08-08,
 * Software Factory Step 13.7). SUPER_ADMIN_ONLY. Registration alone
 * never authorizes a scan — a separate, real verify action is required.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { SUPER_ADMIN_ONLY } from "@/core/auth/session";
import { registerDomainAsset, listDomainAssets, DomainAssetError } from "../../../_lib/domainAssetRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "ASSET_ALREADY_EXISTS") return 409;
  if (code === "INVALID_REQUEST") return 400;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(SUPER_ADMIN_ONLY);
  if (auth instanceof NextResponse) return auth;
  let body: Partial<{ domain: string; organization: string; purpose: string; authorization: string; allowedRuntime: string[]; forbiddenRuntime: string[]; expectedSubdomains: string[] }>;
  try { body = await req.json(); } catch { body = {}; }
  try {
    const asset = registerDomainAsset({
      domain: body.domain ?? "", organization: body.organization ?? "", purpose: body.purpose ?? "", authorization: body.authorization ?? "",
      allowedRuntime: Array.isArray(body.allowedRuntime) ? body.allowedRuntime : ["ExternalAttackSurfaceRuntime"],
      forbiddenRuntime: Array.isArray(body.forbiddenRuntime) ? body.forbiddenRuntime : [],
      expectedSubdomains: Array.isArray(body.expectedSubdomains) ? body.expectedSubdomains : [],
    }, auth.id, auth.email);
    return NextResponse.json({ ok: true, asset });
  } catch (e) {
    const code = e instanceof DomainAssetError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}

export async function GET() {
  const auth = await requireAuth(SUPER_ADMIN_ONLY);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, assets: listDomainAssets(auth.id) });
}
