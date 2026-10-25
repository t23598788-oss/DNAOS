"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FilePlus2,
  Files,
  MessageSquare,
  Mountain,
  Settings,
  X,
} from "lucide-react";
import { openExternal } from "@/components/admin/openExternal";

const INTERNAL_TABS = [
  { route: "/workspace", label: "Workspace", icon: MessageSquare },
  { route: "/admin/create-document", label: "สร้างเอกสาร", icon: FilePlus2 },
  { route: "/admin/documents", label: "เอกสาร", icon: Files },
  { route: "/admin/pits", label: "ศูนย์ควบคุมทรัพยากร", icon: Mountain },
  { route: "/admin/settings", label: "ตั้งค่า", icon: Settings },
] as const;

type InternalRoute = (typeof INTERNAL_TABS)[number]["route"];
type DesktopTab = { id: InternalRoute; route: InternalRoute; label: string };

const TAB_BY_ROUTE = new Map(INTERNAL_TABS.map((tab) => [tab.route, tab]));
const INITIAL_TAB: DesktopTab = { id: "/workspace", route: "/workspace", label: "Workspace" };

function desktopTabUrl(route: InternalRoute) {
  if (route === "/workspace") return "/workspace?desktopContent=1";
  return `${route}${route.includes("?") ? "&" : "?"}desktop=1`;
}

/**
 * Presentation-only macOS desktop workspace. Business pages continue to run
 * from their established routes, layouts, auth guards, APIs, and data model.
 *
 * EMBEDDED (owner 2026-10-18 — SINGLE SIDEBAR / LOCK EXISTING LAYOUT):
 * งานนี้ตรวจแล้วว่า shell ของ workspace (`public/material-workspace`) เป็น "เจ้าของ navigation หลัก"
 * และ component นี้เป็น "แหล่งซ้ำ" เมื่อถูกฝังใน shell: มันวาด aside (216px) + tab strip (46px)
 * ของตัวเอง ⇒ ผู้ใช้เห็น sidebar 2 ชุด (48px + 216px) และ top bar 2 ชั้น (shell header + tab strip)
 * ในโหมด embedded จึงไม่วาด aside/tab strip ของตัวเอง แต่ยังคง"ใช้ของเดิม": จัดเส้นทางเครื่องมือ
 * ไปที่ iframe เดิมที่มีอยู่ (tabs) และรับคำสั่งเปิดเส้นทางผ่านข้อความ `dna-desktop-open-route`
 * ที่ component นี้รองรับอยู่แล้ว · ไม่ลบหน้า ไม่สร้าง navigation/ไอคอนใหม่
 */
