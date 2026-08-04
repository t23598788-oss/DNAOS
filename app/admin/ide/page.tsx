/**
 * /admin/ide — Integrated Development Workspace (owner, 2026-08-05).
 * VS Code-shaped Application Shell wired to real capabilities only
 * (components/ide-shell/IDEWorkspace.tsx). Gated the same way every other
 * /admin page is. Does not replace or remove any existing page — every tool
 * here reuses real existing routes/data, additive only.
 */
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import IDEWorkspace from "@/components/ide-shell/IDEWorkspace";

export default async function IDEPage() {
  await requireAuthPage("/admin/ide", ADMIN_TIER);
  return <IDEWorkspace />;
}
