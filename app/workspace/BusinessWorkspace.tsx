"use client";

/**
 * BUSINESS WORKSPACE — หน้าจอใช้งานจริงเพียงหน้าจอเดียว (/workspace)
 *
 * ┌───┬──────────────────┬───────────────────────────────┐
 * │ R │  LEFT WORK AREA  ⇆   RIGHT WORK AREA (tabs)      │
 * └───┴──────────────────┴───────────────────────────────┘
 *
 * reuse ของเดิมทั้งหมด: IconRail · ActionBar · EmptyState · TabStrip (extracted)
 * · BusinessDisplayRenderer (ตัวเดิม) — ไม่มี renderer/executor/scanner ใหม่
 * ไม่มี Top Bar · ไม่มี Bottom Bar ถาวร · ไม่มี pane ที่สาม
 *
 * SLICE-1 (owner decision D1=A, 2026-09-23): component นี้ "ไม่รู้จัก role" และ
 * ห้าม hardcode role — ได้รับ allowedTools (tool key ที่ central authority
 * registry/permissions.json#capability_access อนุญาตแล้ว) ผ่าน props เท่านั้น
 * liveModels/liveTargets มาจาก server เท่านั้น; ไม่มีข้อมูล = รอเชื่อม ไม่ใช้ตัวอย่างแทน
 */
