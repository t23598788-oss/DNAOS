"use client";

import { useState, useEffect, useCallback } from "react";

interface ToastItem {
  id: number;
  message: string;
}

let _nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string) => {
    const id = ++_nextId;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  return { toasts, push };
}

export default function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;

  return (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 1000, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: "#22c55e",
            color: "#000",
            padding: "12px 20px",
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            animation: "fadeIn 0.3s ease",
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
