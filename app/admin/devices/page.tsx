import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import DevicesBoard from "./DevicesBoard";

// Devices (2026-09-25) — the admin surface for paired user-machine executors:
// mint pairing code, view hardware facts + printers, queue the allowlisted
// probe, revoke (server-side token kill). Server-side ADMIN_TIER gate = same
// registry authority as every /admin route; no secrets render here (token
// exists only as sha256 server-side + in the device's OS secret store).
export default async function DevicesPage() {
  await requireAuthPage("/admin/devices", ADMIN_TIER);
  return (
    <div className="min-h-screen bg-[#F0EBE5] p-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-lg font-bold text-stone-800">อุปกรณ์ที่จับคู่ (Device Connector)</h1>
        <p className="mt-1 text-xs text-stone-500">
          เครื่องของผู้ใช้ที่ติดตั้ง connector = executor ของระบบเดิม — ถือเฉพาะ token ของตัวเอง (เก็บใน
          Keychain/DPAPI/libsecret ของ OS) · ไม่มี owner/admin/service-role secret ลงไปที่เครื่องใด ๆ
        </p>
        <DevicesBoard />
      </div>
    </div>
  );
}
