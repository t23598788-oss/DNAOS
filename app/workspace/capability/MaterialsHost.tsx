"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import BizTable, { type BizColumn } from "@/app/biz/_lib/BizTable";


/**
 * MaterialsCapabilityHost — STEP 1 ของ Unified Workspace Runtime (owner directive 2026-10-15)
 *
 * สร้างใหม่เฉพาะโฮสต์บาง ๆ ตัวเดียว (บอร์ดชื่อ/ปุ่มกลับ/ปิด) — เนื้อหาจริงทั้งหมดเป็น
 *  "ของเดิม": BizTable (app/biz/_lib) + GET /api/admin/pits (route เดิม, requireAuth
 *  ADMIN_TIER) — ไม่มี SQL ใหม่ ไม่มี canonical writer ใหม่ ไม่แตะตารางใด
 *
 * ปิด/กลับ: ปุ่ม "← กลับสู่หน้าจอหลัก" เรียก /workspace (หน้าจอหลัก + กล่องข้อความล่าง
 * + ไอคอนควบคุมหลัก ตำแหน่งเดิม ไม่ถูกแตะจากไฟล์นี้)
 */


interface PitMaterial {
  material_type_id: string;
  name: string;
  price: number;
}
interface PitRow {
  id: string;
  name: string;
  address: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  materials: PitMaterial[];
  active: boolean;
  business_type: string;
  business_type_label: string;
  type_source: string;
  type_evidence: string;
}

const NOOP = () => {};

