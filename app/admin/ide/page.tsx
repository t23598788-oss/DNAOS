/**
 * /admin/ide — the Software Factory workspace (owner, 2026-08-07,
 * "/admin/ide Foundation" audit). Real backend wiring across most of the
 * surface — see components/ide-shell/IDEWorkspace.tsx's own header
 * comment for the current, accurate real/static breakdown. Gated the
 * same way every other /admin page is.
 */
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import IDEWorkspace from "@/components/ide-shell/IDEWorkspace";

export default async function IDEPage() {
  await requireAuthPage("/admin/ide", ADMIN_TIER);
  return <IDEWorkspace />;
}
