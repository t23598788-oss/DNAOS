import { headers } from "next/headers";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { LOCAL_UI_REVIEW_HEADER } from "@/core/auth/devReviewAccess";
import { HomeBackBar } from "@/presentation/shell/navigation/HomeBackBar";
import { VoiceStandbyWidget } from "@/components/admin/VoiceStandbyWidget";

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
 * the debt amount in the relationships header). The referenced per-page
 * HomeBackInline.tsx was never actually built (comment-only, found live
 * 2026-07-30 while wiring the Tauri desktop wrap — that wrap has no browser
 * chrome at all, no back button, nothing).
 *
 * Real fix (2026-07-30): components/nav/HomeBackBar.tsx, rendered here in
 * NORMAL DOCUMENT FLOW (not floating/absolute) — it takes its own real
 * space and pushes page content down, so it can never cover anything the
 * way the 2026-07-16 overlay did.
 *
 * Locked-viewport layout (owner, 2026-07-30): "ล็อกหน้าจอให้พอดีกับหน้าจอ
 * โน๊ตบุ๊ก ไม่อยากให้มันดิ้นได้...กล่องบล็อกการพิมพ์/หัวข้อด้านบน ไม่ต้องให้
 * มันเลื่อน" — reference was Gemini's own app chrome: header and input stay
 * fixed, only the message list scrolls, whole window never bounces. Root
 * cause of the old "whole page scrolls/reflows" behavior: this wrapper used
 * `min-h-screen` (a MINIMUM — grows past the viewport if content is taller)
 * stacked with pages like app/admin/dashboard/page.tsx that ALSO used
 * `min-h-screen` for themselves — two stacked "at least 100vh" boxes render
 * taller than one real viewport, so the whole native window scrolled as one
 * long page instead of behaving like a locked app frame. Changed to a real
 * `h-screen` (a FIXED size) flex column with HomeBackBar pinned and a single
 * `overflow-y-auto` region below it — this preserves normal scrolling for
 * every other admin page (that region scrolls exactly like `<body>` used
 * to), while giving pages that want a fully locked frame (the dashboard/
 * chat screen) a bounded, correctly-measured parent to fill with `h-full`
 * instead of another unbounded `min-h-screen`.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // LOCAL UI REVIEW (dev only) — middleware.ts ติด header นี้ให้เฉพาะคำขอที่อยู่ใต้
  // /admin/ui-gallery บน loopback และใน NODE_ENV ที่ไม่ใช่ production เท่านั้น
  // คำขออื่นทั้งหมด (และ header ที่ browser ปลอมมาใน production) ยังเรียก guard ตัวจริงตามเดิม
  const requestHeaders = await headers();
  const isLocalUiReview =
    process.env.NODE_ENV !== "production" && requestHeaders.get(LOCAL_UI_REVIEW_HEADER) === "1";
  if (!isLocalUiReview) {
    await requireAuthPage("/admin", ADMIN_TIER);
  }

  return (
    <div className="h-screen flex flex-col bg-stone-50">
      <HomeBackBar />
      <div className="flex-1 min-h-0 overflow-y-auto">
        {children}
      </div>
      {/* Global Background Voice Listener — UI half (owner, 2026-07-30):
          mounted globally so it's reachable from every admin page. Never
          touches a microphone itself — see VoiceStandbyWidget.tsx's own
          comment for the real daemon/Realtime architecture. */}
      <VoiceStandbyWidget />
    </div>
  );
}