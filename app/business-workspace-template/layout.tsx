// Business Workspace Template — auth boundary ของพื้นที่ template/review (owner, 2026-09-23)
//
// พื้นที่นี้เป็น DEVELOPMENT / TEMPLATE / REVIEW surface ไม่ใช่ public business route:
//   - production: ผู้ที่ยังไม่ login จะถูกพาไป /login (requireAuthPage) — anonymous เข้าไม่ได้
//   - development/local: Owner เปิดดู template ได้ผ่าน dev-review allowance เดิม
//     (core/auth/devReviewAccess.ts — ต้องเป็น loopback + NODE_ENV !== "production"
//      และมี header ที่ middleware เป็นผู้ติดให้เท่านั้น)
// ใช้ helper เดิมทั้งชุด (requireAuthPage + ADMIN_TIER + dev-review predicate) —
// ไม่มีระบบ auth ใหม่ และไม่แตะ /workspace หรือ Login
import { headers } from "next/headers";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { LOCAL_UI_REVIEW_HEADER } from "@/core/auth/devReviewAccess";

export default async function BusinessWorkspaceTemplateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  const isLocalReview =
    process.env.NODE_ENV !== "production" && requestHeaders.get(LOCAL_UI_REVIEW_HEADER) === "1";

  if (!isLocalReview) {
    await requireAuthPage("/business-workspace-template", ADMIN_TIER);
  }

  return <>{children}</>;
}
