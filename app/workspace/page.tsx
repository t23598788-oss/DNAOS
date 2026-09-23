import { redirect } from "next/navigation";
import { getAuthedUser } from "@/core/auth/session";
import { BusinessWorkspace } from "./BusinessWorkspace";

// BUSINESS WORKSPACE — หน้าจอใช้งานจริงเพียงหน้าจอเดียวของ DNA OS (owner, 2026-09-22)
//
// เดิม route นี้เป็น thin redirect ไป resolveDestination(user.role) เท่านั้น
// (ผู้ใช้เข้าตรงที่ /workspace ไม่มี role ใดถูกส่งมาที่นี่ — registry/permissions.json
//  workspace_landing ไม่มี "/workspace" จึงไม่มีผลกับ post-login landing ของบทบาทใด)
//
// เปลี่ยนเป็นหน้าจอจริงตามคำสั่ง Owner: APPLICATION_WORKSPACE_ROUTE = 1
//   - ยังใช้ auth เดิม (getAuthedUser) — ไม่แตะ Login/middleware/registry
//   - ประกอบจาก canonical primitives + display renderer ที่มีอยู่แล้ว
//   - ไม่มี business logic / scanner / executor ใหม่
export default async function WorkspacePage() {
  const user = await getAuthedUser();

  if (!user) {
    redirect("/login?next=/workspace");
  }

  return <BusinessWorkspace />;
}
