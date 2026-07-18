import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";

/**
 * Main layout for the admin area.
 *
 * Reverted to its pre-domains-commit state (DNA-000075) — the WorkspaceShell
 * wrap introduced in the same commit as the domain-registration feature
 * (c682a9c) forced a shared theme/header onto ~28 admin pages that were never
 * visually audited against it, causing real rendering distortion. The domains
 * feature itself (engines/domains/*, gateway/domains.ts, app/api/admin/domains/*)
 * has no nav/page footprint and was not touched — this file was the actual
 * cause. Pages that already use components/ui-kit/AppShell (e.g.
 * app/admin/line-customers/page.tsx) bring their own IconRail; pages that
 * don't yet have no left nav — same state as before the WorkspaceShell
 * migration, not a new regression.
 *
 * Navigation redesign (owner, 2026-07-16): a floating HomeBackBar overlay was
 * tried here and reverted the same day — it covered real page content (e.g.
 * the debt amount in the relationships header). Owner's correction: Home/Back
 * must be part of each page's own header layout, not a layer on top of it —
 * see components/nav/HomeBackInline.tsx, added into each page's real header
 * individually instead.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuthPage("/admin", ADMIN_TIER);

  return (
    <div className="min-h-screen bg-stone-50">
      {children}
    </div>
  );
}