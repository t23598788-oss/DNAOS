"use client";

import { useState, useEffect, useCallback } from "react";
import { dispatch } from "@/lib/router";
import { supabase } from "@/lib/supabase/queries";

// ---- Types ----
interface Item {
  id: string; name: string; lat?: number; lng?: number;
  materials?: string[]; prices?: Record<string, number>;
  phone?: string; address?: string; distance_km?: number;
  [key: string]: unknown;
}
interface QuoteData {
  distance_km: number; trips: number; material_cost: number;
  fuel_cost: number; driver_wage: number; total_cost: number;
  selling_price: number; profit: number; vat: number;
}

// ---- Styles ----
const Z = { border: "1px solid #1a1a1a", borderRadius: 12, padding: 16, background: "#0a0a0a" } as const;
const B = { padding: "8px 14px", borderRadius: 8, border: "1px solid #333", background: "#111", color: "#eee", cursor: "pointer", fontSize: 13 } as const;
const BG = { ...B, background: "#22c55e", color: "#000", border: "none", fontWeight: 600 } as const;
const I = { padding: "8px 12px", fontSize: 13, border: "1px solid #333", borderRadius: 6, background: "#111", color: "#eee", width: "100%" } as const;

export default function OpsPage() {
  // State
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [message, setMessage] = useState("");
  const [mLat, setMLat] = useState("16.4314");
  const [mLng, setMLng] = useState("102.8350");
  const [qty, setQty] = useState("100");
  const [quote, setQuote] = useState<QuoteData | null>(null);

  // Resource edit
  const [editField, setEditField] = useState<"price" | "phone" | "gps" | "material" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editValue2, setEditValue2] = useState("");
  const [saving, setSaving] = useState(false);

  // Inbox
  const [inboxText, setInboxText] = useState("");

  // ── Auto-calc when selected/qty/lat/lng changes ──
  useEffect(() => {
    if (!selected) return;
    const dist = selected.distance_km ?? 15;
    const trips = Math.ceil(Number(qty || 1) / 10);
    const matPrice = selected.prices ? Math.min(...Object.values(selected.prices)) : 50;
    const mc = Number(qty || 0) * matPrice;
    const fc = Math.round(dist * 2 / 6.5 * 43 * trips);
    const dw = 450 * trips;
    const tc = mc + fc + dw;
    const sp = Math.round(tc * 1.25);
    setQuote({ distance_km: dist, trips, material_cost: mc, fuel_cost: fc, driver_wage: dw, total_cost: tc, selling_price: sp, profit: sp - tc, vat: Math.round(sp * 7 / 107) });
  }, [selected, qty, mLat, mLng]);

  // ── Zone 1: Search ──
  async function search() {
    if (!input.trim() || loading) return;
    setLoading(true); setMessage("");
    try {
      const ai = await (await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: input, engine: "openai" }) })).json();
      if (ai.ok && ai.command) {
        const cmd = ai.command;
        if (cmd.action.includes("find")) {
          const d = cmd.action.split(".")[0];
          const kw = cmd.payload?.name ?? cmd.payload?.keyword ?? "";
          const f = await (await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "find", domain: d, keyword: kw, question: input }) })).json();
          if (f.ok && f.record) {
            const e = f.record.enriched ?? f.record.results ?? (Array.isArray(f.record) ? f.record : [f.record]);
            setResults(Array.isArray(e) ? e.map(mapItem) : [mapItem(e)]);
            setMessage(`${Array.isArray(e) ? e.length : 1} ผลลัพธ์${f.record.rank?.explain ? ` — ${f.record.rank.explain}` : ""}`);
          } else { setResults([]); setMessage(f.error ?? "ไม่พบ"); }
        } else {
          const r = await dispatch(cmd);
          if (r.ok && r.data) {
            const a = Array.isArray(r.data) ? r.data : [r.data];
            setResults(a.map(mapItem));
            setMessage(`${a.length} ผลลัพธ์`);
          } else { setResults([]); setMessage(r.error ?? "ไม่พบ"); }
        }
      }
    } catch { setMessage("เชื่อมต่อไม่ได้"); }
    finally { setLoading(false); }
  }

  function mapItem(r: Record<string, unknown>): Item {
    return {
      id: String(r.id ?? r.pit_id ?? r.partner_id ?? ""),
      name: String(r.name ?? r.pit_name ?? r.customer_name ?? r.party_name ?? r.document_number ?? r.project_name ?? "-"),
      lat: r.lat ? Number(r.lat) : r.latitude ? Number(r.latitude) : undefined,
      lng: r.lng ? Number(r.lng) : r.longitude ? Number(r.longitude) : undefined,
      materials: r.materials as string[] | undefined,
      prices: r.prices as Record<string, number> | undefined,
      phone: r.phone ? String(r.phone) : undefined,
      address: r.address ? String(r.address) : undefined,
      distance_km: r.distance_km ? Number(r.distance_km) : undefined,
    };
  }

  function selectItem(item: Item) {
    setSelected(item);
    if (item.lat) setMLat(String(item.lat));
    if (item.lng) setMLng(String(item.lng));
    setEditField(null);
  }

  // ── Current Location ──
  function useCurrentLocation() {
    navigator.geolocation?.getCurrentPosition((pos) => {
      setMLat(pos.coords.latitude.toFixed(6));
      setMLng(pos.coords.longitude.toFixed(6));
    });
  }

  // ── Zone 3: Save data ──
  async function saveEdit() {
    if (!selected || !editField) return;
    setSaving(true);
    try {
      const table = selected.lat !== undefined ? "pit_profiles" : "partners";
      let update: Record<string, unknown> = {};

      if (editField === "phone") update = { phone: editValue };
      if (editField === "gps") update = { latitude: Number(editValue), longitude: Number(editValue2) };
      if (editField === "price" && editValue && editValue2) {
        const { data: matType } = await supabase().from("material_types").select("id").ilike("name", `%${editValue}%`).limit(1).maybeSingle();
        if (matType) {
          await supabase().from("pit_materials").insert({ pit_profile_id: selected.id, material_type_id: matType.id, price: Number(editValue2) });
          setMessage(`เพิ่มราคา ${editValue} = ${editValue2} บาท/คิว`);
          setSaving(false); setEditField(null); return;
        } else { setMessage("ไม่พบวัสดุชื่อนี้"); setSaving(false); return; }
      }

      if (Object.keys(update).length > 0) {
        await supabase().from(table).update(update).eq("id", selected.id);
        setMessage(`อัพเดท ${editField} สำเร็จ`);
      }
    } catch (e) { setMessage("บันทึกไม่สำเร็จ"); }
    finally { setSaving(false); setEditField(null); }
  }

  // ── Inbox: process text ──
  async function processInbox() {
    if (!inboxText.trim()) return;
    setInput(inboxText);
    setInboxText("");
    setTimeout(() => search(), 100);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#eee", display: "flex" }}>

      {/* ===== Main Content ===== */}
      <div style={{ flex: 1, padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>

        {/* Header */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20 }}>DNA OS — Control Console</h1>
            <p style={{ color: "#555", margin: 0, fontSize: 12 }}>Search → Select → Calculate → Execute</p>
          </div>
          <span style={{ padding: "4px 12px", borderRadius: 12, background: "#22c55e22", color: "#22c55e", fontSize: 11 }}>Operations</span>
        </header>

        {/* Command Bar */}
        <div style={{ display: "flex", gap: 8 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="พิมพ์อะไรก็ได้ เช่น โรงโม่หิน, ท่าทราย, ลูกหนี้, ใบแจ้งหนี้ราคาถูกสุด" style={{ ...I, flex: 1, fontSize: 15 }} />
          <button onClick={search} disabled={loading} style={BG}>{loading ? "ค้น..." : "ค้นหา"}</button>
        </div>

        {message && <p style={{ color: "#888", margin: 0, fontSize: 12 }}>{message}</p>}

        {/* Zone 1: Search Cards */}
        <div style={{ ...Z, maxHeight: 240, overflow: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 8 }}>
            {results.length === 0 && <p style={{ color: "#333", fontSize: 13 }}>ค้นหาเพื่อแสดงผลลัพธ์</p>}
            {results.map((r, i) => (
              <div key={r.id || i} onClick={() => selectItem(r)} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${selected?.id === r.id ? "#22c55e" : "#222"}`, background: selected?.id === r.id ? "#0a1a0a" : "#111", cursor: "pointer" }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: selected?.id === r.id ? "#22c55e" : "#eee" }}>{r.name}</div>
                <div style={{ fontSize: 11, color: "#666", display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                  {r.distance_km && <span>{r.distance_km} กม.</span>}
                  {r.phone && r.phone !== "-" && <span>tel:{r.phone}</span>}
                  {r.address && r.address !== "-" && <span>{r.address.substring(0, 30)}</span>}
                </div>
                {r.materials && <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 2 }}>{r.materials.join(", ")}</div>}
                {r.prices && <div style={{ fontSize: 11, color: "#22c55e", marginTop: 1 }}>{Object.entries(r.prices).map(([k, v]) => `${k}:${v}฿`).join(" ")}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Zone 2 + 3 + 4 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>

          {/* Zone 2: Mission */}
          <div style={Z}>
            <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>MISSION / GPS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={mLat} onChange={(e) => setMLat(e.target.value)} placeholder="Lat" style={{ ...I, flex: 1 }} />
                <input value={mLng} onChange={(e) => setMLng(e.target.value)} placeholder="Lng" style={{ ...I, flex: 1 }} />
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={useCurrentLocation} style={{ ...B, fontSize: 11, flex: 1 }}>ใช้ตำแหน่งปัจจุบัน</button>
                <button onClick={() => selected?.lat && window.open(`https://maps.google.com/?q=${mLat},${mLng}`, "_blank")} style={{ ...B, fontSize: 11, flex: 1 }}>เปิดแผนที่</button>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="จำนวน" style={{ ...I, flex: 1 }} />
                <span style={{ fontSize: 12, color: "#666" }}>คิว</span>
              </div>
              {selected && (
                <div style={{ padding: 8, background: "#0f0f0f", borderRadius: 6, fontSize: 11 }}>
                  <div style={{ color: "#22c55e", fontWeight: 600 }}>{selected.name}</div>
                  {selected.distance_km && <div style={{ color: "#666" }}>{selected.distance_km} กม.</div>}
                </div>
              )}
            </div>
          </div>

          {/* Zone 4: Calculator */}
          <div style={Z}>
            <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>CALCULATOR</div>
            {quote ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                {[
                  ["ระยะทาง", `${quote.distance_km} กม.`, "#888"],
                  ["เที่ยว", `${quote.trips} เที่ยว`, "#888"],
                  [null],
                  ["ค่าวัสดุ", `${quote.material_cost.toLocaleString()} ฿`, "#888"],
                  ["ค่าน้ำมัน", `${quote.fuel_cost.toLocaleString()} ฿`, "#888"],
                  ["ค่าแรง", `${quote.driver_wage.toLocaleString()} ฿`, "#888"],
                  [null],
                  ["ต้นทุน", `${quote.total_cost.toLocaleString()} ฿`, "#f87171"],
                  ["ราคาขาย", `${quote.selling_price.toLocaleString()} ฿`, "#22c55e"],
                  ["VAT", `${quote.vat.toLocaleString()} ฿`, "#888"],
                  ["กำไร", `${quote.profit.toLocaleString()} ฿`, "#f59e0b"],
                ].map((row, i) => row[0] === null
                  ? <div key={i} style={{ borderTop: "1px solid #1a1a1a", margin: "2px 0" }} />
                  : <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#666" }}>{row[0]}</span>
                      <span style={{ color: row[2] as string, fontWeight: row[0] === "กำไร" || row[0] === "ราคาขาย" || row[0] === "ต้นทุน" ? 600 : 400 }}>{row[1]}</span>
                    </div>
                )}
              </div>
            ) : <p style={{ color: "#333", fontSize: 12 }}>เลือกรายการจากผลค้นหา</p>}
          </div>

          {/* Zone 3: Resource */}
          <div style={Z}>
            <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>RESOURCE</div>
            {selected ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {/* Status indicators */}
                {[
                  { ok: !!selected.prices, label: "ราคาวัสดุ", field: "price" as const },
                  { ok: !!selected.phone && selected.phone !== "-", label: "เบอร์โทร", field: "phone" as const },
                  { ok: !!selected.lat, label: "พิกัด GPS", field: "gps" as const },
                ].map((s) => (
                  <div key={s.field} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", borderRadius: 6, background: s.ok ? "#001a0033" : "#1a000033", border: `1px solid ${s.ok ? "#22c55e22" : "#f8717122"}` }}>
                    <span style={{ fontSize: 11, color: s.ok ? "#22c55e" : "#f87171" }}>{s.ok ? "✓" : "✗"} {s.label}</span>
                    <button onClick={() => { setEditField(s.field); setEditValue(""); setEditValue2(""); }} style={{ ...B, fontSize: 10, padding: "4px 8px" }}>{s.ok ? "แก้ไข" : "เพิ่ม"}</button>
                  </div>
                ))}

                {/* Edit Form */}
                {editField && (
                  <div style={{ padding: 10, background: "#111", borderRadius: 8, border: "1px solid #333" }}>
                    <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 6 }}>
                      {editField === "price" ? "เพิ่มราคาวัสดุ" : editField === "phone" ? "แก้เบอร์โทร" : "แก้พิกัด GPS"}
                    </div>
                    {editField === "price" && (
                      <>
                        <input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="ชื่อวัสดุ เช่น ดินถม" style={{ ...I, marginBottom: 4 }} />
                        <input value={editValue2} onChange={(e) => setEditValue2(e.target.value)} placeholder="ราคา บาท/คิว" style={I} />
                      </>
                    )}
                    {editField === "phone" && <input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="เบอร์โทร" style={I} />}
                    {editField === "gps" && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="Lat" style={{ ...I, flex: 1 }} />
                        <input value={editValue2} onChange={(e) => setEditValue2(e.target.value)} placeholder="Lng" style={{ ...I, flex: 1 }} />
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button onClick={saveEdit} disabled={saving} style={{ ...BG, flex: 1, fontSize: 11 }}>{saving ? "บันทึก..." : "บันทึก"}</button>
                      <button onClick={() => setEditField(null)} style={{ ...B, fontSize: 11 }}>ยกเลิก</button>
                    </div>
                  </div>
                )}
              </div>
            ) : <p style={{ color: "#333", fontSize: 12 }}>เลือกรายการจากผลค้นหา</p>}
          </div>
        </div>

        {/* Zone 5: Actions */}
        <div style={{ ...Z, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button style={B} onClick={() => selected?.lat && window.open(`https://maps.google.com/?q=${selected.lat},${selected.lng}`, "_blank")} disabled={!selected?.lat}>แผนที่</button>
          <button style={B} onClick={() => selected?.phone && (window.location.href = `tel:${selected.phone}`)} disabled={!selected?.phone}>โทร {selected?.phone ?? ""}</button>
          <button style={B} onClick={() => window.location.href = "line://"}>LINE</button>
          <button style={B} disabled={!quote}>สร้าง BOQ</button>
          <button style={B} disabled={!quote}>สร้าง PO</button>
          <button style={B} disabled={!quote}>สร้าง DO</button>
          <button style={B} disabled={!quote}>สร้าง Invoice</button>
        </div>
      </div>

      {/* ===== Inbox Sidebar ===== */}
      <div style={{ width: 280, borderLeft: "1px solid #1a1a1a", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 12, color: "#555" }}>INBOX</div>

        <textarea
          value={inboxText}
          onChange={(e) => setInboxText(e.target.value)}
          placeholder={"วางข้อมูลที่นี่\n\nเช่น:\n- ข้อความจาก LINE\n- พิกัด GPS\n- ราคาวัสดุ\n- เบอร์โทร\n- ชื่อโรงโม่"}
          style={{ ...I, flex: 1, minHeight: 200, resize: "none", fontSize: 12 }}
        />

        <button onClick={processInbox} style={BG} disabled={!inboxText.trim()}>ประมวลผล</button>

        <div style={{ fontSize: 11, color: "#333" }}>
          รับข้อมูลจาก:
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            {["LINE", "GPS", "รูปภาพ", "PDF", "เสียง"].map((s) => (
              <span key={s} style={{ padding: "2px 8px", borderRadius: 4, background: "#111", border: "1px solid #222", fontSize: 10, color: "#555" }}>{s}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
