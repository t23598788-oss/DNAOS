"use client";

import { usePathname } from "next/navigation";

// Enterprise Workspace Architecture — shell สำหรับ Business/Partner/User
//
// ONE NAVIGATION (owner 2026-11-02): IconRail (64px) และ top bar (h-12:
// อีเมล + LogoutButton + portal badge) ถูกลบออกทั้งคู่ — เมนูทั้งระบบมาจาก
// <FloatingHomeButton /> ที่ app/layout.tsx ตัวเดียว และ logout อยู่ในเมนูนั้น
// ∴ ไฟล์นี้เหลือ "content wrapper" อย่างเดียว ตามที่ owner สั่ง
//
// `theme` ยังคงอยู่เพราะเนื้อหาของ portal ทั้งสามออกแบบมาบนพื้นดำ (การ์ด
// bg-stone-950 / text-white) — เปลี่ยนพื้นหลังจะทำให้การ์ดกลืนกับพื้น
// `excludePathPrefixes` ยังคงอยู่: หน้าที่มี full-screen shell ของตัวเอง
// (เช่น app/admin/relationships/workspace.tsx) ต้อง render เปล่า ไม่ถูกห่อ
export default function WorkspaceShell({
  theme = "dark",
  excludePathPrefixes = [],
  children,
}: {
  theme?: "dark" | "light";
  excludePathPrefixes?: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isExcluded = excludePathPrefixes.some((p) => pathname?.startsWith(p));

  if (isExcluded) {
    return <>{children}</>;
  }

  return (
    <div className="h-screen w-full overflow-hidden bg-white">
      <div className="h-full overflow-y-auto">{children}</div>
    </div>
  );
}
