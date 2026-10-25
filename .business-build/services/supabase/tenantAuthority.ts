/**
 * TENANT AUTHORITY — DB-backed adapter (Phase · SOFTWARE PLATFORM — MULTI-TENANT COMPLETION)
 *
 * ต่อจาก core/auth/orgScope.ts (pure decision core) — ฐานนี้เป็น adapter ที่:
 *   1. อ่าน memberships / company→organization mapping จาก DB จริง (service client)
 *   2. รวมข้อตัดสิน "Organization + Membership + Permission + Resource Ownership"
 *      เป็นการเรียกจุดเดียว assertWriteScope() — canonical writers เรียกที่ต้นทางเดียว
 *
 * ห้ามสร้าง writer/gateway คู่ขนาน: ทุก writer ยังเขียนผ่าน canonical writer เดิมเท่านั้น
 * — โมดูลนี้เป็น gate ที่ผ่านก่อนเขียนเท่านั้น (fail-closed: ไม่ชัด = ห้ามเขียน)
 *
 * โมเดล service-key: canonical writers เขียนด้วย supabaseAdmin (bypass RLS) —
 * RLS (migration V2) คุม "อ่าน" ฝั่ง session · โมดูลนี้คุม "เขียน" ฝางสายกลาง
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildVerifiedScope,
  resolveTenantDecision,
  type OrgMembership,
  type TenantDenialCode,
  type TenantDecision,
  type VerifiedScope,
} from "@/core/auth/orgScope";

/** scope ที่ route/workspace ต้องแนบมากับทุกคำขอเขียน — ไม่เดาจากข้อมูลอื่น */
export interface TenantScope {
  /** องค์กรที่ผู้ใช้เลือกทำงานด้วยแบบชัดเจน (จาก workspace org context) */
  organizationId: string;
  /** auth.id ของผู้กระทำ (จาก getAuthedUser) */
  actorId: string;
}

export interface WriteScopeCheckInput {
  tenant: TenantScope | null | undefined;
  /** company ids ที่คำขอเขียนนี้จะไปแตะ (resource ownership ตรวจทั้งหมด) */
  resourceCompanyIds: string[];
}

export interface WriteScopeCheckResult {
  ok: boolean;
  code?: TenantDenialCode | "RESOURCE_NOT_OWNED" | "ORG_UNMAPPED";
  reason?: string;
  decision?: TenantDecision;
}

/** memberships ของผู้ใช้จาก org_members (service client — อ่านได้ข้าม RLS เพื่อตัดสิน) */
export async function fetchOrgMemberships(
  db: SupabaseClient,
  userId: string,
): Promise<OrgMembership[]> {
  const { data, error } = await db
    .from("org_members")
    .select("organization_id, role")
    .eq("user_id", userId);
  if (error) return []; // fail-closed: อ่าน membership ไม่ได้ = ไม่มีสิทธิ์
  return (data ?? []).map((m) => ({
    organizationId: String(m.organization_id),
    role: m.role as OrgMembership["role"],
  }));
}

/** ชื่อองค์กรสำหรับแสดงใน workspace (อ่านผ่าน service — คืน null ถ้าไม่พบ) */
export async function fetchOrganizationName(
  db: SupabaseClient,
  organizationId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return String(data.name);
}

/** company ids ที่องค์กรนี้เป็นเจ้าของจริง (อ่านจาก companies.organization_id) */
export async function fetchOrganizationCompanyIds(
  db: SupabaseClient,
  organizationId: string,
): Promise<string[]> {
  if (!organizationId.trim()) return [];
  const { data, error } = await db
    .from("companies")
    .select("id")
    .eq("organization_id", organizationId);
  if (error) return []; // fail-closed: อ่าน ownership ไม่ได้ = ไม่มี company ใน scope
  return (data ?? []).map((row) => String(row.id));
}

export type VerifiedScopeResult =
  | { ok: true; scope: VerifiedScope }
  | { ok: false; code: TenantDenialCode | "ORG_UNMAPPED"; reason: string };

/**
 * STEP 1 — resolve Verified Scope from the REAL session identity + explicit org.
 *
 * - auth comes from getAuthedUser() (server session), never from request input
 * - organizationId comes from the validated workspace cookie (or an explicit
 *   server-owned caller), never from a body/header supplied by AI/browser
 * - membership is checked by the ONE decision core (resolveTenantDecision)
 * - company ids are read from the real companies→organization relationship
 *
 * No membership / no mapped companies = DENY (no default tenant).
 */
