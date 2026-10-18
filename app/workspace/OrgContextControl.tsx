"use client";
import { useState } from "react";
import { useWorkspaceOrg } from "./OrgContextProvider";

/**
 * ตัวเลือก/สลับองค์กรใน workspace — ใช้บริบทจาก OrgContextProvider เท่านั้น
 * (ไม่มี fetch/สิทธิ์ซ้ำในไฟล์นี้) · สลับสำเร็จแล้วผู้บริโภคจะ remount ด้วย key ใหม่
 * ทำให้แชต/ผลลัพธ์ขององค์กรเดิมถูกล้างทั้งหมด
 */
export function OrgContextControl() {
  const { memberships, current, ready, switchTo } = useWorkspaceOrg();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready || memberships.length === 0) return null;

  return (
    <div
      data-testid="org-context-control"
      style={{ position: "fixed", top: 12, right: 16, zIndex: 60, display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, padding: "6px 10px", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}
    >
      <label htmlFor="workspace-org" style={{ fontSize: 12, color: "#78716c" }}>องค์กร</label>
      <select
        id="workspace-org"
        aria-label="เลือกองค์กร"
        value={current?.organizationId ?? ""}
        disabled={busy}
        onChange={async (e) => {
          const next = e.target.value;
          if (!next) return;
          setBusy(true);
          setError(null);
          const ok = await switchTo(next);
          setBusy(false);
          if (!ok) setError("สลับองค์กรไม่สำเร็จ");
        }}
        style={{ fontSize: 12, border: "1px solid #d6d3d1", borderRadius: 8, padding: "4px 6px", background: "#fff", maxWidth: 220 }}
      >
        <option value="">— เลือกองค์กร —</option>
        {memberships.map((m) => (
          <option key={m.organizationId} value={m.organizationId}>{m.name}</option>
        ))}
      </select>
      {error && <span role="alert" style={{ fontSize: 11, color: "#b91c1c" }}>{error}</span>}
    </div>
  );
}
