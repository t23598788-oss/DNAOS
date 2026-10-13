import { requireAuthPage } from "@/core/auth/requireAuthPage"
import { ADMIN_TIER } from "@/core/auth/session"
import BizNav from "./_lib/BizNav"

/**
 * BUSINESS WORKSPACE ใหม่ — /biz (owner 2026-10-13: โครงสร้างหน้าจอใหม่ชุดเดียว)
 * - แถบนำทางบน "แถวเดียว" (ไม่มี tab bar ซ้อนกัน) + พื้นที่แสดงผลร่วมกันด้านล่าง
 * - gate เดิมทุกบรรทัด: requireAuthPage(ADMIN_TIER) — ไม่มีสิทธิ์ใหม่ ไม่มี second auth
 * - shell ใช้ .dna-admin-shell/.dna-admin-content ตัวเดิมจาก app/globals.css
 * - ไม่ลบหน้าจอเดิม (/admin/*) ทั้งสิ้น — หน้าใหม่ดึง capability เดิมมาใช้โดยตรง
 */
export default async function BizLayout({ children }: { children: React.ReactNode }) {
  await requireAuthPage("/biz", ADMIN_TIER)

  return (
    <div className="dna-admin-shell bg-stone-50">
      <BizNav />
      <div className="dna-admin-content">{children}</div>
    </div>
  )
}
