"use client";

import { useState, useEffect, useCallback } from "react";
import CommandBox from "@/components/CommandBox";
import ResultViewer from "@/components/ResultViewer";
import ActionPanel from "@/components/ActionPanel";
import ActionModal from "@/components/ActionModal";
import ToastContainer, { useToast } from "@/components/Toast";
import { subscribePayments } from "@/lib/actions/realtime";
import type { CommandResult } from "@/types/command";
import type { ActionResponse } from "@/lib/actions/dna-actions";

export default function DeadBoardV2Page() {
  const [result, setResult] = useState<CommandResult | null>(null);
  const [preview, setPreview] = useState<ActionResponse | null>(null);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const [executing, setExecuting] = useState(false);
  const { toasts, push: pushToast } = useToast();

  useEffect(() => {
    const unsub = subscribePayments((event) => {
      if (event.table === "invoice_payments" && event.type === "INSERT") {
        const amt = event.record.payment_amount;
        pushToast(`รับชำระเงิน ${Number(amt).toLocaleString()} บาท`);
      }
      if (event.table === "invoice_debts" && event.type === "UPDATE") {
        const status = event.record.invoice_status;
        if (status === "PAID") {
          pushToast(`หนี้ชำระครบแล้ว`);
        }
      }
      if (event.table === "documents" && event.type === "INSERT") {
        const docNum = event.record.document_number;
        pushToast(`เอกสารใหม่: ${docNum}`);
      }
    });
    return unsub;
  }, [pushToast]);

  const handleResult = useCallback((r: CommandResult) => {
    setResult(r);

    if (r.ok && r.command.action.endsWith(".create")) {
      handlePreview(r.command.action, r.command.payload ?? {});
    }
  }, []);

  async function handlePreview(action: string, payload: Record<string, unknown>) {
    try {
      const res = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, mode: "preview", payload }),
      });
      const data: ActionResponse = await res.json();
      setPreview(data);
      setPendingPayload({ action, payload });
    } catch {
      setPreview({ ok: false, mode: "preview", action, error: "เชื่อมต่อ API ไม่ได้" });
    }
  }

  async function handleConfirm() {
    if (!pendingPayload) return;
    setExecuting(true);
    try {
      const res = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: pendingPayload.action,
          mode: "execute",
          payload: pendingPayload.payload,
        }),
      });
      const data: ActionResponse = await res.json();
      if (data.ok) {
        pushToast(`สำเร็จ: ${data.action}`);
        setResult({
          ok: true,
          command: { action: data.action },
          data: data.result,
        });
      } else {
        setResult({
          ok: false,
          command: { action: data.action },
          error: data.error,
        });
      }
    } catch {
      pushToast("ข้อผิดพลาด: เชื่อมต่อ API ไม่ได้");
    } finally {
      setExecuting(false);
      setPreview(null);
      setPendingPayload(null);
    }
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
            Command → Preview → Confirm → Execute → Realtime
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

      <CommandBox onResult={handleResult} />
      <ActionPanel />

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
        onCancel={() => { setPreview(null); setPendingPayload(null); }}
      />

      <ToastContainer toasts={toasts} />
    </main>
  );
}
