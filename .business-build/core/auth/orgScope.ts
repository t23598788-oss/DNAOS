/**
 * TENANT CORE V1 — org-scope authority (Layer 2 core · owner mission 2026-10-18).
 *
 * Pure decision layer (no DB in this file) — every tenant-scoped read/write route
 *resolves its decision through here so the SAME rules are testable in software tests
 * (Layer 3 synthetic fixtures) and enforceable in production routes (Layer 4).
 *
 * กฎหลัก (ตามภารกิจ):
 *   - ทุกการอ่าน/เขียนต้องระบุ Organization Scope และผู้กระทำต้องเป็น member
 *   - ห้ามลงไปข้ามองค์กรที่ไม่ได้เป็นสมาชิก (deny แม้ขอเฉย ๆ)
 *   - write/manage_members เจาะจง role (member = read-only)
 *   - ไม่พึ่งชื่อ/หมายเลขข้อมูลจริงใด ๆ — ข้อมูลจริงอยู่ในฐานข้อมูลขององค์กรนั้น
 *
 * Error contract: DENY คืน reason อ่านได้ + code คงเส้นคงวา (fail-closed ทุกเรื่อง)
 */
export type OrgRole = "owner" | "admin" | "member";

/**
 * VERIFIED REQUEST SCOPE (STEP 1/4 — identity propagation).
 *
 * Built ONLY from the authenticated session + org_members + companies.organization_id
 * (server-side, never from request body/header). The same object is handed from
 * the API edge to the AI pipeline, dispatcher and canonical readers so every
 * business read/write can be filtered by the SAME verified decision.
 *
 * `companyIds` is the resolved set of companies owned by this organization —
 * organization_id alone is never used as the permission decision; the membership
 * AND the company→organization relationship are both checked at resolution time.
 */
export interface VerifiedScope {
  userId: string;
  /** public.profiles.role (app role) at request time */
  appRole: string;
  organizationId: string;
  orgRole: OrgRole;
  companyIds: string[];
  /** actions this membership allows — write/manage are derived from org role */
  permissionScope: {
    read: true;
    write: boolean;
    manageMembers: boolean;
  };
  /** data boundary this request may touch */
  dataScope: {
    organizationId: string;
    companyIds: string[];
  };
}

export function buildVerifiedScope(input: {
  userId: string;
  appRole: string;
  organizationId: string;
  orgRole: OrgRole;
  companyIds: string[];
}): VerifiedScope {
  const uniqueCompanyIds = [...new Set(input.companyIds.filter(Boolean))];
  return {
    userId: input.userId,
    appRole: input.appRole,
    organizationId: input.organizationId,
    orgRole: input.orgRole,
    companyIds: uniqueCompanyIds,
    permissionScope: {
      read: true,
      write: rank[input.orgRole] >= rank.admin,
      manageMembers: input.orgRole === "owner",
    },
    dataScope: {
      organizationId: input.organizationId,
      companyIds: uniqueCompanyIds,
    },
  };
}

/** Company must be one of the companies owned by the verified organization. */
export function isCompanyInScope(scope: { companyIds: string[] } | null | undefined, companyId: string | null | undefined): boolean {
  if (!scope || !companyId) return false;
  return scope.companyIds.includes(companyId);
}

/** Fail-closed helper for routes/readers that accept a resource id from the client. */
export function assertCompanyInScope(scope: { companyIds: string[] } | null | undefined, companyId: string | null | undefined): void {
  if (!isCompanyInScope(scope, companyId)) {
    throw new Error("RESOURCE_NOT_OWNED: resource ไม่ได้อยู่ใน organization scope ที่ตรวจสอบแล้ว");
  }
}

export interface OrgMembership {
  organizationId: string;
  role: OrgRole;
}

export type TenantAction = "read" | "write" | "manage_members";

export interface TenantDecision {
  allowed: boolean;
  code?: TenantDenialCode;
  reason?: string;
}

export type TenantDenialCode =
  | "AUTH_REQUIRED"
  | "ORG_REQUIRED"
  | "ORG_NOT_MEMBER"
  | "PERMISSION_DENIED";

export interface TenantDecisionInput {
  /** resolved by core/auth/session.getAuthedUser() BEFORE calling here */
  auth: { id: string } | null;
  /** memberships of auth.id (synced from public.org_members) */
  memberships: OrgMembership[];
  /** the org this read/write claims to operate in — required, never inferred */
  requestedOrganizationId: string | null;
  action: TenantAction;
}

const rank: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

/** ทุกการอ่านและเขียนผ่านฟังก์ชันนี้จุดเดียว — fail-closed ทุกเงื่อนไขที่ไม่ชัด */
export function resolveTenantDecision(input: TenantDecisionInput): TenantDecision {
  if (!input.auth) {
    return { allowed: false, code: "AUTH_REQUIRED", reason: "AUTH_REQUIRED: ต้องมี session ผู้ใช้จริงก่อนเปิดข้อมูลองค์กรใด" };
  }
  if (!input.requestedOrganizationId || !input.requestedOrganizationId.trim()) {
    return {
      allowed: false,
      code: "ORG_REQUIRED",
      reason: "ORG_REQUIRED: ต้องระบุ organization scope ตั้งแต่ระดับคำขอ (ไม่อนุญาตให้เดาจากข้อมูลอื่น)",
    };
  }
  const membership = input.memberships.find((m) => m.organizationId === input.requestedOrganizationId);
  if (!membership) {
    return {
      allowed: false,
      code: "ORG_NOT_MEMBER",
      reason: `ORG_NOT_MEMBER: ผู้ใช้ไม่ใช่สมาชิกขององค์กรนี้ (cross-tenant access denied)`,
    };
  }
  if (input.action === "read") return { allowed: true };
  // write / manage_members ต้องมี role สูงกว่า (member = read-only)
  if (input.action === "write" && rank[membership.role] >= rank.admin) return { allowed: true };
  if (input.action === "manage_members" && membership.role === "owner") return { allowed: true };
  return {
    allowed: false,
    code: "PERMISSION_DENIED",
    reason: `PERMISSION_DENIED: role '${membership.role}' ไม่พอสำหรับ '${input.action}' ขององค์กรนี้`,
  };
}

/** throw เวอร์ชันสำหรับ route ที่อยาก fail ไม่ผ่าน (require chain) */
export function assertTenantScope(input: TenantDecisionInput): TenantDecision {
  const decision = resolveTenantDecision(input);
  if (!decision.allowed && decision.reason) throw new Error(decision.reason);
  return decision;
}

/** audit vocabulary (appenditive เดิม — กระทรวงที่ engines/canonical/audit.ts ไม่แสดงไว้ก่อนหน้า) */
export const TENANT_AUDIT_ACTIONS = [
  "organization.created",
  "organization.member_added",
  "organization.member_role_changed",
  "organization.member_removed",
] as const;