export function DesktopWorkspaceShell({ embedded = false }: { embedded?: boolean } = {}) {
  const [tabs, setTabs] = useState<DesktopTab[]>([INITIAL_TAB]);
  const [activeId, setActiveId] = useState<InternalRoute>(INITIAL_TAB.id);

  const openRoute = useCallback((route: string) => {
    const definition = TAB_BY_ROUTE.get(route as InternalRoute);
    if (!definition) return;

    setTabs((current) => (
      current.some((tab) => tab.id === definition.route)
        ? current
        : [...current, { id: definition.route, route: definition.route, label: definition.label }]
    ));
    setActiveId(definition.route);
  }, []);

  const closeTab = useCallback((id: InternalRoute) => {
    if (id === INITIAL_TAB.id) return;
    setTabs((current) => {
      const closingIndex = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      setActiveId((active) => {
        if (active !== id) return active;
        return next[Math.max(0, closingIndex - 1)]?.id ?? INITIAL_TAB.id;
      });
      return next;
    });
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "dna-desktop-open-route" && typeof event.data.route === "string") {
        openRoute(event.data.route);
      }
      if (event.data.type === "dna-desktop-open-external" && typeof event.data.url === "string") {
        void openExternal(event.data.url);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [openRoute]);

  const visibleTabs = useMemo(() => tabs.map((tab) => ({ ...tab, active: tab.id === activeId })), [activeId, tabs]);

  return (
    <main
      aria-label="DNA OS Desktop Workspace"
      style={{
        height: "100dvh",
        minHeight: 0,
        display: "flex",
        overflow: "hidden",
        background: "#f7f5f1",
        color: "#292724",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* EMBEDDED: ไม่วาด aside ของตัวเอง — shell เป็นเจ้าของ sidebar เพียงชุดเดียว */}
      {!embedded && (
      <aside
        aria-label="DNA OS navigation"
        data-testid="desktop-rail"
        style={{ width: 216, flex: "0 0 216px", minHeight: 0, display: "flex", flexDirection: "column", borderRight: "1px solid #e5dfd6", background: "#fcfbf9", padding: "16px 10px" }}
      >
        <div style={{ padding: "5px 10px 18px", fontWeight: 700, letterSpacing: "0.02em" }}>DNA OS</div>
        <nav style={{ display: "grid", gap: 4 }}>
          {INTERNAL_TABS.map((item) => {
            const Icon = item.icon;
            const active = activeId === item.route;
            return (
              <button
                key={item.route}
                type="button"
                onClick={() => openRoute(item.route)}
                aria-current={active ? "page" : undefined}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: 0, borderRadius: 9, padding: "10px", background: active ? "#e9eee8" : "transparent", color: "inherit", cursor: "pointer", font: "inherit", textAlign: "left" }}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div style={{ marginTop: "auto", paddingTop: 18 }}>
          <button
            type="button"
            onClick={() => void openExternal("https://manager.line.biz/")}
            style={{ width: "100%", border: "1px solid #ded8cf", borderRadius: 9, padding: "9px 10px", background: "#fff", color: "inherit", cursor: "pointer", font: "inherit", textAlign: "left" }}
          >
            เปิด LINE OA ในเบราว์เซอร์
          </button>
        </div>
      </aside>
      )}

      <section style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {/* EMBEDDED: ไม่วาด tab strip ของตัวเอง — shell header เป็น top bar เพียงชุดเดียว */}
        {!embedded && (
        <div aria-label="Open tabs" role="tablist" data-testid="desktop-tabstrip" style={{ height: 46, flex: "0 0 46px", display: "flex", alignItems: "end", gap: 4, overflowX: "auto", padding: "0 12px", borderBottom: "1px solid #e5dfd6", background: "#f1eee8" }}>
          {visibleTabs.map((tab) => (
            <div key={tab.id} role="presentation" style={{ display: "flex", alignItems: "center", maxWidth: 220, height: 38, borderRadius: "8px 8px 0 0", background: tab.active ? "#fff" : "#e8e4dc", border: tab.active ? "1px solid #e5dfd6" : "1px solid transparent", borderBottom: tab.active ? "1px solid #fff" : undefined }}>
              <button
                type="button"
                role="tab"
                aria-selected={tab.active}
                onClick={() => setActiveId(tab.id)}
                style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: "9px 8px 9px 12px", font: "13px/1.2 inherit" }}
              >
                {tab.label}
              </button>
              {tab.id !== INITIAL_TAB.id && (
                <button type="button" aria-label={`ปิดแท็บ ${tab.label}`} onClick={() => closeTab(tab.id)} style={{ display: "grid", placeItems: "center", width: 28, height: 28, flex: "0 0 28px", border: 0, background: "transparent", color: "#716c64", cursor: "pointer" }}>
                  <X size={15} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
        )}
        <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", background: "#fff" }}>
          {tabs.map((tab) => (
            <iframe
              key={tab.id}
              title={`DNA OS — ${tab.label}`}
              src={desktopTabUrl(tab.route)}
              style={{ display: tab.id === activeId ? "block" : "none", width: "100%", height: "100%", border: 0, background: "#fff" }}
            />
          ))}
        </div>
      </section>
    </main>
  );
}


/** ผู้ใช้ทุกตัว import แบบ named ({ DesktopWorkspaceShell }) — default export = duplicate ของ knip */