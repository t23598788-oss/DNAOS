"use client";

import { useRouter } from "next/navigation";
import { openLine, openDrive } from "@/lib/siri/shortcuts";

export default function ActionPanel() {
  const router = useRouter();

  const btn = {
    padding: "10px 16px",
    borderRadius: 8,
    border: "1px solid #333",
    background: "#111",
    color: "#eee",
    cursor: "pointer",
    fontSize: 14,
  } as const;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button style={btn} onClick={openLine}>
        Open LINE
      </button>
      <button style={btn} onClick={openDrive}>
        Open Google Drive
      </button>
      <button style={btn} onClick={() => router.push("/dashboard")}>
        Open Dashboard
      </button>
    </div>
  );
}
