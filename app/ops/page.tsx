"use client";

import { useState, useCallback } from "react";
import type { CommandResult } from "@/types/command";
import { dispatch } from "@/lib/router";

// ---- Types ----
interface SelectedItem {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
  materials?: string[];
  prices?: Record<string, number>;
  phone?: string;
  address?: string;
  distance_km?: number;
}

interface QuoteResult {
  distance_km: number;
  trips: number;
  material_cost: number;
  fuel_cost: number;
  driver_wage: number;
  total_cost: number;
  selling_price: number;
  profit: number;
  vat_amount: number;
}

// ---- Styles ----
const zone = {
  border: "1px solid #1a1a1a",
  borderRadius: 12,
  padding: 16,
  background: "#0a0a0a",
} as const;

const card = {
  padding: "12px 16px",
  borderRadius: 8,
  border: "1px solid #222",
  background: "#111",
  cursor: "pointer",
} as const;

const btn = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "1px solid #333",
  background: "#111",
  color: "#eee",
  cursor: "pointer",
  fontSize: 13,
} as const;

const btnGreen = { ...btn, background: "#22c55e", color: "#000", border: "none", fontWeight: 600 } as const;

export default function OpsPage() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SelectedItem[]>([]);
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [missionLat, setMissionLat] = useState("16.4314");
  const [missionLng, setMissionLng] = useState("102.8350");
  const [quantity, setQuantity] = useState("100");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [message, setMessage] = useState("");

  // ── Zone 1: Search ──
  async function handleSearch() {
    if (!input.trim() || loading) return;
    setLoading(true);
    setMessage("");
    try {
      const aiRes = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input, engine: "openai" }),
      });
      const aiData = await aiRes.json();

      if (aiData.ok && aiData.command) {
        const cmd = aiData.command;
        if (cmd.action.includes("find")) {
          const domain = cmd.action.split(".")[0];
          const keyword = cmd.payload?.name ?? cmd.payload?.keyword ?? "";
          const findRes = await fetch("/api/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "find", domain, keyword, question: input }),
          });
          const findData = await findRes.json();
          if (findData.ok && findData.record) {
            const enriched = findData.record.enriched ?? findData.record.results ?? [];
            const items: SelectedItem[] = (Array.isArray(enriched) ? enriched : [enriched]).map((r: Record<string, unknown>) => ({
              id: String(r.id ?? r.pit_id ?? r.partner_id ?? ""),
              name: String(r.name ?? r.pit_name ?? "-"),
              lat: r.lat ? Number(r.lat) : r.latitude ? Number(r.latitude) : undefined,
              lng: r.lng ? Number(r.lng) : r.longitude ? Number(r.longitude) : undefined,
              materials: r.materials as string[] | undefined,
              prices: r.prices as Record<string, number> | undefined,
              phone: r.phone ? String(r.phone) : undefined,
              address: r.address ? String(r.address) : undefined,
              distance_km: r.distance_km ? Number(r.distance_km) : undefined,
            }));
            setResults(items);
            const rank = findData.record.rank;
            setMessage(rank?.explain ? `${items.length} ผลลัพธ์ — ${rank.explain}` : `${items.length} ผลลัพธ์`);
          } else {
            setResults([]);
            setMessage(findData.error ?? "ไม่พบข้อมูล");
          }
        } else {
          const result = await dispatch(cmd);
          if (result.ok && result.data) {
            const arr = Array.isArray(result.data) ? result.data : [result.data];
            setResults(arr.map((r: Record<string, unknown>) => ({
              id: String(r.id ?? ""),
              name: String(r.customer_name ?? r.party_name ?? r.document_number ?? r.project_name ?? r.name ?? "-"),
              phone: r.phone ? String(r.phone) : r.party_tel ? String(r.party_tel) : undefined,
              address: r.address ? String(r.address) : undefined,
            })));
            setMessage(`${arr.length} ผลลัพธ์`);
          } else {
            setResults([]);
            setMessage(result.error ?? "ไม่พบข้อมูล");
          }
        }
      }
    } catch { setMessage("เชื่อมต่อไม่ได้"); }
    finally { setLoading(false); }
  }

  // ── Zone 4: Calculate ──
  async function handleCalc() {
    if (!selected || calcLoading) return;
    setCalcLoading(true);
    try {
      const res = await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `คำนวณราคา ${quantity} คิว`, engine: "local" }) });
      // Use V3 engine directly via a simple fetch
      const calcRes = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "find",
          domain: "quote",
          keyword: "calc",
          question: input,
          site_lat: Number(missionLat),
          site_lng: Number(missionLng),
          quantity: Number(quantity),
          pit_id: selected.id,
        }),
      });
    } catch {}

    // Fallback: calculate client-side from selected data
    const dist = selected.distance_km ?? 15;
    const trips = Math.ceil(Number(quantity) / 10);
    const matPrice = selected.prices ? Math.min(...Object.values(selected.prices)) : 50;
    const materialCost = Number(quantity) * matPrice;
    const fuelCost = Math.round(dist * 2 / 6.5 * 43 * trips);
    const driverWage = 450 * trips;
    const totalCost = materialCost + fuelCost + driverWage;
    const sellingPrice = Math.round(totalCost * 1.25);
    const profit = sellingPrice - totalCost;
    const vat = Math.round(sellingPrice * 7 / 107);

    setQuote({
      distance_km: dist,
      trips,
      material_cost: materialCost,
      fuel_cost: fuelCost,
      driver_wage: driverWage,
      total_cost: totalCost,
      selling_price: sellingPrice,
      profit,
      vat_amount: vat,
    });
    setCalcLoading(false);
  }

  return (
    <main style={{ minHeight: "100vh", background: "#000", color: "#eee", padding: "16px 32px", display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>DNA OS — Operations Board</h1>
          <p style={{ color: "#666", margin: "2px 0 0", fontSize: 13 }}>Search → Select → Calculate → Execute</p>
        </div>
        <span style={{ padding: "4px 12px", borderRadius: 12, background: "#22c55e22", color: "#22c55e", fontSize: 12 }}>Command Center</span>
      </header>

      {/* Zone 1: Search */}
      <div style={zone}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="พิมพ์อะไรก็ได้ เช่น โรงโม่หิน, ท่าทราย, ลูกหนี้, ใบแจ้งหนี้"
            style={{ flex: 1, padding: "10px 14px", fontSize: 15, border: "1px solid #333", borderRadius: 8, background: "#111", color: "#eee" }}
          />
          <button onClick={handleSearch} disabled={loading} style={btnGreen}>
            {loading ? "กำลังค้น..." : "ค้นหา"}
          </button>
        </div>

        {message && <p style={{ color: "#888", margin: "0 0 8px", fontSize: 13 }}>{message}</p>}

        {/* Result Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, maxHeight: 300, overflow: "auto" }}>
          {results.map((r, i) => (
            <div
              key={r.id || i}
              onClick={() => { setSelected(r); if (r.lat) setMissionLat(String(r.lat)); if (r.lng) setMissionLng(String(r.lng)); }}
              style={{ ...card, borderColor: selected?.id === r.id ? "#22c55e" : "#222" }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, color: selected?.id === r.id ? "#22c55e" : "#eee" }}>{r.name}</div>
              {r.distance_km && <div style={{ fontSize: 12, color: "#888" }}>{r.distance_km} กม.</div>}
              {r.address && r.address !== "-" && <div style={{ fontSize: 12, color: "#666" }}>{r.address}</div>}
              {r.materials && <div style={{ fontSize: 12, color: "#f59e0b" }}>{r.materials.join(", ")}</div>}
              {r.prices && <div style={{ fontSize: 12, color: "#22c55e" }}>{Object.entries(r.prices).map(([k, v]) => `${k}: ${v}฿`).join(" | ")}</div>}
              {r.phone && r.phone !== "-" && <div style={{ fontSize: 12, color: "#888" }}>tel: {r.phone}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Zone 2 + 3 + 4 — Side by Side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>

        {/* Zone 2: Mission / GPS */}
        <div style={zone}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, color: "#888" }}>Mission / GPS</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={missionLat} onChange={(e) => setMissionLat(e.target.value)} placeholder="Lat" style={{ flex: 1, padding: 8, fontSize: 13, border: "1px solid #333", borderRadius: 6, background: "#111", color: "#eee" }} />
              <input value={missionLng} onChange={(e) => setMissionLng(e.target.value)} placeholder="Lng" style={{ flex: 1, padding: 8, fontSize: 13, border: "1px solid #333", borderRadius: 6, background: "#111", color: "#eee" }} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="จำนวน (คิว)" style={{ flex: 1, padding: 8, fontSize: 13, border: "1px solid #333", borderRadius: 6, background: "#111", color: "#eee" }} />
              <span style={{ padding: 8, fontSize: 13, color: "#888" }}>คิว</span>
            </div>
            <button onClick={handleCalc} disabled={!selected || calcLoading} style={selected ? btnGreen : btn}>
              {calcLoading ? "คำนวณ..." : selected ? `คำนวณ ${selected.name.substring(0, 20)}` : "เลือกแหล่งวัสดุก่อน"}
            </button>
          </div>

          {selected && (
            <div style={{ marginTop: 12, padding: 10, background: "#0f0f0f", borderRadius: 8, fontSize: 12 }}>
              <div style={{ color: "#22c55e", fontWeight: 600 }}>{selected.name}</div>
              {selected.lat && <div style={{ color: "#666" }}>GPS: {selected.lat}, {selected.lng}</div>}
              {selected.distance_km && <div style={{ color: "#888" }}>ระยะทาง: {selected.distance_km} กม.</div>}
            </div>
          )}
        </div>

        {/* Zone 4: Calculator */}
        <div style={zone}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, color: "#888" }}>Calculator</h3>
          {quote ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>ระยะทาง</span><span>{quote.distance_km} กม.</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>จำนวนเที่ยว</span><span>{quote.trips} เที่ยว</span></div>
              <div style={{ borderTop: "1px solid #222", margin: "4px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>ค่าวัสดุ</span><span>{quote.material_cost.toLocaleString()} ฿</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>ค่าน้ำมัน</span><span>{quote.fuel_cost.toLocaleString()} ฿</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>ค่าแรง</span><span>{quote.driver_wage.toLocaleString()} ฿</span></div>
              <div style={{ borderTop: "1px solid #222", margin: "4px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}><span style={{ color: "#f87171" }}>ต้นทุน</span><span style={{ color: "#f87171" }}>{quote.total_cost.toLocaleString()} ฿</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}><span style={{ color: "#22c55e" }}>ราคาขาย</span><span style={{ color: "#22c55e" }}>{quote.selling_price.toLocaleString()} ฿</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>VAT</span><span>{quote.vat_amount.toLocaleString()} ฿</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}><span style={{ color: "#f59e0b" }}>กำไร</span><span style={{ color: "#f59e0b" }}>{quote.profit.toLocaleString()} ฿</span></div>
            </div>
          ) : (
            <p style={{ color: "#444", fontSize: 13 }}>เลือกแหล่งวัสดุ → ใส่จำนวน → กดคำนวณ</p>
          )}
        </div>

        {/* Zone 3: Data Completion */}
        <div style={zone}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, color: "#888" }}>Data Completion</h3>
          {selected ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {!selected.prices && (
                <div style={{ padding: 10, background: "#1a1400", borderRadius: 8, border: "1px solid #f59e0b33" }}>
                  <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 6 }}>ยังไม่มีราคาวัสดุ</div>
                  <button style={btn} onClick={() => setMessage("เปิด form เพิ่มราคา (V6)")}>เพิ่มราคาวัสดุ</button>
                </div>
              )}
              {!selected.phone && (
                <div style={{ padding: 10, background: "#1a0014", borderRadius: 8, border: "1px solid #f4337733" }}>
                  <div style={{ fontSize: 12, color: "#f87171", marginBottom: 6 }}>ยังไม่มีเบอร์โทร</div>
                  <button style={btn} onClick={() => setMessage("เปิด form เพิ่มเบอร์ (V6)")}>เพิ่มเบอร์โทร</button>
                </div>
              )}
              {selected.prices && selected.phone && (
                <div style={{ padding: 10, background: "#001a00", borderRadius: 8, border: "1px solid #22c55e33" }}>
                  <div style={{ fontSize: 12, color: "#22c55e" }}>ข้อมูลครบแล้ว</div>
                </div>
              )}
            </div>
          ) : (
            <p style={{ color: "#444", fontSize: 13 }}>เลือกรายการจากผลค้นหา</p>
          )}
        </div>
      </div>

      {/* Zone 5: Action Panel */}
      <div style={{ ...zone, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={btn} onClick={() => selected?.lat && window.open(`https://maps.google.com/?q=${selected.lat},${selected.lng}`, "_blank")} disabled={!selected?.lat}>
          เปิดแผนที่
        </button>
        <button style={btn} onClick={() => selected?.phone && (window.location.href = `tel:${selected.phone}`)} disabled={!selected?.phone}>
          โทร {selected?.phone ?? ""}
        </button>
        <button style={btn} onClick={() => window.location.href = "line://"}>
          ส่ง LINE
        </button>
        <button style={btn} disabled={!quote}>
          สร้างใบเสนอราคา
        </button>
        <button style={btn} disabled={!quote}>
          สร้าง PO
        </button>
        <button style={btn} disabled={!quote}>
          สร้าง DO
        </button>
        <button style={btn} disabled={!selected}>
          แก้ไขข้อมูล
        </button>
      </div>
    </main>
  );
}
