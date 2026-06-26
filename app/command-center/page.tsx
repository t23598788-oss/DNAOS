"use client";

import { useState, useRef, useEffect } from "react";
import { DOC_LABELS, type DocType, type DocResult } from "@/lib/documents/engine";

type Tab = "chat" | "documents" | "finance" | "search";
type SideItem = { id: string; label: string; type: string; badge?: number };

// Sidebar ดึงจาก Supabase — ไม่มี hardcode
const SIDE_SECTIONS: { title: string; items: SideItem[] }[] = [];

const QUICK_COMMANDS = [
  { cmd: "/quotation", label: "ใบเสนอราคา" },
  { cmd: "/invoice", label: "ใบแจ้งหนี้" },
  { cmd: "/delivery", label: "ใบส่งของ" },
  { cmd: "/receipt", label: "ใบรับเงิน" },
  { cmd: "/debt", label: "ติดตามหนี้" },
  { cmd: "/workorder", label: "ใบสั่งงาน" },
  { cmd: "/search", label: "ค้นหา" },
];

export default function CommandCenter() {
  const [tab, setTab] = useState<Tab>("chat");
  const [selected, setSelected] = useState<SideItem | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; text: string; time: string }[]>([]);
  const [docPreview, setDocPreview] = useState<DocResult | null>(null);
  const [showQuick, setShowQuick] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function addMsg(role: string, text: string) {
    setMessages((m) => [...m, { role, text, time: now() }]);
  }

  async function handleSubmit() {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    addMsg("user", text);

    // Quick commands
    if (text.startsWith("/")) {
      handleQuickCommand(text);
      return;
    }

    // ส่งไป AI translate
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, engine: "local" }),
      });
      const data = await res.json();
      if (data.ok && data.command) {
        addMsg("ai", `เข้าใจคำสั่ง: ${data.command.action}`);
        // Route ไป handler
        const result = await fetch("/api/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "find", action: data.command.action, payload: data.command.payload }),
        });
        const r = await result.json();
        if (r.ok) {
          addMsg("system", JSON.stringify(r.data, null, 2).slice(0, 500));
        } else {
          addMsg("system", r.error ?? "ไม่พบข้อมูล");
        }
      } else {
        addMsg("system", "ไม่เข้าใจคำสั่ง");
      }
    } catch {
      addMsg("system", "เชื่อมต่อไม่ได้");
    }
  }

  async function handleQuickCommand(cmd: string) {
    const parts = cmd.split(" ");
    const command = parts[0];

    const docTypes: Record<string, DocType> = {
      "/quotation": "quotation", "/invoice": "invoice", "/delivery": "delivery",
      "/receipt": "receipt", "/debt": "debt_notice", "/workorder": "workorder",
      "/management": "management_fee", "/requisition": "requisition",
    };

    if (docTypes[command]) {
      // STRICT RENDER MODE — ดึงข้อมูลจาก DB เท่านั้น ห้าม mock
      addMsg("system", `กำลังดึงข้อมูลจากฐานข้อมูลเพื่อสร้าง${DOC_LABELS[docTypes[command]].th}...`);
      try {
        const res = await fetch("/api/document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: docTypes[command], customer: { name: selected?.label }, items: [] }),
        });
        const data = await res.json();
        if (data.html) {
          setDocPreview(data);
          setTab("documents");
          addMsg("system", `${data.label?.th ?? docTypes[command]} — ยอดสุทธิ ${data.summary?.total?.toLocaleString() ?? 0} บาท`);
        } else {
          addMsg("system", data.error ?? "ไม่พบข้อมูล");
        }
      } catch {
        addMsg("system", "ไม่พบข้อมูล");
      }
      return;
    }

    if (command === "/search") {
      addMsg("system", `ค้นหา: ${parts.slice(1).join(" ") || "กรุณาพิมพ์คำค้น"}`);
      return;
    }

    addMsg("system", `ไม่รู้จักคำสั่ง: ${command}`);
  }

  // ── Styles ──
  const bg = "#faf8f5";
  const border = "#e5e7eb";
  const green = "#22c55e";
  const greenLight = "#f0fdf4";

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'Sarabun', sans-serif", background: bg, color: "#1a1a1a" }}>

      {/* ===== LEFT SIDEBAR ===== */}
      <div style={{ width: 260, borderRight: `1px solid ${border}`, background: "#fff", overflowY: "auto", flexShrink: 0 }}>
        <div style={{ padding: "16px 16px 8px", borderBottom: `1px solid ${border}` }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: green, letterSpacing: 2 }}>DNA OS</div>
          <div style={{ fontSize: 10, color: "#888" }}>Command Center</div>
        </div>

        {SIDE_SECTIONS.map((sec) => (
          <div key={sec.title}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#888", padding: "12px 16px 4px", textTransform: "uppercase", letterSpacing: 1 }}>{sec.title}</div>
            {sec.items.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelected(item)}
                style={{
                  padding: "8px 16px", cursor: "pointer", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: selected?.id === item.id ? greenLight : "transparent",
                  borderLeft: selected?.id === item.id ? `3px solid ${green}` : "3px solid transparent",
                }}
              >
                <span>{item.label}</span>
                {item.badge ? <span style={{ background: "#ef4444", color: "#fff", fontSize: 10, padding: "1px 6px", borderRadius: 10, fontWeight: 700 }}>{item.badge}</span> : null}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ===== CENTER ===== */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${border}`, background: "#fff" }}>
          {(["chat", "documents", "finance", "search"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "10px 20px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", letterSpacing: 1,
                background: tab === t ? greenLight : "#fff",
                color: tab === t ? green : "#888",
                borderBottom: tab === t ? `2px solid ${green}` : "2px solid transparent",
              }}
            >
              {t === "chat" ? "แชท" : t === "documents" ? "เอกสาร" : t === "finance" ? "การเงิน" : "ค้นหา"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {tab === "chat" && (
            <div>
              {messages.map((m, i) => (
                <div key={i} style={{ marginBottom: 8, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "70%", padding: "8px 12px", borderRadius: 12, fontSize: 13, lineHeight: 1.6,
                    background: m.role === "user" ? green : m.role === "ai" ? "#dbeafe" : "#f3f4f6",
                    color: m.role === "user" ? "#fff" : "#1a1a1a",
                    whiteSpace: "pre-wrap",
                  }}>
                    {m.role !== "user" && <div style={{ fontSize: 9, color: "#888", marginBottom: 2 }}>{m.role === "ai" ? "AI" : "System"} · {m.time}</div>}
                    {m.text}
                  </div>
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
          )}

          {tab === "documents" && docPreview && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{docPreview.label.th} — {docPreview.docNumber}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { const w = window.open("", "_blank"); w?.document.write(docPreview.html); }} style={btnStyle}>Preview</button>
                  <button onClick={() => { const w = window.open("", "_blank"); w?.document.write(docPreview.html); setTimeout(() => w?.print(), 500); }} style={{ ...btnStyle, background: green, color: "#fff" }}>Export PDF</button>
                </div>
              </div>
              <div style={{ border: `1px solid ${border}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
                <iframe srcDoc={docPreview.html} style={{ width: "100%", height: 600, border: "none" }} />
              </div>
            </div>
          )}

          {tab === "documents" && !docPreview && (
            <div style={{ textAlign: "center", padding: 40, color: "#888" }}>
              <div style={{ fontSize: 14 }}>ไม่มีข้อมูล</div>
            </div>
          )}

          {tab === "finance" && (
            <div style={{ padding: 20, color: "#888", fontSize: 14 }}>ไม่มีข้อมูล</div>
          )}

          {tab === "search" && (
            <div style={{ padding: 20, color: "#888", fontSize: 14 }}>ไม่มีข้อมูล</div>
          )}
        </div>

        {/* Input Bar */}
        <div style={{ padding: "8px 16px", borderTop: `1px solid ${border}`, background: "#fff", display: "flex", gap: 8, alignItems: "center", position: "relative" }}>
          <button onClick={() => setShowQuick(!showQuick)} style={{ padding: "6px 10px", border: `1px solid ${border}`, borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 14 }}>⚡</button>
          {showQuick && (
            <div style={{ position: "absolute", bottom: 50, left: 16, background: "#fff", border: `1px solid ${border}`, borderRadius: 8, padding: 4, boxShadow: "0 4px 12px rgba(0,0,0,.1)", zIndex: 10 }}>
              {QUICK_COMMANDS.map((q) => (
                <div key={q.cmd} onClick={() => { setInput(q.cmd + " "); setShowQuick(false); }} style={{ padding: "6px 12px", fontSize: 12, cursor: "pointer", borderRadius: 4 }}>
                  <span style={{ color: green, fontWeight: 600 }}>{q.cmd}</span> <span style={{ color: "#888" }}>{q.label}</span>
                </div>
              ))}
            </div>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="พิมพ์คำสั่ง หรือ /quotation, /invoice..."
            style={{ flex: 1, padding: "8px 14px", fontSize: 14, border: `1px solid ${border}`, borderRadius: 20, outline: "none", background: bg }}
          />
          <button onClick={handleSubmit} style={{ padding: "8px 16px", background: green, color: "#fff", border: "none", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>ส่ง</button>
        </div>
      </div>

      {/* ===== RIGHT CONTEXT — ข้อมูลจาก DB เท่านั้น ===== */}
      <div style={{ width: 280, borderLeft: `1px solid ${border}`, background: "#fff", overflowY: "auto", flexShrink: 0, padding: 16 }}>
        {selected ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{selected.label}</div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 16 }}>ประเภท: {selected.type}</div>
            <div style={{ fontSize: 11, color: "#aaa", textAlign: "center", padding: 20 }}>ไม่มีข้อมูล</div>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: 40, color: "#aaa", fontSize: 12 }}>ไม่มีข้อมูล</div>
        )}
      </div>
    </div>
  );
}

function now() { return new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }); }

const btnStyle: React.CSSProperties = { padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", background: "#fff" };
