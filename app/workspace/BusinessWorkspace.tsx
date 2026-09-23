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
 */
import { useRef, useState } from "react";
import IconRail, { type IconRailItem } from "@/presentation/shell/navigation/IconRail";
import ActionBar from "@/presentation/panels/ActionBar";
import EmptyState from "@/presentation/feedback/EmptyState";
import { BusinessDisplayRenderer } from "@/app/admin/ui-gallery/_lib/BusinessDisplayRenderer";
import { TabStrip, type Tab } from "@/presentation/shell/ide/TabStrip";
import { TOOLS, OPEN_TARGETS, type OpenTarget } from "./_lib/businessTools";
import { ChevronLeft, ChevronRight } from "lucide-react";

const LEFT_DEFAULT = 300;
const LEFT_MIN = 200;
const LEFT_MAX = 560;
const RAIL_W = 64;

/** รายการที่เปิดได้ต่อเครื่องมือ (กดจากฝั่งซ้าย → เปิด tab ฝั่งขวา) */
const TOOL_TARGETS: Record<string, string[]> = {
  documents: ["d-sales", "d-invoice", "d-attach"],
  search: ["sr1"],
  chat: ["cv"],
  connections: ["c1"],
  changes: ["d-attach"],
  problems: ["d-attach"],
};

export function BusinessWorkspace() {
  const [tool, setTool] = useState(TOOLS[0].key);
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [collapsed, setCollapsed] = useState(false);
  const [tabs, setTabs] = useState<OpenTarget[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const dragging = useRef(false);

  const activeTool = TOOLS.find((t) => t.key === tool) ?? TOOLS[0];
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const railItems: IconRailItem[] = TOOLS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }));

  function openTarget(id: string) {
    const target = OPEN_TARGETS[id];
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
  const targetActions = (TOOL_TARGETS[activeTool.key] ?? []).map((id) => ({
    key: id,
    label: OPEN_TARGETS[id]?.title ?? id,
    icon: ChevronRight,
    onClick: () => openTarget(id),
  }));

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[#F0EBE5] text-stone-800">
      {/* ICON RAIL — client launcher (ตำแหน่งเดิมของระบบ) */}
      <IconRail items={railItems} activeKey={tool} onSelect={setTool} />

      {/* LEFT WORK AREA */}
      {!collapsed && (
        <div className="flex flex-shrink-0 flex-col border-r border-[#E9E1D6] bg-[#FDFBF8]" style={{ width: leftWidth }}>
          <div className="flex items-center gap-2 border-b border-[#E9E1D6] px-3 py-2">
            <span className="text-xs font-semibold">{activeTool.label}</span>
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
            <BusinessDisplayRenderer model={activeTool.leftModel} onSelectItem={openTarget} />
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
            setLeftWidth(Math.min(LEFT_MAX, Math.max(LEFT_MIN, e.clientX - RAIL_W)));
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
    </div>
  );
}
