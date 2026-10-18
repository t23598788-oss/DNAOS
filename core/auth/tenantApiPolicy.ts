/**
 * TENANT API POLICY — pure gate สำหรับ Admin API ที่อ่าน/เขียนข้อมูลธุรกิจ
 * (owner mission REMAINING GAPS · STEP 2)
 *
 * ต่อจาก core/auth/orgContext.ts (บริบทองค์กรของ workspace) และ core/auth/orgScope.ts
 * (decision จุดเดียว) — ไฟล์นี้ไม่แตะ DB: แปลง (path, method, session, cookie org,
 * memberships) เป็นคำตัดสิน HTTP ที่ middleware ใช้จุดเดียวสำหรับทุก business API
 *
 * กฎ:
 *   - ไม่ใช่ business API            → EXEMPT (ไม่แตะพฤติกรรมเดิม)
 *   - ไม่มี session                 → 401 AUTH_REQUIRED
 *   - ไม่มี org context (cookie)     → 403 ORG_REQUIRED
 *   - org ไม่ใช่ membership          → 403 ORG_NOT_MEMBER (cross-tenant)
 *   - ชื่อ org ผิดรูป                → 403 ORG_NOT_MEMBER (fail-closed)
 *   - GET/HEAD = read, อื่น ๆ = write → member อ่านได้ · เขียนต้อง admin/owner
 *   - อ่าน membership ไม่ได้ (DB error) → 403 ORG_NOT_MEMBER (fail-closed)
 */
/** prefix ของ API ธุรกิจที่ต้องมี organization scope — ใช้ภายในไฟล์นี้เท่านั้น (knip: ไม่มีผู้ import) */
const BUSINESS_API_PREFIXES = [
  "/api/admin/company-expenses",
  "/api/admin/debt-trackings",
  "/api/admin/documents",
  "/api/admin/finance",
  "/api/admin/finance-alerts",
  "/api/admin/finance-summary",
  "/api/admin/invoices",
  "/api/admin/line-customers",
  "/api/admin/line-profiles",
  "/api/admin/materials",
  "/api/admin/material-quote",
  "/api/admin/outbound-drafts",
  "/api/admin/partners",
  "/api/admin/payables",
  "/api/admin/pits",
  "/api/admin/provider-settings",
  "/api/admin/quotation-queue",
  "/api/admin/receipt-documents",
  "/api/admin/relationships",
  "/api/admin/sites",
  "/api/admin/storage-intelligence",
] as const;

type TenantApiAction = "read" | "write";

export interface TenantApiDecision {
  allowed: boolean;
  status: 200 | 401 | 403;
  code?: "AUTH_REQUIRED" | "ORG_REQUIRED" | "ORG_NOT_MEMBER" | "PERMISSION_DENIED";
  reason?: string;
  action?: TenantApiAction;
  organizationId?: string;
}

export function isBusinessApiPath(pathname: string): boolean {
  return BUSINESS_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function tenantActionForMethod(method: string): TenantApiAction {
  return method === "GET" || method === "HEAD" ? "read" : "write";
}

interface DecideInput {
  pathname: string;
  method: string;
  authenticated: boolean;
  /** cookie dna_org_context (sanitize แล้ว) */
  cookieOrgId: string | null;
  /** membership ของผู้ใช้ — null = อ่านไม่ได้ (fail-closed) */
  memberships: { organizationId: string; role: string }[] | null;
}

const ROLE_RANK: Record<string, number> = { member: 1, admin: 2, owner: 3 };

export function decideTenantApi(input: DecideInput): TenantApiDecision {
  if (!isBusinessApiPath(input.pathname)) return { allowed: true, status: 200 };
  const action = tenantActionForMethod(input.method);
  if (!input.authenticated) {
    return { allowed: false, status: 401, code: "AUTH_REQUIRED", action, reason: "ต้อง login ก่อนใช้งาน" };
  }
  const orgId = (input.cookieOrgId ?? "").trim();
  if (!orgId) {
    return { allowed: false, status: 403, code: "ORG_REQUIRED", action, reason: "ต้องเลือกองค์กรก่อนใช้งาน (organization scope ไม่มีค่าเริ่มต้น)" };
  }
  if (!input.memberships) {
    return { allowed: false, status: 403, code: "ORG_NOT_MEMBER", action, reason: "ตรวจ membership ไม่ได้ — ปฏิเสธแบบ fail-closed" };
  }
  const membership = input.memberships.find((m) => m.organizationId === orgId);
  if (!membership) {
    return { allowed: false, status: 403, code: "ORG_NOT_MEMBER", action, reason: "ไม่ใช่สมาชิกขององค์กรนี้ (cross-tenant denied)" };
  }
  if (action === "write" && (ROLE_RANK[membership.role] ?? 0) < ROLE_RANK.admin) {
    return { allowed: false, status: 403, code: "PERMISSION_DENIED", action, reason: `role '${membership.role}' เขียนไม่ได้ (ต้อง admin/owner)` };
  }
  return { allowed: true, status: 200, action, organizationId: orgId };
}
