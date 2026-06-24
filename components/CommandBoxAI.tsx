"use client";

import { useState } from "react";
import type { CommandResult } from "@/types/command";
import { runCommand } from "@/lib/router";

interface Props {
  onResult: (result: CommandResult) => void;
}

export default function CommandBoxAI({ onResult }: Props) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function execute() {
    if (!input.trim() || loading) return;
    setLoading(true);
    try {
      // 1. ลอง OpenAI แปลก่อน
      const aiRes = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input, engine: "openai" }),
      });
      const aiData = await aiRes.json();

      if (aiData.ok && aiData.command) {
        const cmd = aiData.command;

        // 2. ถ้า AI แปลได้ → ยิงเข้า V2 Action (find) หรือ V1 Router
        if (cmd.action.includes("find")) {
          const domain = cmd.action.split(".")[0];
          const keyword = cmd.payload?.name ?? cmd.payload?.keyword ?? "";
          const findRes = await fetch("/api/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "find", domain, keyword }),
          });
          const findData = await findRes.json();

          if (findData.found === "exact") {
            onResult({ ok: true, command: cmd, data: { ...findData.record, next_actions: findData.next_actions } });
          } else if (findData.found === "ambiguous") {
            onResult({ ok: false, command: cmd, error: findData.error, data: findData.candidates });
          } else {
            onResult({ ok: false, command: cmd, error: findData.error ?? "ไม่พบข้อมูล" });
          }
        } else {
          // ใช้ V1 router ปกติ
          const result = await runCommand(input);

          // ถ้า V1 ไม่รู้จัก แต่ AI แปลได้ → ส่ง command จาก AI กลับไป
          if (!result.ok && result.command.action === "unknown") {
            onResult({
              ok: false,
              command: cmd,
              error: `AI แปลได้: ${cmd.action} — แต่ระบบยังไม่รองรับคำสั่งนี้`,
            });
          } else {
            onResult(result);
          }
        }
      } else {
        // 3. AI แปลไม่ได้ → fallback V1 keyword match
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
