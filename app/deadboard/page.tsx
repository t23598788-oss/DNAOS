"use client";

import { useState } from "react";
import CommandBox from "@/components/CommandBox";
import ResultViewer from "@/components/ResultViewer";
import ActionPanel from "@/components/ActionPanel";
import type { CommandResult } from "@/types/command";

export default function DeadBoardPage() {
  const [result, setResult] = useState<CommandResult | null>(null);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#000",
        color: "#eee",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        maxWidth: 1400,
        margin: "0 auto",
      }}
    >
      <header>
        <h1 style={{ margin: 0, fontSize: 22 }}>DNA OS — Dead Board</h1>
        <p style={{ color: "#666", margin: "4px 0 0" }}>
          Command → Router → Supabase → Result
        </p>
      </header>

      <CommandBox onResult={setResult} />
      <ActionPanel />

      <section
        style={{
          border: "1px solid #1a1a1a",
          borderRadius: 12,
          padding: 16,
          background: "#0a0a0a",
        }}
      >
        <ResultViewer result={result} />
      </section>
    </main>
  );
}
