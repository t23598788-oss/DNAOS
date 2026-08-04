/**
 * /admin/dev-loop — Dev Loop Pipeline dashboard (owner, 2026-08-05).
 * Shows the live file-watch -> evidence -> impact -> proposal loop as it
 * runs on the owner's local machine (npm run watch), and lets the Owner
 * approve/reject registry proposals. Gated the same way every other /admin
 * page is (requireAuthPage) — middleware.ts's /admin prefix is defense in
 * depth, this is the real per-page check.
 */
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import DevLoopDashboard from "./DevLoopDashboard";

export default async function DevLoopPage() {
  await requireAuthPage("/admin/dev-loop", ADMIN_TIER);
  return <DevLoopDashboard />;
}
