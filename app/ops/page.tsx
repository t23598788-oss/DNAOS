"use client";

import { useState } from "react";
import { dispatch } from "@/lib/router";
import { CAPABILITIES, getToolsByCapability } from "@/lib/executor/capabilities";
import type { CapabilityType, Tool } from "@/lib/executor/capabilities";

interface Item {
  id: string; name: string; lat?: number; lng?: number;
  materials?: string[]; prices?: Record<string, number>;
  phone?: string; address?: string; distance_km?: number;
}

interface TracedValue {
  label: string; value: number | string; unit: string;
  source: string; formula: string; timestamp: string;
}

export default function OpsPage() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [message, setMessage] = useState("");
  const [trace, setTrace] = useState<TracedValue[]>([]);
  const [expandedTrace, setExpandedTrace] = useState<number | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [qty, setQty] = useState("100");

  // ── V5: Search (Read-Only) ──
  async function search() {
    if (!input.trim() || loading) return;
    setLoading(true); setMessage(""); setTrace([]); setSelected(null);
    try {
      const ai = await (await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: input, engine: "openai" }) })).json();
      if (ai.ok && ai.command) {
        const cmd = ai.command;
        if (cmd.action.includes("find")) {
          const d = cmd.action.split(".")[0], kw = cmd.payload?.name ?? cmd.payload?.keyword ?? "";
          const f = await (await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "find", domain: d, keyword: kw, question: input }) })).json();
          if (f.ok && f.record) {
            const e = f.record.enriched ?? f.record.results ?? [f.record];
            setResults((Array.isArray(e) ? e : [e]).map(mapItem));
            setMessage(`${Array.isArray(e) ? e.length : 1} ผลลัพธ์${f.record.rank?.explain ? ` — ${f.record.rank.explain}` : ""}`);
          } else { setResults([]); setMessage(f.error ?? "ไม่พบ"); }
        } else {
          const r = await dispatch(cmd);
          if (r.ok && r.data) { const a = Array.isArray(r.data) ? r.data : [r.data]; setResults(a.map(mapItem)); setMessage(`${a.length} ผลลัพธ์`); }
          else { setResults([]); setMessage(r.error ?? "ไม่พบ"); }
        }
      }
    } catch { setMessage("เชื่อมต่อไม่ได้"); }
    finally { setLoading(false); }
  }

  function mapItem(r: Record<string, unknown>): Item {
    return { id: String(r.id ?? r.pit_id ?? r.partner_id ?? ""), name: String(r.name ?? r.pit_name ?? r.customer_name ?? r.party_name ?? r.document_number ?? r.project_name ?? "-"), lat: r.lat ? Number(r.lat) : r.latitude ? Number(r.latitude) : undefined, lng: r.lng ? Number(r.lng) : r.longitude ? Number(r.longitude) : undefined, materials: r.materials as string[] | undefined, prices: r.prices as Record<string, number> | undefined, phone: r.phone ? String(r.phone) : undefined, address: r.address ? String(r.address) : undefined, distance_km: r.distance_km ? Number(r.distance_km) : undefined };
  }

  // ── V5: Explainable Calc ──
  async function explainCalc(item: Item) {
    setSelected(item);
    try {
      const res = await fetch("/api/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pit_id: item.id, site_lat: 16.4314, site_lng: 102.835, quantity: Number(qty) }) });
      const data = await res.json();
      if (data.ok) setTrace(data.items);
    } catch {}
  }

  // ── V6: Tool execute ──
  async function executeTool(tool: Tool) {
    setShowTools(false);
    switch (tool.id) {
      case "google_maps":
        if (selected?.lat) window.open(`https://maps.google.com/?q=${selected.lat},${selected.lng}`, "_blank");
        else setMessage("เลือกรายการที่มี GPS ก่อน");
        break;
      case "line":
        window.location.href = "line://";
        break;
      case "phone":
        if (selected?.phone) window.location.href = `tel:${selected.phone}`;
        else setMessage("เลือกรายการที่มีเบอร์โทรก่อน");
        break;
      case "gps_current":
        navigator.geolocation?.getCurrentPosition((p) => setMessage(`GPS: ${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`));
        break;
      default:
        if (tool.available) setMessage(`${tool.name} — รอ V6 MCP connector`);
        break;
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#eee", display: "flex", flexDirection: "column" }}>

      {/* ===== Command Bar (top) ===== */}
      <div style={{ padding: "12px 24px", borderBottom: "1px solid #111", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#22c55e", whiteSpace: "nowrap" }}>DNA OS</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="พิมพ์อะไรก็ได้..."
          style={{ flex: 1, padding: "10px 16px", fontSize: 15, border: "1px solid #222", borderRadius: 24, background: "#0a0a0a", color: "#eee", outline: "none" }}
        />
        <button onClick={search} disabled={loading} style={{ padding: "10px 20px", borderRadius: 24, border: "none", background: "#22c55e", color: "#000", fontWeight: 600, cursor: "pointer", fontSize: 14 }}>
          {loading ? "..." : "ค้นหา"}
        </button>
        <button onClick={() => setShowTools(!showTools)} style={{ width: 40, height: 40, borderRadius: 20, border: "1px solid #333", background: showTools ? "#22c55e" : "#111", color: showTools ? "#000" : "#eee", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          +
        </button>
      </div>

      {/* ===== Tool Panel (V6) ===== */}
      {showTools && (
        <div style={{ padding: "12px 24px", borderBottom: "1px solid #111", background: "#050505" }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {(Object.entries(CAPABILITIES) as [CapabilityType, { label: string; icon: string }][]).map(([cap, info]) => (
              <div key={cap}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>{info.icon} {info.label}</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {getToolsByCapability(cap).map((tool) => (
                    <button key={tool.id} onClick={() => executeTool(tool)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #222", background: "#111", color: "#ccc", fontSize: 11, cursor: "pointer" }}>
                      {tool.icon} {tool.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {message && <div style={{ padding: "6px 24px", fontSize: 12, color: "#888" }}>{message}</div>}

      {/* ===== Content ===== */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left: Results */}
        <div style={{ flex: 1, padding: "12px 24px", overflow: "auto" }}>
          {results.length === 0 && <p style={{ color: "#222", fontSize: 14, textAlign: "center", marginTop: 80 }}>พิมพ์คำสั่งด้านบน</p>}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {results.map((r, i) => (
              <div key={r.id || i} onClick={() => explainCalc(r)} style={{ padding: "12px 16px", borderRadius: 10, border: `1px solid ${selected?.id === r.id ? "#22c55e" : "#1a1a1a"}`, background: selected?.id === r.id ? "#0a1a0a" : "#0a0a0a", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: selected?.id === r.id ? "#22c55e" : "#eee" }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: "#555", display: "flex", gap: 8, marginTop: 2 }}>
                    {r.distance_km && <span>{r.distance_km} กม.</span>}
                    {r.phone && r.phone !== "-" && <span>{r.phone}</span>}
                    {r.address && r.address !== "-" && <span>{r.address.substring(0, 40)}</span>}
                  </div>
                  {r.materials && <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 2 }}>{r.materials.join(", ")}</div>}
                  {r.prices && <div style={{ fontSize: 11, color: "#22c55e" }}>{Object.entries(r.prices).map(([k, v]) => `${k}: ${v}฿`).join("  ")}</div>}
                </div>
                {r.distance_km && <span style={{ fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>{r.distance_km} กม.</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Explainable Trace */}
        {trace.length > 0 && (
          <div style={{ width: 380, borderLeft: "1px solid #111", padding: "12px 16px", overflow: "auto", background: "#050505" }}>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>
              EXPLAIN — {selected?.name}
              <input value={qty} onChange={(e) => { setQty(e.target.value); if (selected) setTimeout(() => explainCalc(selected), 300); }} style={{ marginLeft: 8, width: 60, padding: "2px 6px", fontSize: 11, border: "1px solid #333", borderRadius: 4, background: "#111", color: "#eee" }} /> คิว
            </div>
            {trace.map((t, i) => {
              const isKey = ["ต้นทุนรวม", "ราคาขาย", "กำไร"].includes(t.label);
              const color = t.label === "ต้นทุนรวม" ? "#f87171" : t.label === "ราคาขาย" ? "#22c55e" : t.label === "กำไร" ? "#f59e0b" : "#ccc";
              const isSep = t.label === "ต้นทุนรวม" || t.label === "Markup";

              return (
                <div key={i}>
                  {isSep && <div style={{ borderTop: "1px solid #1a1a1a", margin: "6px 0" }} />}
                  <div onClick={() => setExpandedTrace(expandedTrace === i ? null : i)} style={{ display: "flex", justifyContent: "space-between", padding: "4px 6px", borderRadius: 4, cursor: "pointer", background: expandedTrace === i ? "#111" : "transparent" }}>
                    <span style={{ fontSize: 12, color: isKey ? color : "#888", fontWeight: isKey ? 600 : 400 }}>{t.label}</span>
                    <span style={{ fontSize: 12, color, fontWeight: isKey ? 600 : 400 }}>{typeof t.value === "number" ? t.value.toLocaleString() : t.value} {t.unit}</span>
                  </div>
                  {expandedTrace === i && (
                    <div style={{ padding: "4px 6px 4px 12px", fontSize: 10, color: "#444", background: "#0a0a0a", borderRadius: 4, marginBottom: 2 }}>
                      <div><span style={{ color: "#f59e0b" }}>Source:</span> {t.source}</div>
                      <div><span style={{ color: "#22c55e" }}>Formula:</span> {t.formula}</div>
                      <div><span style={{ color: "#666" }}>Updated:</span> {t.timestamp.substring(0, 19)}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: "8px 24px", borderTop: "1px solid #111", display: "flex", justifyContent: "space-between", fontSize: 10, color: "#333" }}>
        <span>V5 Read + Explain | V6 Execute (ปุ่ม +)</span>
        <span>DNA OS Control Console</span>
      </div>
    </div>
  );
}
