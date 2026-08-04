import { redirect } from "next/navigation";

// Owner directive (2026-08-04): /admin/build, /admin/graph and
// /admin/telemetry merged into one screen — see app/admin/system/page.tsx.
// Pulse-overlay logic (the real ai_tasks Realtime subscription this page
// used to hold) moved to components/admin/useAiTaskPulse.ts, already wired
// into /admin/system — nothing telemetry-specific left uncovered here.
export default function TelemetryRedirectPage() {
  redirect("/admin/system");
}