export function MaterialsCapabilityHost({ backHref }: { backHref: string }) {
  const [typeFilter, setTypeFilter] = useState("");
  const [rows, setRows] = useState<PitRow[]>([]);
  const [typeLabels, setTypeLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // API เดิมแบบเดียวกับ /biz (requireAuth ADMIN_TIER + cookie session เดิม)
      const res = await fetch("/api/admin/pits", { credentials: "same-origin" });
      if (res.status === 401) throw new Error("session หมดอายุ — กลับไปเข้าสู่ระบบที่ /login");
      if (res.status >= 500) throw new Error(`API /api/admin/pits ตอบกลับ ${res.status}`);
      const json = await res.json();
      if (res.status !== 200 && res.status !== 207) {
        throw new Error(typeof json?.error === "string" ? json.error : `API ตอบกลับ ${res.status}`);
      }
      setRows(Array.isArray(json.pits) ? json.pits : []);
      setTypeLabels(typeof json.typeLabels === "object" && json.typeLabels ? json.typeLabels : {});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ (โปรดกดรีเฟรชเอง)");
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await load();
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const closeView = useCallback(() => {
    // ปิด = ถอยกลับจุดเปิดล่าสุด; ถ้าไม่มี history ให้กลับหน้าจอหลักแบบชัดเจน
    if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
    else window.location.href = backHref;
  }, [backHref]);

  const typeOptions = Array.from(new Set(rows.map((r) => r.business_type))).sort();

  const columns: BizColumn<PitRow>[] = [
    { key: "name", label: "ชื่อบ่อ/แพล้นท์", binds: "pit_profiles.pit_name (API /api/admin/pits เดิม)", width: "16rem" },
    {
      key: "business_type",
      label: "ประเภท",
      binds: "facility_types / businessType.ts (ตรรกะเดิม ไม่แก้)",
      render: (r) => (
        <div>
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#eef2f7" }}>
            {r.business_type_label}
          </span>
          <div style={{ fontSize: 10, color: "#8b8b8b", marginTop: 2 }}>{r.type_evidence}</div>
        </div>
      ),
    },
    {
      key: "materials",
      label: "วัสดุ + ราคา (รายไล่)",
      binds: "pit_materials ⋈ material_types (จุดเดิมที่ข้อเสนอราคาอ่านจริง)",
      width: "22rem",
      render: (r) =>
        r.materials.length === 0 ? (
          <span style={{ color: "#a0a0a0" }}>ยังไม่มีวัสดุผูกราคา</span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {r.materials.map((m) => (
              <span key={m.material_type_id} style={{ fontSize: 11, border: "1px solid #e3e3e3", borderRadius: 6, padding: "1px 6px" }}>
                {m.name} · {m.price.toLocaleString()}/คิว
              </span>
            ))}
          </div>
        ),
    },
    { key: "address", label: "ที่อยู่", binds: "pit_profiles.address", width: "18rem" },
    {
      key: "gps",
      label: "พิกัด GPS",
      binds: "pit_profiles.latitude/longitude (จุดเดิมที่ engines/distance อ่านจริง)",
      width: "14rem",
      render: (r) =>
        r.lat && r.lng ? (
          <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>
            {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
          </span>
        ) : (
          <span style={{ color: "#a0a0a0" }}>ยังไม่มีพิกัด</span>
        ),
    },
    {
      key: "active",
      label: "สถานะ",
      binds: "pit_profiles.deleted_at",
      render: (r) =>
        r.active ? (
          <span style={{ fontSize: 11, color: "#1e7a2e" }}>ใช้งาน</span>
        ) : (
          <span style={{ fontSize: 11, color: "#9b2c2c" }}>ปิดแล้ว (deleted_at)</span>
        ),
    },
  ];

  return (
    <div style={{ minHeight: "100dvh", background: "#fafafa", fontFamily: "var(--font-sans, system-ui, sans-serif)", color: "#1c1c1c", display: "flex", flexDirection: "column" }}>
      {/* เปิดความสามารถภายใน DNA OS — ไม่บังคับออกนอกเว็บแอป */}
      <header style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid #e6e6e6", background: "#fff" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 650 }}>DNA OS — ตารางข้อมูลวัสดุ (โฮสต์ใน Workspace เดียว · STEP 1)</div>
          <div style={{ fontSize: 11, color: "#767676" }}>
            ข้อมูลจริงผ่าน API เดิม <code>/api/admin/pits</code> · ไม่มี Engine/ตารางข้อมูลใหม่ · ชนชั้น BizTable เดิม
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={closeView}
            style={{ fontSize: 13, padding: "6px 12px", borderRadius: 8, border: "1px solid #d9d9d9", background: "#fff", cursor: "pointer" }}
            title="ปิดมุมมองตาราง — กลับจุดเปิดล่าสุด (หน้าจอหลัก)"
          >
            ปิดมุมมอง
          </button>
          <Link
            href={backHref}
            style={{ fontSize: 13, padding: "6px 12px", borderRadius: 8, background: "#1c1c1c", color: "#fff", textDecoration: "none" }}
            title="กลับหน้าจอหลัก (กล่องข้อความล่าง+ไอคอนหลักตำแหน่งเดิม)"
          >
            ← กลับสู่หน้าจอหลัก
          </Link>
        </div>
      </header>

      <main style={{ flex: 1, padding: 18 }}>
        <BizTable<PitRow>
          columns={columns}
          rows={rows}
          getKey={(r) => r.id}
          searchText={(r) => `${r.name} ${r.address ?? ""} ${r.business_type_label} ${r.materials.map((m) => m.name).join(" ")}`}
          busy={busy}
          error={error}
          canEdit={false}
          editing={null}
          onEditingChange={NOOP}
          onSave={NOOP}
          onRefresh={() => void load()}
          onAdd={null}
          addUnavailableReason="โฮสต์นี้อ่านอย่างเดียว (STEP 1) — การเพิ่ม/แก้ยังใช้ API เดิมที่ /biz (ไม่สร้างสิ่งใหม่ในขั้นนี้)"
          search={search}
          onSearchChange={setSearch}
          filters={{
            label: "ประเภท (ทั้งหมด)",
            value: typeFilter,
            options: [{ value: "", label: "ทั้งหมด" }, ...typeOptions.map((c) => ({ value: c, label: typeLabels[c] ?? c }))],
            accessor: (r) => r.business_type,
          }}
          onFilterChange={setTypeFilter}
          emptyText="ยังไม่มีบ่อ/แพล้นท์ในฐานข้อมูลจริง (อ่านผ่าน API เดิม)"
        />
      </main>

      <footer style={{ padding: "10px 18px", borderTop: "1px solid #e6e6e6", background: "#fff", fontSize: 11, color: "#767676" }}>
        กล่องข้อความด้านล่าง + ไอคอนควบคุมหลัก อยู่ที่หน้าจอหลัก <Link href={backHref} style={{ color: "#1c6fd0" }}>{backHref}</Link> ตำแหน่งเดิมทุกพิกเซล (ไฟล์นี้ไม่แตะ shell)
      </footer>
    </div>
  );
}
