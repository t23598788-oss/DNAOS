"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * PARTNER PORTAL — seller / resource-owner surface (2026-10-19).
 *
 * This is NOT a new business system: every read/write goes through the existing
 * /api/public/resources service (pit_profiles + pit_materials + material_types)
 * and its ownership gate (pit_profiles.user_id === caller). The page only makes
 * those already-built capabilities reachable for the `partner` role.
 */

type MaterialType = { id: string; name: string };
type SiteMaterial = { material_type_id: string; material: string; price: number | null };
type Site = {
  id: string;
  pit_name: string;
  address: string | null;
  latitude: number | string;
  longitude: number | string;
  is_open: boolean | null;
  materials: SiteMaterial[];
};

type ApiResult = { ok?: boolean; error?: string; sites?: Site[]; materials?: MaterialType[]; pit_id?: string };

const card = "bg-stone-950 border border-stone-800 rounded-xl p-5";
const label = "block text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-1";
const input = "w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-stone-500 focus:outline-none";
const button = "rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40";
const ghost = "rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold text-stone-300 hover:bg-stone-900 disabled:opacity-40";

export function PartnerPortal() {
  const [sites, setSites] = useState<Site[]>([]);
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [siteName, setSiteName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [sitePhone, setSitePhone] = useState("");
  const [siteLat, setSiteLat] = useState("");
  const [siteLng, setSiteLng] = useState("");

  const [selectedSite, setSelectedSite] = useState("");
  const [materialTypeId, setMaterialTypeId] = useState("");
  const [price, setPrice] = useState("");
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});

  // Fetch + all state updates live in the promise callbacks (same pattern as
  // app/biz/_lib/PitsByTypeView.tsx) so the mount effect never sets state
  // synchronously — react-hooks/set-state-in-effect stays satisfied.
  const load = useCallback(() => {
    Promise.all([
      fetch("/api/public/resources?action=mine", { cache: "no-store" }),
      fetch("/api/public/resources?action=materials", { cache: "no-store" }),
    ])
      .then(async ([mineRes, typesRes]) => {
        const mine = (await mineRes.json().catch(() => ({}))) as ApiResult;
        const types = (await typesRes.json().catch(() => ({}))) as ApiResult;
        if (!mineRes.ok || mine.ok === false) throw new Error(mine.error ?? "อ่านทรัพยากรของคุณไม่สำเร็จ");
        const list = Array.isArray(mine.sites) ? mine.sites : [];
        setSites(list);
        setSelectedSite((current) => (current && list.some((s) => s.id === current) ? current : (list[0]?.id ?? "")));
        setMaterialTypes(Array.isArray(types.materials) ? types.materials : []);
      })
      .catch((e: Error) => setError(e.message || "เชื่อมต่อระบบไม่ได้"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function post(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/public/resources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as ApiResult;
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "บันทึกไม่สำเร็จ");
      setNotice(success);
      load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addSite() {
    const lat = Number(siteLat);
    const lng = Number(siteLng);
    if (!siteName.trim()) return setError("ต้องระบุชื่อแหล่ง/โกดัง");
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      return setError("ต้องระบุพิกัด GPS จริง (ไม่รับ 0,0)");
    }
    const ok = await post(
      {
        action: "create_my_site",
        pit_name: siteName.trim(),
        address: siteAddress.trim() || undefined,
        phone: sitePhone.trim() || undefined,
        latitude: lat,
        longitude: lng,
        is_open: true,
      },
      "เพิ่มแหล่งทรัพยากรแล้ว",
    );
    if (ok) {
      setSiteName("");
      setSiteAddress("");
      setSitePhone("");
      setSiteLat("");
      setSiteLng("");
    }
  }

  async function addMaterial() {
    if (!selectedSite) return setError("เลือกแหล่งทรัพยากรก่อน");
    if (!materialTypeId) return setError("เลือกวัสดุก่อน");
    const value = price.trim() ? Number(price) : null;
    if (value !== null && (!Number.isFinite(value) || value <= 0)) return setError("ราคาต้องมากกว่า 0");
    const ok = await post(
      { action: "add_material", pit_id: selectedSite, material_type_id: materialTypeId, price: value },
      "เพิ่มวัสดุ/ราคาแล้ว",
    );
    if (ok) {
      setPrice("");
      setMaterialTypeId("");
    }
  }

  async function savePrice(site: Site, material: SiteMaterial) {
    const key = `${site.id}:${material.material_type_id}`;
    const raw = priceDraft[key] ?? String(material.price ?? "");
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return setError("ราคาต้องมากกว่า 0");
    const ok = await post(
      { action: "update_price", pit_id: site.id, material_type_id: material.material_type_id, price: value },
      "แก้ราคาแล้ว",
    );
    if (ok) setPriceDraft((d) => ({ ...d, [key]: "" }));
  }

  async function toggleOpen(site: Site) {
    await post(
      { action: "update_my_site", pit_id: site.id, is_open: !(site.is_open ?? true) },
      site.is_open === false ? "เปิดรับลูกค้าแล้ว" : "ปิดรับลูกค้าแล้ว",
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">ทรัพยากรของฉัน</h2>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">
            แหล่งผลิต/โกดัง วัสดุ และราคาที่คุณลงทะเบียนไว้ — ลูกค้าค้นหาได้จากหน้าทะเบียนสาธารณะ
          </p>
        </div>
        <div className="flex gap-2">
          <a className={ghost} href="/pub" target="_blank" rel="noreferrer">ดูหน้าสาธารณะ</a>
          <a className={ghost} href="/transporter">งานขนส่งของฉัน</a>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300">{notice}</p>}

      <section className={`${card} space-y-3`}>
        <h3 className="text-sm font-semibold text-white">เพิ่มแหล่งทรัพยากร</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label><span className={label}>ชื่อแหล่ง/โกดัง *</span><input className={input} value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="เช่น บ่อหินลาดยาว" /></label>
          <label><span className={label}>ที่อยู่</span><input className={input} value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} placeholder="ตำบล/อำเภอ/จังหวัด" /></label>
          <label><span className={label}>โทรศัพท์</span><input className={input} value={sitePhone} onChange={(e) => setSitePhone(e.target.value)} inputMode="tel" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label><span className={label}>ละติจูด *</span><input className={input} value={siteLat} onChange={(e) => setSiteLat(e.target.value)} inputMode="decimal" placeholder="13.9" /></label>
            <label><span className={label}>ลองจิจูด *</span><input className={input} value={siteLng} onChange={(e) => setSiteLng(e.target.value)} inputMode="decimal" placeholder="100.5" /></label>
          </div>
        </div>
        <p className="text-[11px] text-stone-600">พิกัดต้องมาจากแผนที่/อุปกรณ์จริง ระบบไม่เดาพิกัดให้</p>
        <button className={button} type="button" disabled={busy} onClick={() => void addSite()}>บันทึกแหล่งทรัพยากร</button>
      </section>

      <section className={`${card} space-y-3`}>
        <h3 className="text-sm font-semibold text-white">เพิ่มวัสดุและราคา</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label>
            <span className={label}>แหล่งทรัพยากร</span>
            <select className={input} value={selectedSite} onChange={(e) => setSelectedSite(e.target.value)}>
              <option value="">— เลือก —</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.pit_name}</option>)}
            </select>
          </label>
          <label>
            <span className={label}>วัสดุ</span>
            <select className={input} value={materialTypeId} onChange={(e) => setMaterialTypeId(e.target.value)}>
              <option value="">— เลือก —</option>
              {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label><span className={label}>ราคา/หน่วย (บาท)</span><input className={input} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="เช่น 380" /></label>
        </div>
        <button className={button} type="button" disabled={busy} onClick={() => void addMaterial()}>เพิ่มวัสดุ/ราคา</button>
      </section>

      {loading ? (
        <p className="text-xs text-stone-500">กำลังโหลดทรัพยากรของคุณ…</p>
      ) : sites.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-800 px-4 py-6 text-sm text-stone-500">
          ยังไม่มีแหล่งทรัพยากร — เพิ่มแหล่งแรกด้านบน แล้วจึงลงวัสดุ/ราคา
        </p>
      ) : (
        <div className="space-y-4">
          {sites.map((site) => (
            <article key={site.id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">{site.pit_name}</h3>
                  <p className="mt-1 text-[11px] text-stone-500">
                    {site.address || "ไม่ระบุที่อยู่"} · {Number(site.latitude)}, {Number(site.longitude)}
                  </p>
                </div>
                <button className={ghost} type="button" disabled={busy} onClick={() => void toggleOpen(site)}>
                  {site.is_open === false ? "เปิดรับลูกค้า" : "ปิดรับลูกค้า"}
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {site.materials.length === 0 ? (
                  <p className="text-xs text-stone-600">ยังไม่มีวัสดุ/ราคาในแหล่งนี้</p>
                ) : site.materials.map((m) => {
                  const key = `${site.id}:${m.material_type_id}`;
                  return (
                    <div key={key} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-800 bg-stone-900/40 px-3 py-2">
                      <span className="min-w-32 flex-1 text-xs text-stone-200">{m.material}</span>
                      <span className="text-xs text-stone-400">{m.price != null ? `${m.price} บาท` : "ยังไม่ระบุราคา"}</span>
                      <input
                        className="w-24 rounded-lg border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-100"
                        value={priceDraft[key] ?? ""}
                        onChange={(e) => setPriceDraft((d) => ({ ...d, [key]: e.target.value }))}
                        placeholder="ราคาใหม่"
                        inputMode="decimal"
                      />
                      <button className={button} type="button" disabled={busy || !(priceDraft[key] ?? "").trim()} onClick={() => void savePrice(site, m)}>
                        แก้ราคา
                      </button>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
