import { redirect } from "next/navigation"

// Navigation redesign (owner, 2026-07-16): Relationship Workspace (the LINE
// chat screen) is now the system Home — every "go back to the start" path
// (this redirect, workspace_landing in registry/permissions.json, the Home
// button added in app/admin/layout.tsx) points here, not the old dashboard.
export default function AdminPage() {
  redirect("/admin/relationships")
}
