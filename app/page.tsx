/**
 * Root Domain UI Conversion (owner, 2026-08-05): "/" is the Owner Control
 * Center, not a public landing page — real Runtime/Registry/Database/
 * System Health/Costs data now renders here (app/OperationalWorkspace.tsx),
 * so it's gated the same way /admin is (requireAuthPage), with
 * middleware.ts's exact-match "/" entry as defense in depth. Split into a
 * Server Component (this file, can call requireAuthPage) + a Client
 * Component (OperationalWorkspace.tsx, needs useState/useTheme/Realtime)
 * because a single 'use client' file can't call a server-only auth check.
 */
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import OperationalWorkspace from "./OperationalWorkspace";

export default async function RootPage() {
  await requireAuthPage("/", ADMIN_TIER);
  return <OperationalWorkspace />;
}
