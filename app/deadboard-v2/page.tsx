"use client";

import { useState, useEffect, useCallback } from "react";
import CommandBoxAI from "@/components/CommandBoxAI";
import ResultViewer from "@/components/ResultViewer";
import ActionPanel from "@/components/ActionPanel";
import ActionModal from "@/components/ActionModal";
import ToastContainer, { useToast } from "@/components/Toast";
import { subscribePayments } from "@/lib/v2-rules/realtime";
import type { CommandResult } from "@/types/command";
import type { ActionResponse } from "@/lib/v2-rules/actions";

export default function DeadBoardV2Page() {
  const [result, setResult] = useState<CommandResult | null>(null);
  const [preview, setPreview] = useState<ActionResponse | null>(null);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [pendingPayload, setPendingPayload] = useState<{ action: string; payload: Record<string, unknown> } | null>(null);
  const [executing, setExecuting] = useState(false);
  const [candidates, setCandidates] = useState<Record<string, unknown>[] | null>(null);
  const [findContext, setFindContext] = useState<{ domain: string } | null>(null);
  const { toasts, push: pushToast } = useToast();

  // ---- Realtime ----
  useEffect(() => {
    const unsub = subscribePayments((event) => {
      if (event.table === "invoice_payments" && event.type === "INSERT") {
        pushToast(`รับชำระเงิน ${Number(event.record.payment_amount).toLocaleString()} บาท`);
      }
      if (event.table === "invoice_debts" && event.type === "UPDATE" && event.record.invoice_status === "PAID") {
        pushToast(`หนี้ชำระครบแล้ว`);
      }
      if (event.table === "documents" && event.type === "INSERT") {
        pushToast(`เอกสารใหม่: ${event.record.document_number}`);
      }
    });
    return unsub;
  }, [pushToast]);

  // ---- Parse .find commands from V1 result ----
  const handleResult = useCallback(async (r: CommandResult) => {
    setResult(r);
    setCandidates(null);
    setFindContext(null);

    if (!r.ok) return;

    // If V1 command returned a list, check if user intended a find
    if (r.command.action.endsWith(".create")) {
      await handlePreview(r.command.action, r.command.payload ?? {});
    }
  }, []);

  // ---- FIND ----
  async function handleFind(domain: string, keyword: string) {
    try {
      const res = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "find", domain, keyword }),
      });
      const data = await res.json();

      if (data.found === "exact") {
        setCandidates(null);
        setFindContext(null);
        setResult({
          ok: true,
          command: { action: `${domain}.find` },
          data: { ...data.record, next_actions: data.next_actions },
        });
      } else if (data.found === "ambiguous") {
        setCandidates(data.candidates);
        setFindContext({ domain });
        setResult({
          ok: false,
          command: { action: `${domain}.find` },
          error: data.error,
        });
      } else {
        setCandidates(null);
        setResult({
          ok: false,
          command: { action: `${domain}.find` },
          error: data.error,
        });
      }
    } catch {
      setResult({ ok: false, command: { action: `${domain}.find` }, error: "เชื่อมต่อ API ไม่ได้" });
    }
  }

  function handleSelectCandidate(candidate: Record<string, unknown>) {
    setCandidates(null);
    const name = (candidate.customer_name ?? candidate.name ?? candidate.document_number ?? "") as string;
    if (findContext) {
      handleFind(findContext.domain, name);
    }
  }

  // ---- PREVIEW ----
  async function handlePreview(action: string, payload: Record<string, unknown>) {
    try {
      const res = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, mode: "preview", payload }),
      });
      const data: ActionResponse = await res.json();
      setPreview(data);
      setPreviewToken(data.preview_token ?? null);
      setPendingPayload({ action, payload });
    } catch {
      setPreview({ ok: false, mode: "preview", action, error: "เชื่อมต่อ API ไม่ได้" });
    }
  }

  // ---- EXECUTE (ต้องมี token จาก preview) ----
  async function handleConfirm() {
    if (!pendingPayload || !previewToken) return;
    setExecuting(true);
    try {
      const res = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: pendingPayload.action,
          mode: "execute",
          payload: pendingPayload.payload,
          preview_token: previewToken,
        }),
      });
      const data: ActionResponse = await res.json();
      if (data.ok) {
        pushToast(`สำเร็จ: ${data.action}`);
        setResult({
          ok: true,
          command: { action: data.action },
          data: { ...data.result, next_actions: data.next_actions },
        });
      } else {
        setResult({ ok: false, command: { action: data.action }, error: data.error });
      }
    } catch {
      pushToast("ข้อผิดพลาด: เชื่อมต่อ API ไม่ได้");
    } finally {
      setExecuting(false);
      setPreview(null);
      setPreviewToken(null);
      setPendingPayload(null);
    }
  }

  // ---- Enhanced CommandBox handler: detect .find syntax ----
  function handleCommandInput(r: CommandResult) {
    const raw = r.command.payload?.source as string | undefined;
    if (raw) {
      const findMatch = raw.match(/^\.(\w+)\s+find\s+(.+)$/i);
      if (findMatch) {
        handleFind(findMatch[1], findMatch[2].trim());
        return;
      }
    }
    handleResult(r);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#000",
        color: "#eee",
        padding: "24px 48px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>DNA OS — Dead Board V2</h1>
          <p style={{ color: "#666", margin: "4px 0 0" }}>
            Command → Find → Preview → Confirm → Execute → Realtime
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ padding: "4px 12px", borderRadius: 12, background: "#22c55e22", color: "#22c55e", fontSize: 12 }}>
            Realtime ON
          </span>
          <span style={{ padding: "4px 12px", borderRadius: 12, background: "#333", color: "#888", fontSize: 12 }}>
            AI: OFF (V3)
          </span>
        </div>
      </header>

      <CommandBoxAI onResult={handleCommandInput} />
      <ActionPanel />

      {/* Candidate Selector */}
      {candidates && candidates.length > 0 && (
        <div style={{ border: "1px solid #f59e0b", borderRadius: 12, padding: 16, background: "#1a1400" }}>
          <p style={{ margin: "0 0 12px", color: "#f59e0b", fontWeight: 600 }}>
            พบหลายรายการ — กรุณาเลือก:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {candidates.map((c, i) => (
              <button
                key={i}
                onClick={() => handleSelectCandidate(c)}
                style={{
                  textAlign: "left",
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "#111",
                  color: "#eee",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                {Object.values(c).filter(v => v !== null).join("  |  ")}
              </button>
            ))}
          </div>
        </div>
      )}

      <section
        style={{
          border: "1px solid #1a1a1a",
          borderRadius: 12,
          padding: 16,
          background: "#0a0a0a",
          flex: 1,
          minHeight: 400,
        }}
      >
        <ResultViewer result={result} />
      </section>

      <ActionModal
        preview={preview}
        loading={executing}
        onConfirm={handleConfirm}
        onCancel={() => { setPreview(null); setPreviewToken(null); setPendingPayload(null); }}
      />

      <ToastContainer toasts={toasts} />
    </main>
  );
}
