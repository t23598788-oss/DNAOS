import { redirect } from "next/navigation";
import { getAuthedUser } from "@/core/auth/session";
import { resolveAllowedCapabilities } from "@/core/navigation/resolveCapabilityAccess";
import { BusinessWorkspace } from "./BusinessWorkspace";
import { loadPartnerWorkspace } from "./_lib/partnerDisplayModel";

// BUSINESS WORKSPACE — หน้าจอใช้งานจริงเพียงหน้าจอเดียวของ DNA OS (owner, 2026-09-22)
//
// เดิม route นี้เป็น thin redirect ไป resolveDestination(user.role) เท่านั้น
// (ผู้ใช้เข้าตรงที่ /workspace ไม่มี role ใดถูกส่งมาที่นี่ — registry/permissions.json
//  workspace_landing ไม่มี "/workspace" จึงไม่มีผลกับ post-login landing ของบทบาทใด)
//
// เปลี่ยนเป็นหน้าจอจริงตามคำสั่ง Owner: APPLICATION_WORKSPACE_ROUTE = 1
//   - ยังใช้ auth เดิม (getAuthedUser) — ไม่แตะ Login/middleware/registry เดิม
//   - ประกอบจาก canonical primitives + display renderer ที่มีอยู่แล้ว
//   - ไม่มี business logic / scanner / executor ใหม่
//
// SLICE-1 (owner decision D1=A, D2=B, 2026-09-23) — BUSINESS DATA ใต้ authority กลาง
//   identity → central authority → business tool → existing query → existing DB
//   → canonical result → NEW UI renderer
//   · authority มาจาก registry/permissions.json#capability_access ทาง
//     core/navigation/resolveCapabilityAccess.ts เท่านั้น (default = deny)
//   · ข้อมูลมาจาก getPartnersWithDocumentSummary() ตัวเดิม (อ่านอย่างเดียว)
//   · role ไม่ถูกส่งลง component — ส่งเป็นรายการ tool key ที่อนุญาตแล้ว
//   · ถ้า role ไม่ได้สิทธิ์ tool ใดเลย query จะไม่ถูกเรียกแม้แต่ครั้งเดียว
export default async function WorkspacePage() {
  const user = await getAuthedUser();

  if (!user) {
    redirect("/login?next=/workspace");
  }

  const allowedTools = resolveAllowedCapabilities(user.role);
  const canReadPartners = allowedTools.includes("people");

  // อ่านข้อมูลจริงเฉพาะเมื่อ registry อนุญาต tool นั้น (ไม่มีการอ่านเผื่อ)
  const partners = canReadPartners ? await loadPartnerWorkspace() : null;

  console.log("[TRACE-WORKSPACE]", {
    role: user.role,
    allowedTools: allowedTools.length,
    partnerRows: partners?.rowCount ?? 0,
  });

  return (
    <BusinessWorkspace
      allowedTools={allowedTools}
      liveModels={partners ? { people: partners.listModel } : {}}
      liveTargets={partners ? partners.targets : {}}
    />
  );
}
