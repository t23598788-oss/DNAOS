"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * TRANSPORTER PORTAL — 2026-10-19.
 * Reads the signed-in user's driver_profiles row and only the jobs assigned to
 * it (jobs.assigned_person_id). Profile create/update writes the existing
 * driver_profiles table; no new schema and no state-machine changes.
 */

type VehicleType = { id: string; name: string; load_capacity: number | null };
type DriverProfile = {
  id: string;
  driver_name: string | null;
  phone: string | null;
  vehicle_type_id: string | null;
  vehicle_plate_text: string | null;
  vehicle_plate_province: string | null;
};
type Job = {
  id: string;
  project_name: string | null;
  job_status: string | null;
  start_date: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  site_address: string | null;
  distance_km: number | null;
  required_quantity: number | null;
  delivered_quantity: number | null;
  is_urgent: boolean | null;
};
type ApiResult = {
  ok?: boolean;
  error?: string;
  linked?: boolean;
  profile?: DriverProfile | null;
  jobs?: Job[];
  vehicle_types?: VehicleType[];
};

const card = "bg-stone-950 border border-stone-800 rounded-xl p-5";
const label = "block text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-1";
const input = "w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-stone-500 focus:outline-none";
const button = "rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-40";
const ghost = "rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold text-stone-300 hover:bg-stone-900 disabled:opacity-40";

function statusStyle(status: string | null): string {
  switch (status) {
    case "COMPLETED": return "border-emerald-900 bg-emerald-950/40 text-emerald-300";
    case "IN_PROGRESS": return "border-sky-900 bg-sky-950/40 text-sky-300";
    case "SUSPENDED": return "border-red-900 bg-red-950/40 text-red-300";
    case "PENDING_REVIEW": return "border-amber-900 bg-amber-950/40 text-amber-300";
    default: return "border-stone-700 bg-stone-900/40 text-stone-300";
  }
}

