import { requireAuthPage } from "@/core/auth/requireAuthPage";
import permissions from "@/registry/permissions.json";
import type { AppRole } from "@/core/auth/session";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";

const BUSINESS_ROLES = permissions.route_access.find(r => r.prefix === "/business")!.roles as AppRole[];

// Main layout for the Business Portal (Enterprise Workspace Architecture,
// Phase 2). Auth ยังเรียกที่เดิมทุกบรรทัด — สิ่งที่เปลี่ยน (owner 2026-11-02)
// คือ shell ไม่มี IconRail/top bar แล้ว: เมนูและ logout มาจาก
// <FloatingHomeButton /> ที่ root layout ∴ ไม่ต้องคำนวณ navItems/portalStatus
// ที่นี่อีก (resolveNavItems ยังเป็นแหล่ง href ของ workspace ในเมนูนั้น)
export default async function BusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuthPage("/business", BUSINESS_ROLES);

  return <WorkspaceShell>{children}</WorkspaceShell>;
}
