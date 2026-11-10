import { requireAuthPage } from "@/core/auth/requireAuthPage";
import permissions from "@/registry/permissions.json";
import type { AppRole } from "@/core/auth/session";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";

const USER_ROLES = permissions.route_access.find((r) => r.prefix === "/user")!.roles as AppRole[];

// Enterprise Workspace Architecture, Phase 2 — auth + shell now live here
// (matches app/admin/layout.tsx's and app/business/layout.tsx's existing
// pattern), page.tsx is content only. Same requireAuthPage call, same roles,
// same redirect behavior as before this file existed — nothing about the
// auth flow itself changed, only where the call is made from.
// owner 2026-11-02: shell ไม่มี IconRail/top bar แล้ว (เมนู + logout มาจาก
// <FloatingHomeButton /> ที่ root layout)
export default async function UserLayout({ children }: { children: React.ReactNode }) {
  await requireAuthPage("/user", USER_ROLES);

  return <WorkspaceShell>{children}</WorkspaceShell>;
}
