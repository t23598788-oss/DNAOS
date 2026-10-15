/**
 * MEMBER LIFECYCLE (/api/public/company) — owner directive 2026-10-15 (WORKSTREAM 3)
 *
 * กระบวนการครบบน Authentication เดิมทั้งหมด:
 *   REGISTER (register route เดิม) → IDENTITY VERIFICATION (Supabase magic-link เดิม
 *   — user เชือกผูกตัวตนจริง) → PROFILE (profiles เดิม) → COMPANY RELATIONSHIP
 *   (company_members + invite code ที่เจ้าของจริงออก — ห้ามผูกด้วย email อย่างเดียว)
 *   → PERMISSION (member_role owner/manager/member แบบธุรกิจ — ห้ามบัญชีสาธารณะ
 *   ได้สิทธิ์ admin อย่างเคร่งครัด: profiles.role ไม่ถูกเขียนโดยเส้นนี้เด็ดขาด)
 *   → RESOURCE OWNERSHIP (pit_profiles.user_id / equipment_assets.owner_user_id)
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ANY_AUTHENTICATED } from "@/core/auth/session";
import {
  acceptCompanyInvite, createCompanyInvite, getMyLifecycle, listMyMemberships,
} from "@/engines/public-registry/service";

export async function GET(req: Request) {
  const auth = await requireAuth(ANY_AUTHENTICATED);
  if (auth instanceof NextResponse) return auth;
  const action = new URL(req.url).searchParams.get("action") ?? "memberships";
  if (action === "lifecycle") return NextResponse.json(await getMyLifecycle(auth.id));
  return NextResponse.json(await listMyMemberships(auth.id));
}

export async function POST(req: Request) {
  const auth = await requireAuth(ANY_AUTHENTICATED);
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => null)) as {
    action?: string; company_id?: string; role_to_grant?: string; invite_code?: string; expires_hours?: number;
  } | null;
  if (body?.action === "create_invite") {
    if (!body.company_id) return NextResponse.json({ ok: false, error: "ต้องระบุ company_id" }, { status: 400 });
    const role = body.role_to_grant === "owner" || body.role_to_grant === "manager" ? body.role_to_grant : "member";
    const r = await createCompanyInvite(auth.id, { company_id: body.company_id, role_to_grant: role, expires_hours: body.expires_hours });
    return NextResponse.json(r, { status: r.ok ? 200 : r.error?.startsWith("FORBIDDEN") ? 403 : 400 });
  }
  if (body?.action === "accept_invite") {
    if (!body.invite_code) return NextResponse.json({ ok: false, error: "ต้องระบุ invite_code" }, { status: 400 });
    const r = await acceptCompanyInvite(auth.id, body.invite_code);
    return NextResponse.json(r, { status: r.ok ? 200 : 403 });
  }
  return NextResponse.json({ ok: false, error: "action ต้องเป็น create_invite หรือ accept_invite" }, { status: 400 });
}
