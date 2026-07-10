"use client";

// UIKit — WorkspaceCanvas
// รากของหน้าจอ: ผืนผ้าใบเปล่า ไม่มี dashboard, ไม่มี KPI, ไม่มี welcome/summary
// ทุก component (Dock, Drawer, Inspector, Timeline, Table, Map, Chat, DocumentViewer, PartnerCard, CommandPalette)
// จะปรากฏก็ต่อเมื่อถูกเรียกผ่าน open(key, props) เท่านั้น — ปิดแล้วหายไป ไม่ทิ้งร่องรอย
// AI (cognitive pipeline) เรียกใช้ hook เดียวกันนี้ผ่าน useWorkspace() เพื่อสั่ง Open/Hide Panel ได้เหมือนมนุษย์ทุกประการ

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ComponentKey =
  | "dock"
  | "drawer"
  | "inspector"
  | "timeline"
  | "table"
  | "map"
  | "chat"
  | "document"
  | "partnerCard"
  | "commandPalette";

export interface OpenWindow {
  id: string;
  key: ComponentKey;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props?: Record<string, any>;
}

interface WorkspaceContextValue {
  windows: OpenWindow[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  open: (key: ComponentKey, props?: Record<string, any>) => string;
  close: (id: string) => void;
  closeByKey: (key: ComponentKey) => void;
  isOpen: (key: ComponentKey) => boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace ต้องถูกเรียกภายใน <WorkspaceCanvas> เท่านั้น");
  return ctx;
}

export default function WorkspaceCanvas({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<OpenWindow[]>([]);

  const open = useCallback((key: ComponentKey, props?: Record<string, any>) => {
    const id = key + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
    setWindows((w) => [...w, { id, key, props }]);
    return id;
  }, []);

  const close = useCallback((id: string) => {
    setWindows((w) => w.filter((win) => win.id !== id));
  }, []);

  const closeByKey = useCallback((key: ComponentKey) => {
    setWindows((w) => w.filter((win) => win.key !== key));
  }, []);

  const isOpen = useCallback(
    (key: ComponentKey) => windows.some((w) => w.key === key),
    [windows]
  );

  const value = useMemo(
    () => ({ windows, open, close, closeByKey, isOpen }),
    [windows, open, close, closeByKey, isOpen]
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {/* ผืนผ้าใบเปล่า — ไม่มี element ใดถูก render ที่นี่โดยตรง มีแค่ context provider */}
      <div className="relative w-full h-screen bg-stone-50 overflow-hidden">{children}</div>
    </WorkspaceContext.Provider>
  );
}
