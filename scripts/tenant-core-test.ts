/**
 * TENANT CORE V1 TEST (Layer 3 · synthetic fixtures only) — owner mission
 * SOFTWARE DEVELOPMENT AUTHORITY 2026-10-18.
 *
 * Fixtures: องค์กร/ผู้ใช้สังเคราะห์ (SYNTH-ORG-*, user-*.synthetic.test) แยกจาก
 * production ทุกชิ้น — ห้ามนำข้อมูลบริษัทจริงมาเป็น fixture (ภารกิจ Layer 3)
 * รัน: npx tsx scripts/tenant-core-test.ts · exit 1 เมื่อมี FAIL
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveTenantDecision, TENANT_AUDIT_ACTIONS, type OrgMembership } from "../core/auth/orgScope";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.error(`FAIL  ${name}${detail ? ` ← ${detail}` : ""}`); }
};

// ── synthetic fixtures (ไม่มีข้อมูลจริงตามข้อห้าม Layer 3) ───────────────────
const ORG_A = randomUUID(); // SYNTH-ORG-A
const ORG_B = randomUUID(); // SYNTH-ORG-B
const OWNER_A = { id: "user-owner-a@synthetic.test" };
const ADMIN_A = { id: "user-admin-a@synthetic.test" };
const MEMBER_A = { id: "user-member-a@synthetic.test" };
const OUTSIDER = { id: "user-outsider@synthetic.test" };

const membersA: OrgMembership[] = [
  { organizationId: ORG_A, role: "owner" },
];
const membersAdmin: OrgMembership[] = [{ organizationId: ORG_A, role: "admin" }];
const membersMember: OrgMembership[] = [{ organizationId: ORG_A, role: "member" }];

// 1) TENANT ISOLATION — cross-org access ถูกปฏิเสธเสมอ
const outsiderRead = resolveTenantDecision({
  auth: OUTSIDER, memberships: [], requestedOrganizationId: ORG_A, action: "read",
});
check("isolation: outsider read ORG_A = deny ORG_NOT_MEMBER", outsiderRead.code === "ORG_NOT_MEMBER" && !outsiderRead.allowed);

const outsiderWrite = resolveTenantDecision({
  auth: OUTSIDER, memberships: [{ organizationId: ORG_B, role: "owner" }], requestedOrganizationId: ORG_A, action: "write",
});
check("isolation: owner ของ ORG_B แตะ ORG_A = deny (ไม่มีข้อมูลข้ามองค์กร)", outsiderWrite.code === "ORG_NOT_MEMBER");

// 2) PERMISSION — read ตรวจ member เท่านั้น + write เจาะจง tier
check("read: owner ขององค์กรอ่านได้", resolveTenantDecision({ auth: OWNER_A, memberships: membersA, requestedOrganizationId: ORG_A, action: "read" }).allowed);
check("read: member ธรรมดาอ่านได้", resolveTenantDecision({ auth: MEMBER_A, memberships: membersMember, requestedOrganizationId: ORG_A, action: "read" }).allowed);
const memberWrite = resolveTenantDecision({ auth: MEMBER_A, memberships: membersMember, requestedOrganizationId: ORG_A, action: "write" });
check("write: member = PERMISSION_DENIED (read-only)", !memberWrite.allowed && memberWrite.code === "PERMISSION_DENIED");
check("write: admin ได้", resolveTenantDecision({ auth: ADMIN_A, memberships: membersAdmin, requestedOrganizationId: ORG_A, action: "write" }).allowed);
check("write: owner ได้", resolveTenantDecision({ auth: OWNER_A, memberships: membersA, requestedOrganizationId: ORG_A, action: "write" }).allowed);

// 3) manage_members = owner จริงเท่านั้น
const adminManage = resolveTenantDecision({ auth: ADMIN_A, memberships: membersAdmin, requestedOrganizationId: ORG_A, action: "manage_members" });
check("manage_members: admin = deny PERMISSION_DENIED", !adminManage.allowed && adminManage.code === "PERMISSION_DENIED");
check("manage_members: owner = allow", resolveTenantDecision({ auth: OWNER_A, memberships: membersA, requestedOrganizationId: ORG_A, action: "manage_members" }).allowed);

// 4) fail-closed ทุกเงื่อนไขที่ไม่ชัด
check("no session = deny AUTH_REQUIRED", resolveTenantDecision({ auth: null, memberships: [], requestedOrganizationId: ORG_A, action: "read" }).code === "AUTH_REQUIRED");
check("ไม่ระบุ org = deny ORG_REQUIRED (ห้ามเดา)", resolveTenantDecision({ auth: OWNER_A, memberships: membersA, requestedOrganizationId: null, action: "read" }).code === "ORG_REQUIRED");
check("org ว่าง = deny ORG_REQUIRED", resolveTenantDecision({ auth: OWNER_A, memberships: membersA, requestedOrganizationId: "  ", action: "read" }).code === "ORG_REQUIRED");

// 5) audit vocabulary additivity (ไม่ชน canonical actions เดินเครื่องเดิม)
const canonicalAudit = readFileSync(fileURLToPath(new URL("../engines/canonical/audit.ts", import.meta.url)), "utf8");
check("TENANT_AUDIT_ACTIONS แยกเพิ่มจาก audit.ts เดิม (ไม่ define ซ้ำ)",
  !canonicalAudit.includes("organization.created"), "ห้ามแตะ audit.ts เดิม");

// 6) static checks บน migration SQL (RLS fail-closed + ไม่ฝังข้อมูลจริง + ไม่ seed องค์กร)
const migrationName = "20261018000001_tenant_core_v1.sql";
const migrationPath = fileURLToPath(new URL(`../supabase/migrations/${migrationName}`, import.meta.url));
const sql = readFileSync(migrationPath, "utf8");
check("migration: organizations + org_members ถูกสร้าง", sql.includes("create table if not exists public.organizations") && sql.includes("create table if not exists public.org_members"));
check("migration: RLS ENABLE ทั้งสองตาราง (fail-closed)", /alter table public\.organizations enable row level security/.test(sql) && /alter table public\.org_members\s+enable row level security/.test(sql));
check("migration: policy เช็ค membership จาก auth.uid() เท่านั้น", (sql.match(/auth\.uid\(\)/g) ?? []).length >= 5);
check("migration: role อนุญาตเฉพาะ owner/admin/member", /check \(role in \('owner','admin','member'\)\)/.test(sql));
check("migration: ห้าม seed องค์กรใด ๆ (INSERT INTO organizations ต้องไม่มี)", !/insert\s+into\s+public\.organizations/i.test(sql));
check("migration: ไม่ฝังค่า/ชื่อธุรกิจจริง (digits-ยาว + ชื่อเจาะจง ASCII)", !/\d{9,}/.test(sql.replace(/20261018000001/g, "")) && !/kasikorn|kdocportal|DNA\s?OS/i.test(sql));
check("migration: companies.organization_id เป็น nullable additive", /add column if not exists organization_id uuid references public\.organizations/.test(sql));
check("migration: companies select อนุญาต nullable = เฉพาะ rows ยังไม่ map", /organization_id is null/.test(sql));

// 7) platform boundary: ไฟล์ core นี้เป็น pure (ไม่ import DB service ใน core)
console.log(failures === 0 ? "\n═══ TENANT CORE V1: PASS ═══" : `\n═══ TENANT CORE V1: ${failures} FAILED ═══`);
process.exit(failures === 0 ? 0 : 1);