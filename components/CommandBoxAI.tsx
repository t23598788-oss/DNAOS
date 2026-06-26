"use client";

import { useState } from "react";
import type { CommandResult } from "@/types/command";
import { dispatch } from "@/lib/v1-input/parser";

interface Props {
  onResult: (result: CommandResult) => void;
}

// AI อาจส่ง action ที่ชื่อต่างจาก V1 → แปลงให้ตรง
function normalizeAction(action: string): string {
  const map: Record<string, string> = {
    "doc.list": "document.list",
    "doc.get": "document.list",
    "pay.list": "debt.list",
    "pay.preview": "debt.list",
    "quote.calc": "document.list",
    "job.assign": "job.list",
    "job.track": "job.list",
  };
  return map[action] ?? action;
}

export default function CommandBoxAI({ onResult }: Props) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function execute() {
    if (!input.trim() || loading) return;
    setLoading(true);
    try {
      const aiRes = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input, engine: "openai" }),
      });
      const aiData = await aiRes.json();

      if (aiData.ok && aiData.command) {
        const cmd = aiData.command;

        // FIND → ยิง V2 Action API
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
            // V5: ถ้ามี formatted → แสดง enriched data
            const enriched = findData.record.enriched ?? findData.record.results ?? findData.record;
            onResult({ ok: true, command: cmd, data: enriched });
          } else {
            onResult({ ok: false, command: cmd, error: findData.error ?? "ไม่พบข้อมูล" });
          }
          return;
        }

        // แปลง action ให้ตรงกับ V1 แล้ว dispatch
        const normalized = { ...cmd, action: normalizeAction(cmd.action) };
        const result = await dispatch(normalized);
        onResult(result);
      } else {
        // AI แปลไม่ได้ → ลอง V1 keyword match
        const { runCommand } = await import("@/lib/v1-input/parser");
        const result = await runCommand(input);
        onResult(result);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "error";
      onResult({ ok: false, command: { action: "error" }, error: msg });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, width: "100%" }}>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && execute()}
        placeholder="พิมพ์อะไรก็ได้ ระบบ AI จะแปลให้"
        style={{
          flex: 1,
          padding: "12px 14px",
          fontSize: 16,
          border: "1px solid #333",
          borderRadius: 8,
          background: "#111",
          color: "#eee",
        }}
      />
      <button
        onClick={execute}
        disabled={loading}
        style={{
          padding: "12px 20px",
          fontSize: 16,
          fontWeight: 600,
          border: "none",
          borderRadius: 8,
          background: loading ? "#555" : "#22c55e",
          color: "#000",
          cursor: loading ? "default" : "pointer",
        }}
      >
        {loading ? "AI กำลังแปล..." : "Execute"}
      </button>
    </div>
  );
}
