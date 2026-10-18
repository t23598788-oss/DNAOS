/**
 * WORKSPACE ORG CONTEXT API — ผู้ใช้เลือกองค์กรที่ตัวเองทำงานด้วยแบบชัดเจน
 * (MULTITENANT phase · GET = รายการ membership · POST = set/clear cookie)
 *
 * - GET: session จริง → memberships จาก org_members (ผ่าน tenantAuthority)
 * - POST: { organizationId } — membership ต้องมีจริง, แล้ว set cookie `dna_org_context`
 *   (validate ด้วย decideWorkspaceOrg จุดเดียว) · ส่ง null = clear (ไม่มี tenant เริ่มต้น)
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthedUser } from "@/core/auth/session";
import { ORG_CONTEXT_COOKIE, decideWorkspaceOrg, sanitizeOrgCookie } from "@/core/auth/orgContext";
import { supabaseAdmin } from "@/services/supabase/queries";
import { fetchOrgMemberships, fetchOrganizationName } from "@/services/supabase/tenantAuthority";

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const db = supabaseAdmin();
  const memberships = await fetchOrgMemberships(db, user.id);
  const names = await Promise.all(memberships.map((m) => fetchOrganizationName(db, m.organizationId)));
  const jar = await cookies();
  return NextResponse.json({
    // ไม่เปิดเผยข้อมูลองค์กรอื่น — คืนเฉพาะ id/role/ชื่อ ของ membership ตัวเอง
    memberships: memberships.map((m, i) => ({ organizationId: m.organizationId, role: m.role, name: names[i] ?? m.organizationId })),
    selected: sanitizeOrgCookie(jar.get(ORG_CONTEXT_COOKIE)?.value ?? null),
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const organizationId = sanitizeOrgCookie(typeof body?.organizationId === "string" ? body.organizationId : null);
  const memberships = await fetchOrgMemberships(supabaseAdmin(), user.id);
  const decision = decideWorkspaceOrg(user, memberships, organizationId);
  if (!decision.ok) {
    return NextResponse.json({ error: decision.code }, { status: decision.code === "ORG_REQUIRED" ? 400 : 403 });
  }
  const res = NextResponse.json({ ok: true, organizationId: decision.organizationId });
  res.cookies.set(ORG_CONTEXT_COOKIE, decision.organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
}
