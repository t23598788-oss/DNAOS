import { RelationshipWorkspacePage } from "./workspace"
import { requireAuthPage } from "@/core/auth/requireAuthPage"
import { ADMIN_TIER } from "@/core/auth/session"

// Display layer (START-HERE ข้อ17, dna-ui-master-template 2026-09-25): หน้า =
// WorkspaceFrame shell โดยตรง (feed จริง = แท็บแรก · แชท = แท็บสอง) — ไม่มี
// iframe ครอบ UI เก่า และไม่มี ?ui=legacy switch อีกต่อไป (ย้อนกลับผ่าน Git
// เท่านั้นตามข้อ22 · ไม่มีปุ่มกลับเครื่องมือเดิม)
// Server-side role gate คงเดิมทุกบรรทัด: ADMIN_TIER เท่ากับทุก API ที่จอเรียก
// (registry/permissions.json route_access /admin = super_admin/admin/employee;
// Middleware ตรวจแค่ "login แล้ว" — ไม่มี gate นี้ partner/customer จะจม 403)
export default async function RelationshipsPage() {
  await requireAuthPage("/admin/relationships", ADMIN_TIER)
  return <RelationshipWorkspacePage initialRelationshipId={null} />
}
