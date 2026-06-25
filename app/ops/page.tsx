"use client";

import { useState } from "react";
import { dispatch } from "@/lib/router";

interface Item {
  id: string; name: string; lat?: number; lng?: number;
  materials?: string[]; prices?: Record<string, number>;
  phone?: string; address?: string; distance_km?: number;
  [key: string]: unknown;
}

interface TracedValue {
  label: string; value: number | string; unit: string;
  source: string; formula: string; timestamp: string;
}

const Z = { border: "1px solid #1a1a1a", borderRadius: 12, padding: 16, background: "#0a0a0a" } as const;
const B = { padding: "8px 14px", borderRadius: 8, border: "1px solid #333", background: "#111", color: "#eee", cursor: "pointer", fontSize: 13 } as const;
const BG = { ...B, background: "#22c55e", color: "#000", border: "none", fontWeight: 600 } as const;
const I = { padding: "8px 12px", fontSize: 13, border: "1px solid #333", borderRadius: 6, background: "#111", color: "#eee", width: "100%" } as const;

export default function OpsPage() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [message, setMessage] = useState("");
  const [mLat, setMLat] = useState("16.4314");
  const [mLng, setMLng] = useState("102.8350");
  const [qty, setQty] = useState("100");
  const [trace, setTrace] = useState<TracedValue[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [expandedTrace, setExpandedTrace] = useState<number | null>(null);

  // ── Search ──
  async function search() {
    if (!input.trim() || loading) return;
    setLoading(true); setMessage(""); setTrace([]);
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

  // ── Explainable Calculate ──
  async function explainCalc() {
    if (!selected) return;
    setTraceLoading(true);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pit_id: selected.id, site_lat: Number(mLat), site_lng: Number(mLng), quantity: Number(qty) }),
      });
      const data = await res.json();
      if (data.ok) { setTrace(data.items); }
      else { setMessage(data.error ?? "คำนวณไม่ได้"); }
    } catch { setMessage("เชื่อมต่อไม่ได้"); }
    finally { setTraceLoading(false); }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#eee", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Header */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>DNA OS — Control Console</h1>
          <p style={{ color: "#555", margin: 0, fontSize: 12 }}>V5 Read + Analyze + Explain (ไม่เขียน DB)</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ padding: "3px 10px", borderRadius: 10, background: "#22c55e22", color: "#22c55e", fontSize: 11 }}>V5 Read-Only</span>
          <span style={{ padding: "3px 10px", borderRadius: 10, background: "#333", color: "#666", fontSize: 11 }}>V6 Write (รอ)</span>
        </div>
      </header>

      {/* Command */}
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="พิมพ์อะไรก็ได้ เช่น โรงโม่หิน, ท่าทราย, ลูกหนี้, ใบแจ้งหนี้" style={{ ...I, flex: 1, fontSize: 15 }} />
        <button onClick={search} disabled={loading} style={BG}>{loading ? "ค้น..." : "ค้นหา"}</button>
      </div>

      {message && <p style={{ color: "#888", margin: 0, fontSize: 12 }}>{message}</p>}

      {/* Zone 1: Cards */}
      <div style={{ ...Z, maxHeight: 220, overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 8 }}>
          {results.length === 0 && <p style={{ color: "#333", fontSize: 13 }}>ค้นหาเพื่อแสดงผลลัพธ์</p>}
          {results.map((r, i) => (
            <div key={r.id || i} onClick={() => { setSelected(r); setTrace([]); setExpandedTrace(null); }} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${selected?.id === r.id ? "#22c55e" : "#222"}`, background: selected?.id === r.id ? "#0a1a0a" : "#111", cursor: "pointer" }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: selected?.id === r.id ? "#22c55e" : "#eee" }}>{r.name}</div>
              <div style={{ fontSize: 11, color: "#666", display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                {r.distance_km && <span>{r.distance_km} กม.</span>}
                {r.phone && r.phone !== "-" && <span>{r.phone}</span>}
              </div>
              {r.materials && <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 2 }}>{r.materials.join(", ")}</div>}
              {r.prices && <div style={{ fontSize: 11, color: "#22c55e" }}>{Object.entries(r.prices).map(([k, v]) => `${k}:${v}฿`).join(" ")}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Zone 2: Mission + Calculate */}
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 12 }}>
        <div style={Z}>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>MISSION</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={mLat} onChange={(e) => setMLat(e.target.value)} placeholder="Lat" style={{ ...I, flex: 1 }} />
              <input value={mLng} onChange={(e) => setMLng(e.target.value)} placeholder="Lng" style={{ ...I, flex: 1 }} />
            </div>
            <button onClick={() => navigator.geolocation?.getCurrentPosition((p) => { setMLat(p.coords.latitude.toFixed(6)); setMLng(p.coords.longitude.toFixed(6)); })} style={{ ...B, fontSize: 11 }}>ใช้ตำแหน่งปัจจุบัน</button>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="จำนวน" style={{ ...I, flex: 1 }} />
              <span style={{ fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>คิว</span>
            </div>
            <button onClick={explainCalc} disabled={!selected || traceLoading} style={selected ? BG : B}>
              {traceLoading ? "กำลังคำนวณ..." : selected ? "คำนวณ + อธิบาย" : "เลือกรายการก่อน"}
            </button>
          </div>
        </div>

        {/* Zone 4: Explainable Calculator */}
        <div style={Z}>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>EXPLAINABLE CALCULATOR</div>
          {trace.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {trace.map((t, i) => {
                const isKey = ["ต้นทุนรวม", "ราคาขาย", "กำไร"].includes(t.label);
                const color = t.label === "ต้นทุนรวม" ? "#f87171" : t.label === "ราคาขาย" ? "#22c55e" : t.label === "กำไร" ? "#f59e0b" : "#ccc";
                const isSep = t.label === "ต้นทุนรวม" || t.label === "Markup";

                return (
                  <div key={i}>
                    {isSep && <div style={{ borderTop: "1px solid #222", margin: "4px 0" }} />}
                    <div
                      onClick={() => setExpandedTrace(expandedTrace === i ? null : i)}
                      style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px", borderRadius: 6, cursor: "pointer", background: expandedTrace === i ? "#111" : "transparent" }}
                    >
                      <span style={{ fontSize: 12, color: isKey ? color : "#888", fontWeight: isKey ? 600 : 400 }}>{t.label}</span>
                      <span style={{ fontSize: 12, color, fontWeight: isKey ? 600 : 400 }}>
                        {typeof t.value === "number" ? t.value.toLocaleString() : t.value} {t.unit}
                      </span>
                    </div>

                    {/* Trace detail */}
                    {expandedTrace === i && (
                      <div style={{ padding: "6px 8px 6px 16px", fontSize: 11, color: "#555", background: "#0f0f0f", borderRadius: 6, marginBottom: 2 }}>
                        <div><span style={{ color: "#f59e0b" }}>Source:</span> {t.source}</div>
                        <div><span style={{ color: "#22c55e" }}>Formula:</span> {t.formula}</div>
                        <div><span style={{ color: "#888" }}>Updated:</span> {t.timestamp.substring(0, 19)}</div>
                      </div>
                    )}
                  </div>
                );
              })}
              <p style={{ fontSize: 10, color: "#333", marginTop: 8 }}>กดที่แต่ละรายการเพื่อดู Source + Formula + Timestamp</p>
            </div>
          ) : (
            <p style={{ color: "#333", fontSize: 12 }}>เลือกรายการ → ใส่จำนวน → กด "คำนวณ + อธิบาย"</p>
          )}
        </div>
      </div>

      {/* Zone 5: Actions (read-only safe) */}
      <div style={{ ...Z, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button style={B} onClick={() => selected?.lat && window.open(`https://maps.google.com/?q=${selected.lat},${selected.lng}`, "_blank")} disabled={!selected?.lat}>เปิดแผนที่</button>
        <button style={B} onClick={() => selected?.phone && (window.location.href = `tel:${selected.phone}`)} disabled={!selected?.phone}>โทร {selected?.phone ?? ""}</button>
        <button style={B} onClick={() => window.location.href = "line://"}>LINE</button>
        <span style={{ padding: "8px 14px", fontSize: 11, color: "#333" }}>|  V6 (รอ): สร้าง BOQ / PO / DO / แก้ข้อมูล / ลบ</span>
      </div>
    </div>
  );
}
