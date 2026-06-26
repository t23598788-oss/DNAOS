"use client";

import { useState } from "react";
import type { CommandResult } from "@/types/command";
import { runCommand } from "@/lib/v1-input/parser";

interface Props {
  onResult: (result: CommandResult) => void;
}

export default function CommandBox({ onResult }: Props) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function execute() {
    if (!input.trim() || loading) return;
    setLoading(true);
    try {
      const result = await runCommand(input);
      onResult(result);
    } catch (e: any) {
      onResult({
        ok: false,
        command: { action: "error" },
        error: e?.message ?? "error",
      });
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
        placeholder="พิมพ์คำสั่งภาษาไทย เช่น ลูกหนี้ทั้งหมด"
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
        {loading ? "..." : "Execute"}
      </button>
    </div>
  );
}
