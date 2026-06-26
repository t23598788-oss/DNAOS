"use client";

import { useState, useRef, useEffect } from "react";
import { dispatch } from "@/lib/v1-input/parser";
import { CAPABILITIES, getToolsByCapability, getStatusColor, getStatusLabel } from "@/lib/v6-executor/capabilities";
import type { CapabilityType, Tool } from "@/lib/v6-executor/capabilities";

// ---- Types ----
interface Message {
  role: "user" | "system";
  text: string;
  data?: Record<string, unknown>[] | Record<string, unknown>;
  trace?: Record<string, unknown>[];
  timestamp: string;
}

interface ToolDetail {
  tool: Tool;
}

interface Context {
  customer?: string;
  material?: string;
  quantity?: number;
  pit?: string;
  pit_id?: string;
  last_action?: string;
}

export default function OpsPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [toolDetail, setToolDetail] = useState<ToolDetail | null>(null);
  const [context, setContext] = useState<Context>({});
  const [showContext, setShowContext] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function addMsg(role: "user" | "system", text: string, data?: Message["data"], trace?: Message["trace"]) {
    setMessages((prev) => [...prev, { role, text, data, trace, timestamp: new Date().toLocaleTimeString("th-TH") }]);
  }

  // ── Main command handler ──
  async function send() {
    if (!input.trim() || loading) return;
    const userInput = input.trim();
    setInput("");
    addMsg("user", userInput);
    setLoading(true);
    setShowTools(false);

    try {
      // V1: Receive → V2: AI translate
      const ai = await (await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: userInput, engine: "openai" }) })).json();

      if (!ai.ok) {
        addMsg("system", `แปลคำสั่งไม่ได้ — ลอง V1 keyword match`);
        const r = await dispatch({ action: "unknown", payload: { source: userInput } });
        if (r.ok && r.data) addMsg("system", `พบ ${Array.isArray(r.data) ? r.data.length : 1} ผลลัพธ์`, Array.isArray(r.data) ? r.data : [r.data]);
        else addMsg("system", r.error ?? "ไม่พบข้อมูล");
        setLoading(false);
        return;
      }

      const cmd = ai.command;

      // V3: Registry + V4: Analysis
      if (cmd.action.includes("find")) {
        const domain = cmd.action.split(".")[0];
        const keyword = cmd.payload?.name ?? cmd.payload?.keyword ?? "";

        addMsg("system", `กำลังค้นหา "${keyword}" ...`);

        try {
          const f = await (await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "find", domain, keyword, question: userInput }) })).json();

          if (f.ok && f.record) {
            const enriched = f.record.enriched ?? f.record.results ?? [f.record];
            const items = Array.isArray(enriched) ? enriched : [enriched];
            const rank = f.record.rank;

            // V5: Business Analysis — สรุป + แนะนำ
            if (items.length > 0 && items[0]?.distance_km) {
              // มีระยะทาง → วิเคราะห์แบบธุรกิจ
              const best = items[0];
              const hasPrices = items.some((i: Record<string, unknown>) => i.prices && Object.keys(i.prices as object).length > 0);

              let summary = `พบ ${items.length} แห่ง`;
              if (rank?.explain) summary += ` (${rank.explain})`;
              summary += `\n\n`;
              summary += `แนะนำอันดับ 1: ${best.name}\n`;
              if (best.distance_km) summary += `   ระยะทาง: ${best.distance_km} กม.\n`;
              if (best.address && best.address !== "-") summary += `   ที่อยู่: ${best.address}\n`;
              if (best.materials) summary += `   วัสดุ: ${(best.materials as string[]).join(", ")}\n`;
              if (best.prices) summary += `   ราคา: ${Object.entries(best.prices as Record<string, number>).map(([k, v]) => `${k} ${v}฿/คิว`).join(", ")}\n`;
              summary += `\n`;

              if (items.length > 1) {
                summary += `ทางเลือกอื่น:\n`;
                items.slice(1, 4).forEach((item: Record<string, unknown>, i: number) => {
                  summary += `   ${i + 2}. ${item.name}`;
                  if (item.distance_km) summary += ` — ${item.distance_km} กม.`;
                  if (item.prices) summary += ` — ${Object.values(item.prices as Record<string, number>).map((v) => `${v}฿`).join("/")}`;
                  summary += `\n`;
                });
              }

              if (!hasPrices) {
                summary += `\n⚠ ยังไม่มีราคาวัสดุในระบบ — ต้องเพิ่มราคาก่อนคำนวณต้นทุนได้`;
              }

              // Update context
              setContext((prev) => ({ ...prev, pit: String(best.name), pit_id: String(best.id), last_action: "find" }));

              addMsg("system", summary, items);
            } else {
              // ไม่มีระยะทาง → แสดงเป็น list
              addMsg("system", `พบ ${items.length} รายการ`, items);
            }
          } else {
            addMsg("system", `ไม่พบ "${keyword}"\n\nค้นใน: pit_profiles, partners, invoices, debts\nลองพิมพ์ชื่ออื่น หรือพิมพ์สั้นลง`);
          }
        } catch {
          addMsg("system", `การค้นหาใช้เวลานาน — ลองค้นแบบสั้นลง เช่น "โรงโม่" แทน "โรงโม่หินทั้งหมดในจังหวัด"`);
        }
      } else {
        // V1 dispatch สำหรับคำสั่งที่ไม่ใช่ find
        const r = await dispatch(cmd);
        if (r.ok && r.data) {
          const items = Array.isArray(r.data) ? r.data : [r.data];
          addMsg("system", `${cmd.action} → พบ ${items.length} ผลลัพธ์`, items);
        } else {
          addMsg("system", `${cmd.action} → ${r.error ?? "ไม่พบข้อมูล"}`);
        }
      }
    } catch (err) {
      addMsg("system", `เชื่อมต่อไม่ได้ — ${err instanceof Error ? err.message : "network error"}`);
    } finally {
      setLoading(false);
    }
  }

  // ── V6: Tool execute ผ่าน Computer Control API ──
  async function executeTool(tool: Tool) {
    if (tool.status === "disabled") { addMsg("system", `${tool.name} — Disabled`); return; }
    if (tool.status === "auth_required") { addMsg("system", `${tool.name} — ต้อง Login ก่อนใช้งาน`); return; }
    if (tool.status === "offline") { addMsg("system", `${tool.name} — Offline`); return; }

    setShowTools(false);

    const appNames: Record<string, string> = {
      line: "LINE", whatsapp: "WhatsApp", messenger: "Messenger", telegram: "Telegram",
      discord: "Discord", slack: "Slack", gmaps: "Google Maps", gearth: "Google Earth",
      gdrive: "Finder", supabase: "Google Chrome", openai: "Google Chrome",
      claude: "Google Chrome", gemini: "Google Chrome", github: "GitHub Desktop",
      vscode: "VS Code", gmail: "Mail", gcal: "Calendar", pdf: "PDF Viewer",
      vercel: "Terminal", mcp: "Terminal", facebook: "Google Chrome",
      instagram: "Google Chrome", tiktok: "Google Chrome", x: "Google Chrome",
      onedrive: "Finder", dropbox: "Finder",
    };

    const appName = appNames[tool.id];
    if (!appName) {
      addMsg("system", `${tool.name} — Connected ✓ พร้อมรับคำสั่ง${tool.mcp_server ? ` (MCP: ${tool.mcp_server})` : ""}`);
      return;
    }

    addMsg("system", `กำลังเปิด ${tool.name}...`);

    // ลอง Agent (localhost:7777) ก่อน → fallback ไป /api/computer
    const agentUrl = "http://localhost:7777";
    const driverMap: Record<string, string> = { line: "line" };
    const driverName = driverMap[tool.id];

    try {
      let data: any;
      if (driverName) {
        // เรียก Agent → Driver
        const res = await fetch(`${agentUrl}/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ driver: driverName, command: "connect" }),
        });
        data = await res.json();
      } else {
        // fallback: /api/computer
        const res = await fetch("/api/computer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflow: "app.launch", app: appName }),
        });
        data = await res.json();
      }

      if (data.success || data.ok) {
        addMsg("system", `เปิด ${tool.name} สำเร็จ ✓${driverName ? " (Agent)" : ""}`);
      } else {
        addMsg("system", `${tool.name} — ${data.error ?? "เปิดไม่ได้"}`);
      }
    } catch {
      addMsg("system", `${tool.name} — Agent offline (localhost:7777) — เปิด Agent ก่อน: bash lib/agent/start.sh`);
    }
  }

  function showToolInfo(tool: Tool) {
    setToolDetail({ tool });
  }

  return (
    <div style={{ height: "100vh", background: "#000", color: "#eee", display: "flex", flexDirection: "column" }}>

      {/* ===== Header ===== */}
      <div style={{ padding: "8px 24px", borderBottom: "1px solid #111", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: "#22c55e" }}>DNA OS</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setShowContext(!showContext)} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #222", background: showContext ? "#111" : "transparent", color: "#555", fontSize: 11, cursor: "pointer" }}>
            {context.pit ? `📍 ${context.pit.substring(0, 15)}` : "Context"}
          </button>
          <span style={{ fontSize: 10, color: "#333" }}>V5 Read + V6 Execute</span>
        </div>
      </div>

      {/* ===== Context Panel ===== */}
      {showContext && Object.keys(context).length > 0 && (
        <div style={{ padding: "8px 24px", borderBottom: "1px solid #111", background: "#050505", fontSize: 11, color: "#555", display: "flex", gap: 16 }}>
          {context.customer && <span>ลูกค้า: {context.customer}</span>}
          {context.pit && <span>แหล่ง: {context.pit}</span>}
          {context.material && <span>วัสดุ: {context.material}</span>}
          {context.quantity && <span>จำนวน: {context.quantity} คิว</span>}
          {context.last_action && <span>คำสั่งล่าสุด: {context.last_action}</span>}
        </div>
      )}

      {/* ===== Tool Panel (V6) ===== */}
      {showTools && (
        <div style={{ padding: "12px 24px", borderBottom: "1px solid #111", background: "#050505" }}>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {(Object.entries(CAPABILITIES) as [CapabilityType, { label: string }][]).map(([cap, info]) => (
              <div key={cap}>
                <div style={{ fontSize: 10, color: "#444", marginBottom: 6 }}>{info.label}</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {getToolsByCapability(cap).map((tool) => (
                    <div key={tool.id} style={{ position: "relative" }}>
                      <button
                        onClick={() => executeTool(tool)}
                        onContextMenu={(e) => { e.preventDefault(); showToolInfo(tool); }}
                        title={`${tool.name} — ${getStatusLabel(tool.status)}`}
                        style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #222", background: "#111", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, opacity: tool.status === "disabled" ? 0.3 : 1 }}
                      >
                        <img src={tool.logo} alt={tool.name} style={{ width: 20, height: 20, objectFit: "contain", filter: tool.status === "disabled" ? "grayscale(1)" : "none" }} />
                      </button>
                      <div style={{ position: "absolute", bottom: -2, right: -2, width: 8, height: 8, borderRadius: 4, background: getStatusColor(tool.status), border: "1px solid #000" }} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Tool Detail Panel */}
          {toolDetail && (
            <div style={{ marginTop: 12, padding: 12, background: "#111", borderRadius: 8, border: "1px solid #222", fontSize: 11, maxWidth: 320 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>{toolDetail.tool.name}</span>
                <button onClick={() => setToolDetail(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer" }}>x</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, color: "#888" }}>
                <div>Status: <span style={{ color: getStatusColor(toolDetail.tool.status) }}>{getStatusLabel(toolDetail.tool.status)}</span></div>
                <div>Handler: {toolDetail.tool.handler}</div>
                {toolDetail.tool.mcp_server && <div>MCP: {toolDetail.tool.mcp_server}</div>}
                <div>Capability: {toolDetail.tool.capability}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== Messages ===== */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", marginTop: "25vh", color: "#222" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#111", marginBottom: 8 }}>DNA OS</div>
            <div style={{ fontSize: 14, color: "#333" }}>รอรับคำสั่งจากเฮีย</div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: 16, maxWidth: 800, marginLeft: msg.role === "user" ? "auto" : 0, marginRight: msg.role === "user" ? 0 : "auto" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: msg.role === "user" ? "#22c55e" : "#111", border: msg.role === "system" ? "1px solid #222" : "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0, color: msg.role === "user" ? "#000" : "#22c55e", fontWeight: 600 }}>
                {msg.role === "user" ? "H" : "D"}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.6, color: msg.role === "user" ? "#eee" : "#ccc" }}>
                  {msg.text}
                </div>

                {/* Data table */}
                {msg.data && Array.isArray(msg.data) && msg.data.length > 0 && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ fontSize: 11, color: "#555", cursor: "pointer" }}>ดูข้อมูลดิบ ({msg.data.length} รายการ)</summary>
                    <div style={{ marginTop: 4, maxHeight: 200, overflow: "auto", background: "#0a0a0a", borderRadius: 8, padding: 8 }}>
                      {msg.data.map((item: Record<string, unknown>, j: number) => (
                        <div key={j} style={{ padding: "4px 0", borderBottom: "1px solid #111", fontSize: 11, color: "#888" }}>
                          {Object.entries(item).filter(([, v]) => v !== null && v !== undefined && v !== "-" && v !== "").slice(0, 6).map(([k, v]) => (
                            <span key={k} style={{ marginRight: 12 }}>{k}: <span style={{ color: "#ccc" }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span></span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <div style={{ fontSize: 10, color: "#333", marginTop: 4 }}>{msg.timestamp}</div>
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#555", fontSize: 13 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: "#111", border: "1px solid #222", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#22c55e" }}>D</div>
            กำลังประมวลผล...
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ===== Input Bar ===== */}
      <div style={{ padding: "12px 24px", borderTop: "1px solid #111", background: "#050505" }}>
        <div style={{ display: "flex", gap: 8, maxWidth: 800, margin: "0 auto" }}>
          <button onClick={() => setShowTools(!showTools)} style={{ width: 40, height: 40, borderRadius: 20, border: "1px solid #333", background: showTools ? "#22c55e" : "#111", color: showTools ? "#000" : "#eee", fontSize: 20, cursor: "pointer", flexShrink: 0 }}>+</button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="พิมพ์คำสั่ง..."
            style={{ flex: 1, padding: "10px 16px", fontSize: 15, border: "1px solid #222", borderRadius: 24, background: "#111", color: "#eee", outline: "none" }}
          />
          <button onClick={send} disabled={loading || !input.trim()} style={{ width: 40, height: 40, borderRadius: 20, border: "none", background: input.trim() ? "#22c55e" : "#222", color: input.trim() ? "#000" : "#555", fontSize: 16, cursor: input.trim() ? "pointer" : "default", flexShrink: 0 }}>▶</button>
        </div>
      </div>
    </div>
  );
}
