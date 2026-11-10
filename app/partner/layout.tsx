import { requireAuthPage } from "@/core/auth/requireAuthPage";
import permissions from "@/registry/permissions.json";
import type { AppRole } from "@/core/auth/session";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";

const PARTNER_ROLES = permissions.route_access.find((r) => r.prefix === "/partner")!.roles as AppRole[];

// Enterprise Workspace Architecture, Phase 2 — same pattern as app/user/layout.tsx.
// owner 2026-11-02: shell ไม่มี IconRail/top bar แล้ว (เมนู + logout มาจาก
// <FloatingHomeButton /> ที่ root layout) — auth guard เดิมไม่เปลี่ยน
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  await requireAuthPage("/partner", PARTNER_ROLES);

  return <WorkspaceShell>{children}</WorkspaceShell>;
}
