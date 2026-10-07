import { headers } from "next/headers";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { LOCAL_UI_REVIEW_HEADER } from "@/core/auth/devReviewAccess";
import { WorkspaceToolNavigation } from "@/app/workspace/WorkspaceFrame";
import { VoiceStandbyWidget } from "@/components/admin/VoiceStandbyWidget";

/**
 * Main layout for the admin area.
 *
 * ONE NAVIGATION (2026-10-06): ไม่มีแถบ Back/Home ถาวรบนหน้า admin แล้ว —
 * ทุก navigation มาจาก shell ของแต่ละหน้า (ปุ่มขอบจอของ WorkspaceFrame /
 * drawer) กับ browser back เท่านั้น ไฟล์แถบ Back/Home ถูกลบออกจาก
 * presentation/shell/navigation แล้ว
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
 * Navigation history (owner): a floating back/home overlay was tried here
 * (2026-07-16) and reverted the same day — it covered real page content. A
 * fixed back/home bar followed (2026-07-30) and was later removed entirely
 * by the ONE SURFACE/ONE NAVIGATION spec — the current shell owns navigation.
 *
 * Locked-viewport layout (owner, 2026-07-30): "ล็อกหน้าจอให้พอดีกับหน้าจอ
 * โน๊ตบุ๊ก ไม่อยากให้มันดิ้นได้...กล่องบล็อกการพิมพ์/หัวข้อด้านบน ไม่ต้องให้
 * มันเลื่อน" — reference was Gemini's own app chrome: header and input stay
 * fixed, only the message list scrolls, whole window never bounces. Root
 * cause of the old "whole page scrolls/reflows" behavior: this wrapper used
 * `min-h-screen` (a MINIMUM — grows past the viewport if content is taller)
 * stacked with older full-page screens (เช่น หน้าเลขา dashboard เดิมที่ถูกตัด
 * ออกแล้ว — ยุบทุกความสามารถเข้าแชตบอร์ดหลัก WorkspaceFrame) that ALSO used
 * `min-h-screen` for themselves — two stacked "at least 100vh" boxes render
 * taller than one real viewport, so the whole native window scrolled as one
 * long page instead of behaving like a locked app frame. Changed to a real
 * `h-screen` (a FIXED size) flex column with a single `overflow-y-auto`
 * region below the top chrome — this preserves normal scrolling for
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
    <div className="dna-admin-shell bg-stone-50">
      {/* ONE NAVIGATION (2026-10-06): ไม่มีแถบ Back/Home ถาวร —
          navigation = shell ของแต่ละหน้า (ปุ่มขอบจอ + drawer) กับ browser
          back เท่านั้น — หน้า children ทั้งหมดเลื่อนใน region เดียวด้านล่างนี้ */}
      <WorkspaceToolNavigation />
      <div className="dna-admin-content">
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