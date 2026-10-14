import { notFound } from "next/navigation";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { CAPABILITY_MATERIALS } from "./_lib/contract";
import { MaterialsCapabilityHost } from "./MaterialsHost";

/**
 * /workspace/capability — Unified Workspace Runtime STEP 1 (owner directive 2026-10-15)
 *
 * จุดเชื่อมแรกของการ "เปิดความสามารถหนึ่งอย่างภายใน DNA OS" (คำสั่ง ง.3 ข้อ 6):
 *   - ตารางข้อมูลวัสดุ/บ่อ (ที่มีจริงแล้ว) → BizTable + GET /api/admin/pits เดิมเท่านั้น
 *    (ไม่สร้าง API/ตาราง/canonical writer ใหม่ — อ่านผ่านเส้นทางเดิม)
 *  - สิทธิ์: requireAuthPage ADMIN_TIER ตามหน้าจอธุรกิจเดิมทุกบรรทัด (ไม่สร้าง auth ใหม่)
 *  - ปิด/กลับสู่หน้าจอหลัก: ปุ่มใน MaterialsCapabilityHost → /workspace (หน้าจอหลัก
 *    กล่องข้อความล่าง+ไอคอนหลักตำแหน่งเดิม — ไฟล์นี้ไม่แตะ shell ใดเลย)
 *
 * CONTRACT กับ shell เดิม (เอกสาร DNA_OS_UNIFIED_WORKSPACE_RUNTIME_MAPPING_20261015.md §6):
 *  - เข้าได้ทาง /workspace/capability?capability=materials
 *  - เรียกทางพารามิเตอร์ surface ของ shell ก็คงที่: /workspace?materialSurface=materials
 *    (WorkspaceFrame ปัจจุบันเป็นงานค้างของ session อื่น — ไฟล์นี้ไม่แตะ map นี้จนกว่า
 *     เจ้าของ shell จะลง commit เส้นทางเดียวกันกับ mapping ยังเชื่อมได้จริงด้วย URL ตรง)
 *  - โหมด LOCAL UI REVIEW (NODE_ENV != production, loopback) ถือว่าอย่างเดียวเดียวกับ
 *    workspace page เดิม: ไม่มีข้อมูลธุรกิจแสดง — ข้อมูลจริงต้องผ่าน session เดิมเท่านั้น
 */

export const dynamic = "force-dynamic";

export default async function WorkspaceCapabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuthPage("/workspace/capability", ADMIN_TIER);

  const sp = await searchParams;
  const one = (v: string | string[] | undefined): string | null =>
    typeof v === "string" ? v : typeof v === "object" && v[0] ? (v[0] as string) : null;
  const capability = one(sp.capability) ?? one(sp.materialSurface) ?? CAPABILITY_MATERIALS;

  if (capability !== CAPABILITY_MATERIALS) notFound();

  console.log("[TRACE-WORKSPACE-CAPABILITY] pass", { role: user.role, capability, host: "capability-step1" });
  return <MaterialsCapabilityHost backHref="/workspace" />;
}
