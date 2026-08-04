import { redirect } from "next/navigation";

// Owner directive (2026-08-04): /admin/build, /admin/graph and
// /admin/telemetry merged into one screen — see app/admin/system/page.tsx.
// The real graph component (ForceGraph3DView + node inspector) itself was
// moved to GraphView.tsx (no longer a route) so /admin/system can import it
// directly without going through a redirecting page.
export default function GraphRedirectPage() {
  redirect("/admin/system");
}