export async function resolveVerifiedScope(
  db: SupabaseClient,
  input: { auth: { id: string; role: string } | null; organizationId: string | null | undefined },
): Promise<VerifiedScopeResult> {
  if (!input.auth?.id) {
    return { ok: false, code: "AUTH_REQUIRED", reason: "AUTH_REQUIRED: ต้องมี session ผู้ใช้จริง" };
  }
  const organizationId = (input.organizationId ?? "").trim();
  if (!organizationId) {
    return { ok: false, code: "ORG_REQUIRED", reason: "ORG_REQUIRED: ต้องเลือก organization scope ก่อนใช้งาน" };
  }

  const memberships = await fetchOrgMemberships(db, input.auth.id);
  const decision = resolveTenantDecision({
    auth: { id: input.auth.id },
    memberships,
    requestedOrganizationId: organizationId,
    action: "read",
  });
  if (!decision.allowed) {
    return { ok: false, code: decision.code ?? "ORG_NOT_MEMBER", reason: decision.reason ?? "ORG_NOT_MEMBER" };
  }

  const membership = memberships.find((m) => m.organizationId === organizationId);
  if (!membership) {
    return { ok: false, code: "ORG_NOT_MEMBER", reason: "ORG_NOT_MEMBER: membership ไม่ตรงกับ organization ที่ร้องขอ" };
  }

  const companyIds = await fetchOrganizationCompanyIds(db, organizationId);
  if (companyIds.length === 0) {
    return {
      ok: false,
      code: "ORG_UNMAPPED",
      reason: "ORG_UNMAPPED: องค์กรนี้ยังไม่มี company ที่ผูกกับ organization_id — ปฏิเสธแบบ fail-closed",
    };
  }

  return {
    ok: true,
    scope: buildVerifiedScope({
      userId: input.auth.id,
      appRole: input.auth.role,
      organizationId,
      orgRole: membership.role,
      companyIds,
    }),
  };
}

/** company → organization (ความเป็นเจ้าของข้อมูลจาก business entity จริง) */
/** ใช้ภายในโมดูลนี้เท่านั้น (ผู้เรียกคือ resolveTenantWriteScope) — ไม่ export เพื่อไม่ให้เป็น API คู่ขนาน */
async function resolveCompanyOrganizations(
  db: SupabaseClient,
  companyIds: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!companyIds.length) return out;
  const uniq = [...new Set(companyIds.filter(Boolean))];
  if (!uniq.length) return out;
  const { data, error } = await db
    .from("companies")
    .select("id, organization_id")
    .in("id", uniq);
  if (error) {
    for (const id of uniq) out.set(id, null);
    return out;
  }
  for (const row of data ?? []) out.set(String(row.id), row.organization_id ?? null);
  for (const id of uniq) if (!out.has(id)) out.set(id, null);
  return out;
}

/**
 * assert แบบ async — ดึง memberships + resource ownership จาก DB แล้วตัดสินครบทั้งสี่มิติ.
 * ใช้ใน canonical writers: throw ทันทีเมื่อ scope ถูกแนบมาแล้วไม่ผ่าน (fail-closed);
 * เมื่อไม่แนบ (ทางเดิม) คืน null ให้เดินต่อ — routes ใหม่ต้องแนบ scope ทุกคำขอ
 */
export async function assertWriteScope(
  db: SupabaseClient,
  input: WriteScopeCheckInput,
): Promise<WriteScopeCheckResult> {
  const tenant = input.tenant;
  if (!tenant || !tenant.organizationId?.trim() || !tenant.actorId?.trim()) {
    return { ok: false, code: "ORG_REQUIRED", reason: "ORG_REQUIRED: คำขอเขียนยังไม่แนบ organization scope (ทางเดิมที่ยังไม่ตัดสลาย)" };
  }

  // 1) AUTH + Membership + Permission (core เดียวกับที่ tenant-core:test ทดสอบ)
  const memberships = await fetchOrgMemberships(db, tenant.actorId);
  const decision = resolveTenantDecision({
    auth: { id: tenant.actorId },
    memberships,
    requestedOrganizationId: tenant.organizationId,
    action: "write",
  });
  if (!decision.allowed) {
    return { ok: false, code: decision.code, reason: decision.reason, decision };
  }

  // 2) Resource Ownership — company ทุกตัวที่คำขอนี้จะแตะต้องอยู่ในองค์กรเดียวกัน
  //    (company ที่ยังไม่ถูก map org = ห้ามเขียนผ่าน tenant scope นี้)
  const orgByCompany = await resolveCompanyOrganizations(db, input.resourceCompanyIds);
  for (const [companyId, orgId] of orgByCompany) {
    if (!orgId) {
      return {
        ok: false,
        code: "ORG_UNMAPPED",
        reason: `ORG_UNMAPPED: company ${companyId} ยังไม่ถูก map เข้าองค์กรใด — admin ต้อง map ก่อน (ไม่เดาแทน)`,
        decision,
      };
    }
    if (orgId !== tenant.organizationId) {
      return {
        ok: false,
        code: "RESOURCE_NOT_OWNED",
        reason: `RESOURCE_NOT_OWNED: company ${companyId} เป็นขององค์กรอื่น (cross-tenant write denied)`,
        decision,
      };
    }
  }
  return { ok: true, decision };
}

/** throw เวอร์ชัน — writer เรียน้อยที่สุดบรรทัดเดียว */
export function throwIfScopeDenied(result: WriteScopeCheckResult): void {
  if (result.ok) return;
  throw new Error(result.reason ?? "TENANT_SCOPE_DENIED");
}