import { useRef, useState } from "react";
import IconRail, { type IconRailItem } from "@/presentation/shell/navigation/IconRail";
import ActionBar from "@/presentation/panels/ActionBar";
import EmptyState from "@/presentation/feedback/EmptyState";
import { BusinessDisplayRenderer } from "@/app/admin/ui-gallery/_lib/BusinessDisplayRenderer";
import type { BusinessDisplayModel } from "@/app/admin/ui-gallery/_lib/businessDisplayModel";
import { TabStrip, type Tab } from "@/presentation/shell/ide/TabStrip";
import { TOOLS, type OpenTarget } from "./_lib/businessTools";
import { ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { TOOL_BINDINGS, orderGrantedTools } from "./_lib/toolBindings";
import { WORKSPACE_APPEARANCE, type WorkspaceAppearance } from "./_lib/workspaceAppearance";
import { WorkspaceSettings } from "./WorkspaceSettings";

const LEFT_MIN = 200;
const LEFT_MAX = 560;
const RAIL_W = 64;

export function BusinessWorkspace({
  allowedTools,
  liveModels = {},
  liveTargets = {},
  canManageSettings = false,
  appearance = WORKSPACE_APPEARANCE,
}: {
  /** tool key ที่ central authority อนุญาต — มาจาก server เท่านั้น (ไม่มี role ในไฟล์นี้) */
  allowedTools: string[];
  /** โมเดลที่สร้างจากข้อมูลจริงต่อ tool key — ไม่มี = แสดงสถานะรอเชื่อม */
  liveModels?: Record<string, BusinessDisplayModel>;
  /** เป้าหมายฝั่งขวาที่สร้างจากข้อมูลจริงเท่านั้น */
  liveTargets?: Record<string, OpenTarget>;
  canManageSettings?: boolean;
  appearance?: WorkspaceAppearance;
}) {
  const tools = orderGrantedTools(TOOLS, allowedTools, appearance.toolOrder);
  const targets = liveTargets;

  const [tool, setTool] = useState(tools[0]?.key ?? "");
  const [leftWidth, setLeftWidth] = useState(Math.min(LEFT_MAX, Math.max(LEFT_MIN, appearance.panelWidth)));
  const [collapsed, setCollapsed] = useState(appearance.panelInitiallyClosed);
  const [screen, setScreen] = useState<"work" | "settings">("work");
  const [tabs, setTabs] = useState<OpenTarget[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const dragging = useRef(false);

  const activeTool = tools.find((t) => t.key === tool) ?? tools[0] ?? null;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const railItems: IconRailItem[] = tools.map((t) => ({ key: t.key, label: t.label, icon: t.icon }));

  function openTarget(id: string) {
    const target = targets[id];
    if (!target) return;
    setTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, target]));
    setActiveTabId(id);
  }
  function closeTab(id: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (id === activeTabId) setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
      return next;
    });
  }

  const tabStripTabs: Tab[] = tabs.map((t) => ({ id: t.id, title: t.title, kind: "file", path: t.id }));
  const binding = TOOL_BINDINGS[activeTool?.key ?? ""];
  const targetActions = (binding?.targetIds ?? [])
    .filter((id) => targets[id])
    .map((id) => ({
      key: id,
      label: targets[id].title,
      icon: ChevronRight,
      onClick: () => openTarget(id),
    }));

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[#F0EBE5] text-stone-800">
      {screen === "settings" && canManageSettings ? (
        <WorkspaceSettings columns={appearance.settingsColumns} onBack={() => setScreen("work")} />
      ) : <>
      {/* ICON RAIL — client launcher (ตำแหน่งเดิมของระบบ) */}
      <div className={`flex shrink-0 flex-col overflow-y-auto ${appearance.railSide === "right" ? "order-last" : ""}`}>
        <IconRail items={railItems} activeKey={collapsed ? "" : tool} onSelect={key => { setTool(key); setCollapsed(false); }} />
        {canManageSettings && <button type="button" aria-label="Settings" onClick={() => setScreen("settings")} className="mt-auto flex min-h-11 items-center justify-center py-3"><Settings className="h-5 w-5" /></button>}
      </div>

      {/* LEFT WORK AREA */}
      {!collapsed && (
        <div className="flex flex-shrink-0 flex-col border-r border-[#E9E1D6] bg-[#FDFBF8]" style={{ width: leftWidth, maxWidth: "calc(100vw - 100px)" }}>
          <div className="flex items-center gap-2 border-b border-[#E9E1D6] px-3 py-2">
            <span className="text-xs font-semibold">{activeTool?.label ?? "ไม่มีเครื่องมือ"}</span>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title="ย่อฝั่งซ้าย"
              className="ml-auto flex h-6 w-6 items-center justify-center rounded-md border border-[#E9E1D6] text-stone-500 hover:border-[#D5C8B6]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>

          {targetActions.length > 0 && <ActionBar actions={targetActions} />}

          <div className="flex-1 overflow-y-auto">
            {activeTool && liveModels[activeTool.key] ? (
              <BusinessDisplayRenderer
                model={liveModels[activeTool.key]}
                onSelectItem={openTarget}
              />
            ) : (
              <EmptyState
                message={activeTool ? activeTool.label : "ยังไม่ได้รับสิทธิ์ใช้งานเครื่องมือ"}
                hint={activeTool ? binding?.pendingReason ?? "ยังไม่ได้เชื่อมความสามารถนี้" : "บัญชีนี้ยังไม่ได้รับอนุญาตให้เปิดเครื่องมือ"}
              />
            )}
            {activeTool && binding?.route && <a href={binding.route} target="_blank" rel="noopener noreferrer" className="m-3 block rounded-lg border border-stone-300 p-3 text-center text-sm">เปิดเครื่องมือเดิมในแท็บใหม่ ↗</a>}
          </div>
        </div>
      )}

      {/* DIVIDER — ลากปรับขนาด LEFT ↔ RIGHT */}
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="เปิดฝั่งซ้าย"
          className="flex w-4 flex-shrink-0 items-center justify-center border-r border-[#E9E1D6] bg-[#F7F4EF] text-stone-400 hover:text-stone-700"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      ) : (
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={(e) => {
            dragging.current = true;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!dragging.current) return;
            setLeftWidth(Math.min(LEFT_MAX, Math.max(LEFT_MIN, e.clientX - (appearance.railSide === "left" ? RAIL_W : 0))));
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          className="w-1 flex-shrink-0 cursor-col-resize bg-[#E9E1D6] hover:bg-[#B49C7C]"
        />
      )}

      {/* RIGHT WORK AREA — พื้นที่ทำงานจริง */}
      <div className="flex min-w-0 flex-1 flex-col bg-[#FDFBF8]">
        <TabStrip
          tabs={tabStripTabs}
          activeTabId={activeTabId}
          onSelect={setActiveTabId}
          onClose={closeTab}
          dirtyTabIds={[]}
          fileStates={{}}
        />
        <div className="flex-1 overflow-y-auto">
          {activeTab ? (
            <BusinessDisplayRenderer model={activeTab.model} />
          ) : (
            <EmptyState
              message="ยังไม่ได้เปิดรายการ"
              hint="เลือกเครื่องมือจากไอคอนด้านซ้าย แล้วกดรายการเพื่อเปิดในพื้นที่นี้"
            />
          )}
        </div>
      </div>
      </>}
    </div>
  );
}
