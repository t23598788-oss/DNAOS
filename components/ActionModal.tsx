"use client";

import type { ActionResponse } from "@/lib/actions/dna-actions";

interface Props {
  preview: ActionResponse | null;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ActionModal({ preview, loading, onConfirm, onCancel }: Props) {
  if (!preview) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
      }}
    >
      <div
        style={{
          background: "#111",
          border: "1px solid #333",
          borderRadius: 12,
          padding: 24,
          maxWidth: 600,
          width: "90%",
          color: "#eee",
        }}
      >
        <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>
          {preview.ok ? "ยืนยันคำสั่ง" : "ข้อผิดพลาด"}
        </h2>

        {preview.ok ? (
          <pre
            style={{
              background: "#0a0a0a",
              padding: 16,
              borderRadius: 8,
              overflow: "auto",
              fontSize: 13,
              color: "#e5e7eb",
              maxHeight: 400,
            }}
          >
            {JSON.stringify(preview.preview, null, 2)}
          </pre>
        ) : (
          <p style={{ color: "#f87171" }}>{preview.error}</p>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 16, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #333",
              background: "#222",
              color: "#aaa",
              cursor: "pointer",
            }}
          >
            ยกเลิก
          </button>
          {preview.ok && (
            <button
              onClick={onConfirm}
              disabled={loading}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                background: loading ? "#555" : "#22c55e",
                color: "#000",
                fontWeight: 600,
                cursor: loading ? "default" : "pointer",
              }}
            >
              {loading ? "กำลังดำเนินการ..." : "ยืนยัน Execute"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
