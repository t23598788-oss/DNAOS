"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Organization = { id: string; name: string };

export default function BusinessOrganizationSwitcher() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/business/context", { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json().catch(() => ({})) }))
      .then(({ response, body }) => {
        if (!alive) return;
        if (!response.ok || body.ok !== true) throw new Error("โหลดขอบเขตองค์กรไม่สำเร็จ");
        setOrganizations(Array.isArray(body.organizations) ? body.organizations : []);
        setActiveId(typeof body.active_organization_id === "string" ? body.active_organization_id : "");
      })
      .catch(() => { if (alive) setError("ตรวจสอบสมาชิกองค์กรไม่สำเร็จ"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function selectOrganization(organizationId: string) {
    if (!organizationId || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/business/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: organizationId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok !== true) throw new Error("เลือกองค์กรไม่สำเร็จ");
      setActiveId(organizationId);
      window.dispatchEvent(new Event("dnaos-business-context-changed"));
      router.refresh();
    } catch {
      setError("องค์กรนี้ไม่ได้รับการยืนยันสำหรับบัญชีนี้");
    } finally {
      setSaving(false);
    }
  }

  const active = organizations.find((organization) => organization.id === activeId);

  return (
    <div className="flex min-w-0 items-center gap-2" aria-label="ขอบเขตธุรกิจ">
      <span className="hidden text-[11px] text-stone-500 sm:inline">พื้นที่ธุรกิจ</span>
      <select
        aria-label="เลือกองค์กรธุรกิจ"
        value={activeId}
        disabled={loading || saving || organizations.length === 0}
        onChange={(event) => void selectOrganization(event.target.value)}
        className="max-w-[220px] rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-800 disabled:opacity-60"
      >
        <option value="">{loading ? "กำลังตรวจสิทธิ์…" : organizations.length ? "เลือกองค์กร" : "ยังไม่มีองค์กรที่ผูกกับบัญชี"}</option>
        {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
      </select>
      {active && <span className="hidden max-w-[180px] truncate text-[10px] text-emerald-700 lg:inline">ข้อมูลของ {active.name}</span>}
      {error && <span role="status" className="hidden text-[10px] text-rose-700 lg:inline">{error}</span>}
    </div>
  );
}
