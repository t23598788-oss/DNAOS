import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthedUser } from "@/core/auth/session";
import { LOCAL_UI_REVIEW_HEADER } from "@/core/auth/devReviewAccess";
import { WorkspaceFrame } from "./WorkspaceFrame";

// BUSINESS WORKSPACE — หน้าจอใช้งานจริงเพียงหน้าจอเดียวของ DNA OS (owner, 2026-09-22)
// (ประวัติเดิม: thin redirect → SLICE-1 authority data → SLICE-2 jobs rewire — ดู git log)
//
// REPLACE BUSINESS UI SHELL (owner reference: dna-workspace-frame v2, 2026-09-25)
//   - เปลี่ยน "โครงหน้าจอและวิธีเลือกเมนู" ตาม reference ใหม่: เมนูซ่อนที่ขอบจอ
//     (edge drawer) · icon ความสามารถ map ไป route เดิม · กลางจอ = บอร์ดแชทโล่ง
//   - ไม่เปลี่ยนสิทธิ์/auth: getAuthedUser + review-branch predicate เดิมทุกบรรทัด;
//     ทุก route ที่เมนูเปิดยังมี server guard ของตัวเอง (ห้ามแตะ auth/canonical/
//     migration/permissions — ไม่มีในไฟล์นี้)
//   - shell ไม่มีข้อมูล mock: ข้อมูลจริงอยู่หลัง route เดิมที่กดเปิดเท่านั้น
//   - ONE NAVIGATION (2026-10-06): BusinessWorkspace shell ถูกลบ — หน้า = WorkspaceFrame
//     เท่านั้น · TOOL_BINDINGS ยังอยู่ (source ให้ auth/provider tests อ่าน) ไม่ active render
export default async function WorkspacePage() {
  const user = await getAuthedUser();

  if (!user) {
    // LOCAL UI REVIEW (owner approval 2026-09-24) — header ถูก strip โดย middleware,
    // ติดเฉพาะ NODE_ENV !== production + host loopback + path ตรง prefix เท่านั้น
    // (predicate เดียวใน core/auth/devReviewAccess.ts — ไม่ใช่ระบบ auth ที่สอง)
    // ไม่มี session · ไม่มี role · ไม่มีข้อมูลธุรกิจ · production เข้าเส้นทางนี้ไม่ได้
    // และทุก route ที่อยู่หลังเมนูยังมี server guard ของตัวเองเหมือนเดิม
    const requestHeaders = await headers();
    const isLocalReview =
      process.env.NODE_ENV !== "production" &&
      requestHeaders.get(LOCAL_UI_REVIEW_HEADER) === "1";

    if (isLocalReview) {
      console.log("[TRACE-WORKSPACE] local UI review shell (workspace-frame, no session, no data)");
      return <WorkspaceFrame />;
    }

    redirect("/login?next=/workspace");
  }

  console.log("[TRACE-WORKSPACE]", { role: user.role, shell: "workspace-frame" });
  return <WorkspaceFrame />;
}