export function TransporterPortal() {
  const [data, setData] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [driverName, setDriverName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicleTypeId, setVehicleTypeId] = useState("");
  const [plate, setPlate] = useState("");
  const [province, setProvince] = useState("");

  // Fetch + all state updates live in the promise callbacks (same pattern as
  // app/biz/_lib/PitsByTypeView.tsx) so the mount effect never sets state
  // synchronously.
  const load = useCallback(() => {
    fetch("/api/public/transporter", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as ApiResult;
        if (!res.ok || json.ok === false) throw new Error(json.error ?? "อ่านข้อมูลผู้ขนส่งไม่สำเร็จ");
        setData(json);
        const p = json.profile;
        setDriverName(p?.driver_name ?? "");
        setPhone(p?.phone ?? "");
        setVehicleTypeId(p?.vehicle_type_id ?? "");
        setPlate(p?.vehicle_plate_text ?? "");
        setProvince(p?.vehicle_plate_province ?? "");
        setEditing(!json.linked);
      })
      .catch((e: Error) => setError(e.message || "เชื่อมต่อระบบไม่ได้"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!driverName.trim()) return setError("ต้องระบุชื่อผู้ขับ");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/public/transporter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save_my_driver_profile",
          driver_name: driverName.trim(),
          phone: phone.trim() || null,
          vehicle_type_id: vehicleTypeId || null,
          vehicle_plate_text: plate.trim() || null,
          vehicle_plate_province: province.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ApiResult;
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "บันทึกโปรไฟล์ไม่สำเร็จ");
      setNotice("บันทึกโปรไฟล์ผู้ขนส่งแล้ว");
      setEditing(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกโปรไฟล์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const jobs = data?.jobs ?? [];
  const vehicleTypes = data?.vehicle_types ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">งานขนส่งของฉัน</h2>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">
            เห็นเฉพาะงานที่ผู้ดูแลมอบหมายให้โปรไฟล์คนขับนี้ — ข้อมูลงานมาจากตาราง jobs เดิม
          </p>
        </div>
        <a className={ghost} href="/partner">กลับไปหน้าทรัพยากร</a>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300">{notice}</p>}

      {loading ? (
        <p className="text-xs text-stone-500">กำลังโหลดโปรไฟล์และงาน…</p>
      ) : (
        <>
          <section className={card}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {data?.linked ? (data.profile?.driver_name || "โปรไฟล์ผู้ขนส่ง") : "ยังไม่ได้ผูกโปรไฟล์ผู้ขนส่ง"}
                </h3>
                <p className="mt-1 text-[11px] text-stone-500">
                  {data?.linked
                    ? `เบอร์ ${data.profile?.phone || "—"} · รถ ${data.profile?.vehicle_plate_text || "—"} ${data.profile?.vehicle_plate_province || ""}`
                    : "กรอกข้อมูลด้านล่างเพื่อให้ผู้ดูแลเห็นและมอบหมายงานให้คุณ"}
                </p>
              </div>
              {data?.linked ? (
                <button className={ghost} type="button" onClick={() => setEditing((v) => !v)}>
                  {editing ? "ปิดฟอร์ม" : "แก้ไขโปรไฟล์"}
                </button>
              ) : null}
            </div>

            {editing ? (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label><span className={label}>ชื่อผู้ขับ *</span><input className={input} value={driverName} onChange={(e) => setDriverName(e.target.value)} /></label>
                <label><span className={label}>โทรศัพท์</span><input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></label>
                <label>
                  <span className={label}>ประเภทรถ</span>
                  <select className={input} value={vehicleTypeId} onChange={(e) => setVehicleTypeId(e.target.value)}>
                    <option value="">— ไม่ระบุ —</option>
                    {vehicleTypes.map((v) => <option key={v.id} value={v.id}>{v.name}{v.load_capacity ? ` (${v.load_capacity})` : ""}</option>)}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label><span className={label}>ทะเบียนรถ</span><input className={input} value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="เช่น 70-1234" /></label>
                  <label><span className={label}>จังหวัด</span><input className={input} value={province} onChange={(e) => setProvince(e.target.value)} placeholder="เช่น กาญจนบุรี" /></label>
                </div>
                <div className="sm:col-span-2">
                  <button className={button} type="button" disabled={busy} onClick={() => void save()}>{busy ? "กำลังบันทึก…" : "บันทึกโปรไฟล์"}</button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-white">งานที่ได้รับมอบหมาย ({jobs.length})</h3>
            {jobs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-stone-800 px-4 py-6 text-sm text-stone-500">
                {data?.linked
                  ? "ยังไม่มีงานที่มอบหมายให้คุณ — ผู้ดูแลจะเป็นผู้มอบหมายงานจากหน้าจัดการงาน"
                  : "ผูกโปรไฟล์ผู้ขนส่งก่อน แล้วผู้ดูแลจึงจะมอบหมายงานให้ได้"}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {jobs.map((job) => (
                  <article key={job.id} className={card}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-semibold text-white">{job.project_name || "งานขนส่ง"}</h4>
                        <p className="mt-1 text-[11px] text-stone-500">{job.site_address || "ไม่ระบุสถานที่"}</p>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusStyle(job.job_status)}`}>{job.job_status || "ไม่ระบุสถานะ"}</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-stone-400">
                      <div><dt className="text-stone-600">วันเริ่ม</dt><dd>{job.start_date || "—"}</dd></div>
                      <div><dt className="text-stone-600">ระยะทาง</dt><dd>{job.distance_km != null ? `${job.distance_km} กม.` : "—"}</dd></div>
                      <div><dt className="text-stone-600">ปริมาณที่ต้องส่ง</dt><dd>{job.required_quantity ?? "—"}</dd></div>
                      <div><dt className="text-stone-600">ส่งแล้ว</dt><dd>{job.delivered_quantity ?? "—"}</dd></div>
                      <div><dt className="text-stone-600">ผู้ติดต่อ</dt><dd>{job.contact_name || "—"}</dd></div>
                      <div><dt className="text-stone-600">โทร</dt><dd>{job.contact_phone || "—"}</dd></div>
                    </dl>
                    {job.is_urgent ? <p className="mt-3 text-[11px] font-semibold text-red-400">งานด่วน</p> : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
