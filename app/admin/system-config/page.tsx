import { Suspense } from "react";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import SystemConfigCenter from "@/components/admin/SystemConfigCenter";

// System Configuration Center (owner, 2026-08-05) — single screen for every
// setting DNA OS actually has: AI Models, Plugins/Connectors, Runtime
// Automation, Infrastructure, Business, Domains, Users & Permissions. Real
// data only (via /api/admin/system-config + /api/admin/connectors); items
// with no backend today are shown as "Not integrated" with the real reason,
// never faked as connected. No file/folder browsing on this screen.
export default async function SystemConfigPage() {
  await requireAuthPage("/admin/system-config", ADMIN_TIER);

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-4">
        <h1 className="text-base font-bold text-stone-800">System Configuration</h1>
        <p className="text-[11px] text-stone-400 mt-0.5">
          การตั้งค่าทั้งหมดของ DNA OS ในหน้าเดียว — ไม่ต้องแก้ .env ไม่ต้องหาไฟล์ config
        </p>
      </div>
      <Suspense fallback={<div className="p-6 text-sm text-stone-400">กำลังโหลด…</div>}>
        <SystemConfigCenter />
      </Suspense>
    </div>
  );
}
