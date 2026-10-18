/**
 * WORKSPACE ORG CONTEXT — pure layer (Layer 2 · MULTITENANT phase)
 *
 * ผู้ใช้หนึ่งคนใช้ได้หลายองค์กร — บริบทองค์กรของ workspace ต้องถูก "เลือกแบบชัดเจน"
 * เสมอ (cookie `dna_org_context`) · ซอฟต์แวร์ไม่ยึดบริษัทผู้พัฒนา (หรือองค์กรใด)
 * เป็น tenant เริ่มต้น — ไม่มี default แบบเดา:
 *   - ไม่มี cookie            → ORG_REQUIRED (workspace ต้องให้ผู้ใช้เลือกก่อน)
 *   - cookie แต่ไม่ใช่ member → ORG_NOT_MEMBER (deny — ห้ามแตะข้อมูลองค์กรอื่น)
 *   - cookie = member         → ok (read-level เท่านั้น; เขียนยังผ่าน orgScope action)
 *
 * Pure ทุกฟังก์ชัน — decision เดียวกับที่ tenant-core/matrix tests ทดสอบ.
 */
export const ORG_CONTEXT_COOKIE = "dna_org_context";

export type OrgContextDecision =
  | { ok: true; organizationId: string }
  | { ok: false; code: "AUTH_REQUIRED" | "ORG_REQUIRED" | "ORG_NOT_MEMBER" };

export function decideWorkspaceOrg(
  auth: { id: string } | null,
  memberships: { organizationId: string; role: string }[],
  cookieOrgId: string | null | undefined,
): OrgContextDecision {
  if (!auth) return { ok: false, code: "AUTH_REQUIRED" };
  const requested = (cookieOrgId ?? "").trim();
  if (!requested) return { ok: false, code: "ORG_REQUIRED" };
  const member = memberships.find((m) => m.organizationId === requested);
  if (!member) return { ok: false, code: "ORG_NOT_MEMBER" };
  return { ok: true, organizationId: member.organizationId };
}

/** cookie value รับได้เฉพาะตัวอักษร id ธรรมดา — ป้องกัน value แปลกปลอมเข้าถึง header */
export function sanitizeOrgCookie(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}
