import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import {
  ACTIVE_BUSINESS_ORG_COOKIE,
  activeOrganizationClaim,
  listBusinessOrganizations,
  resolveBusinessOrganizationScope,
} from "@/app/api/business/_lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const protocol = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")).split(",")[0].trim();
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host.toLowerCase() === host.toLowerCase() && parsed.protocol === `${protocol}:`;
  } catch { return false; }
}

function isHttpsRequest(req: NextRequest): boolean {
  return (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")).split(",")[0].trim() === "https";
}

export async function GET(req: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const { organizations, reason } = await listBusinessOrganizations(user);
  const claim = activeOrganizationClaim(req);
  let activeOrganizationId: string | null = null;
  if (claim) {
    const checked = await resolveBusinessOrganizationScope(user, claim);
    if (checked.allowed) activeOrganizationId = claim;
  }

  return NextResponse.json({
    ok: true,
    organizations,
    active_organization_id: activeOrganizationId,
    selection_required: organizations.length > 0 && activeOrganizationId === null,
    business_scope_reason: reason,
  }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!isSameOrigin(req)) return NextResponse.json({ ok: false, code: "ORIGIN_REJECTED" }, { status: 403, headers: NO_STORE });

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > 2048) return NextResponse.json({ ok: false, code: "REQUEST_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  const body = await req.json().catch(() => null) as { organization_id?: unknown } | null;
  const organizationId = typeof body?.organization_id === "string" ? body.organization_id.trim() : "";
  if (!organizationId || organizationId.length > 80) {
    return NextResponse.json({ ok: false, code: "ORGANIZATION_REQUIRED" }, { status: 400, headers: NO_STORE });
  }

  const checked = await resolveBusinessOrganizationScope(user, organizationId);
  if (!checked.allowed) return NextResponse.json({ ok: false, code: checked.reason }, { status: 403, headers: NO_STORE });

  const response = NextResponse.json({ ok: true, active_organization_id: organizationId }, { headers: NO_STORE });
  response.cookies.set(ACTIVE_BUSINESS_ORG_COOKIE, organizationId, {
    httpOnly: true,
    secure: isHttpsRequest(req),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

export async function DELETE(req: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!isSameOrigin(req)) return NextResponse.json({ ok: false, code: "ORIGIN_REJECTED" }, { status: 403, headers: NO_STORE });
  const response = NextResponse.json({ ok: true, active_organization_id: null }, { headers: NO_STORE });
  response.cookies.set(ACTIVE_BUSINESS_ORG_COOKIE, "", {
    httpOnly: true,
    secure: isHttpsRequest(req),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
