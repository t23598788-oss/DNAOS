import { headers } from "next/headers";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { LOCAL_UI_REVIEW_HEADER } from "@/core/auth/devReviewAccess";
import { AdminWorkspaceSurface } from "@/app/workspace/WorkspaceFrame";
import { VoiceStandbyWidget } from "@/components/admin/VoiceStandbyWidget";

/** One shared workspace surface; authentication and route behavior stay unchanged.
 * Tool pages render in the center of WorkspaceFrame. Relationships keeps its
 * existing channel-aware frame, so there is never a second nested composer.
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
      <div className="dna-admin-content">
        <AdminWorkspaceSurface>{children}</AdminWorkspaceSurface>
      </div>
      {/* Global Background Voice Listener — UI half (owner, 2026-07-30):
          mounted globally so it's reachable from every admin page. Never
          touches a microphone itself — see VoiceStandbyWidget.tsx's own
          comment for the real daemon/Realtime architecture. */}
      <VoiceStandbyWidget />
    </div>
  );
}