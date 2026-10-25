"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * BUYER PORTAL (customer) — 2026-10-19.
 *
 * Reuses two existing capabilities, no new business tables:
 *   GET  /api/public/resources?action=public  → published registry (real prices)
 *   POST /api/public/resources { action: "add_demand" } → pit_price_requests
 *
 * The demand path is the seller-quote request (the same row the LINE supplier
 * reply engine already answers); the buyer does not need to own the pit.
 */

type Material = { material_type_id: string; material: string; price: number | null };
type Entry = {
  site_id: string;
  site_name: string;
  address: string | null;
  grid: { latitude?: number; longitude?: number };
  available_materials: Material[];
  publication_state?: string;
  matchable?: boolean;
};
type ApiResult = { ok?: boolean; error?: string; entries?: Entry[]; total?: number };

const card = "bg-stone-950 border border-stone-800 rounded-xl p-5";
const input = "w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-stone-500 focus:outline-none";
const button = "rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-40";

export function BuyerPortal() {
  const [keyword, setKeyword] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});

  const search = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = term.trim() ? `&keyword=${encodeURIComponent(term.trim())}` : "";
      const res = await fetch(`/api/public/resources?action=public${qs}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as ApiResult;
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "ค้นหาทะเบียนไม่สำเร็จ");
      setEntries(Array.isArray(json.entries) ? json.entries : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "เชื่อมต่อระบบไม่ได้");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial read: no synchronous setState in the effect body (initial loading
  // already true); the form uses search() for subsequent queries.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/resources?action=public", { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as ApiResult;
        if (cancelled) return;
        if (!res.ok || json.ok === false) throw new Error(json.error ?? "ค้นหาทะเบียนไม่สำเร็จ");
        setEntries(Array.isArray(json.entries) ? json.entries : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "เชื่อมต่อระบบไม่ได้");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function requestQuote(entry: Entry, material: Material) {
    const key = `${entry.site_id}:${material.material_type_id}`;
    const amount = qty[key]?.trim() ? Number(qty[key]) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
      return setError("จำนวนต้องมากกว่า 0 หรือเว้นว่าง");
    }
    setBusyKey(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/public/resources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "add_demand",
          pit_id: entry.site_id,
          material_type_id: material.material_type_id,
          requested_quantity: amount,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ApiResult;
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "ส่งคำขอราคาไม่สำเร็จ");
      setNotice(`ส่งคำขอราคา ${material.material} ไปยัง ${entry.site_name} แล้ว — การตอบกลับขึ้นกับช่องทางที่ผู้ขายลงทะเบียนไว้ (LINE หรือการอัปเดตราคาในทะเบียน)`);
      setQty((q) => ({ ...q, [key]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "ส่งคำขอราคาไม่สำเร็จ");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white">ค้นหาทรัพยากรและขอราคา</h2>
        <p className="mt-1 text-xs leading-relaxed text-stone-500">
          ข้อมูลจากทะเบียนกลางที่ผู้ขายลงทะเบียนเอง — ราคาที่เห็นมาจากหลักฐานจริงของผู้ขาย ไม่ใช่ราคาที่ระบบเดา
        </p>
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search(keyword);
        }}
      >
        <input className={`${input} max-w-md flex-1`} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="ค้นหาชื่อบ่อ/โกดัง/แหล่งผลิต" />
        <button className={button} type="submit" disabled={loading}>{loading ? "กำลังค้นหา…" : "ค้นหา"}</button>
        <a className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold text-stone-300 hover:bg-stone-900" href="/pub" target="_blank" rel="noreferrer">เปิดทะเบียนสาธารณะ</a>
      </form>

      {error && <p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300">{notice}</p>}

      {loading ? (
        <p className="text-xs text-stone-500">กำลังอ่านทะเบียน…</p>
      ) : entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-800 px-4 py-6 text-sm text-stone-500">
          ยังไม่มีแหล่งที่เผยแพร่ตรงกับการค้นหา — ลองใช้คำอื่น หรือเปิดทะเบียนสาธารณะ
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {entries.map((entry) => {
            const lat = entry.grid?.latitude;
            const lng = entry.grid?.longitude;
            return (
              <article key={entry.site_id} className={card}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{entry.site_name}</h3>
                    <p className="mt-1 text-[11px] text-stone-500">{entry.address || "ไม่ระบุที่อยู่"}</p>
                    {lat && lng ? <p className="mt-1 text-[10px] text-stone-600">พิกัด {lat}, {lng}</p> : null}
                  </div>
                  {entry.publication_state ? (
                    <span className="rounded-full border border-stone-700 px-2 py-0.5 text-[10px] text-stone-400">{entry.publication_state}</span>
                  ) : null}
                </div>

                <div className="mt-4 space-y-2">
                  {entry.available_materials.map((m) => {
                    const key = `${entry.site_id}:${m.material_type_id}`;
                    return (
                      <div key={key} className="rounded-lg border border-stone-800 bg-stone-900/40 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-stone-200">{m.material}</span>
                          <span className="text-xs font-semibold text-emerald-400">{m.price != null ? `${m.price} บาท` : "ไม่ระบุราคา"}</span>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <input
                            className="w-24 rounded-lg border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-100"
                            value={qty[key] ?? ""}
                            onChange={(e) => setQty((q) => ({ ...q, [key]: e.target.value }))}
                            placeholder="จำนวน"
                            inputMode="decimal"
                          />
                          <button className={button} type="button" disabled={busyKey === key} onClick={() => void requestQuote(entry, m)}>
                            {busyKey === key ? "กำลังส่ง…" : "ขอราคา"}
                          </button>
                          {lat && lng ? (
                            <a
                              className="rounded-lg border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900"
                              href={`https://www.google.com/maps?q=${lat},${lng}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              แผนที่
                            </a>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
