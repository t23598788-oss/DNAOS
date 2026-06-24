"use client";

import { useState } from "react";
import type { CommandResult, ViewMode } from "@/types/command";

interface Props {
  result: CommandResult | null;
}

export default function ResultViewer({ result }: Props) {
  const [view, setView] = useState<ViewMode>("json");

  if (!result) {
    return (
      <div style={{ color: "#666", padding: 16 }}>ยังไม่มีผลลัพธ์</div>
    );
  }

  if (!result.ok) {
    return (
      <div style={{ color: "#f87171", padding: 16 }}>
        ❌ {result.error}
      </div>
    );
  }

  const data = result.data;
  const rows: any[] = Array.isArray(data) ? data : data ? [data] : [];
  const columns = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {(["json", "table", "text"] as ViewMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setView(m)}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #333",
              background: view === m ? "#22c55e" : "#111",
              color: view === m ? "#000" : "#aaa",
              cursor: "pointer",
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {view === "json" && (
        <pre
          style={{
            background: "#0a0a0a",
            padding: 16,
            borderRadius: 8,
            overflow: "auto",
            color: "#e5e7eb",
            fontSize: 13,
          }}
        >
          {JSON.stringify(data, null, 2)}
        </pre>
      )}

      {view === "table" && columns.length > 0 && (
        <div style={{ overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c}
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "1px solid #333",
                      color: "#22c55e",
                    }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td
                      key={c}
                      style={{
                        padding: 8,
                        borderBottom: "1px solid #1a1a1a",
                        color: "#ddd",
                      }}
                    >
                      {typeof row[c] === "object"
                        ? JSON.stringify(row[c])
                        : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "text" && (
        <div style={{ color: "#ddd", padding: 16, whiteSpace: "pre-wrap" }}>
          {rows
            .map((r) => Object.values(r).join("  |  "))
            .join("\n") || "—"}
        </div>
      )}
    </div>
  );
}
