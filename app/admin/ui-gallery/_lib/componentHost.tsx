"use client";

// UI Gallery — componentHost.tsx
// ที่เดียวในทั้ง Gallery ที่ import UI component จริง เพื่อ render ใน preview/lab
//
// กติกา (Owner ข้อ 6): ห้าม copy source UI (import จากไฟล์ต้นทางจริงเท่านั้น),
// ห้ามสร้าง mock UI (ใช้ EMPTY_RENDER_MODEL / EmptyState / props ว่าง แทนการ
// ประดิษฐ์ข้อมูลธุรกิจ), ห้าม redesign (โฮสต์ครอบแค่กรอบ/ความสูง)
//
// แยกจาก uiCatalog.ts (ข้อมูลล้วน) เพื่อไม่ให้ข้อมูลลาก UI + dependency เข้า bundle

import type { ElementType, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Briefcase, LayoutGrid, User, Users } from "lucide-react";

import AppShell from "@/presentation/shell/AppShell";
import IconRail, { type IconRailItem } from "@/presentation/shell/navigation/IconRail";
import ListColumn from "@/presentation/shell/navigation/ListColumn";
import Inspector from "@/presentation/panels/Inspector";
import MapView from "@/presentation/viewer/MapView";
import Window from "@/presentation/panels/Window";
import EmptyState from "@/presentation/feedback/EmptyState";
import ActionBar from "@/presentation/panels/ActionBar";
import FlexPreview from "@/presentation/viewer/FlexPreview";

import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import PortalShell from "@/presentation/shell/PortalShell";
import CapabilityPageShell from "@/presentation/shell/PortalShell";
import { Panel, StatusPill, TemplateShell } from "@/presentation/shell/TemplateShell";

import AdminSidebarNav from "@/components/admin/AdminSidebarNav";
import SettingsDrawer from "@/components/settings/SettingsDrawer";
import LogoutButton from "@/components/auth/LogoutButton";
import CapabilitySkeleton from "@/presentation/feedback/CapabilitySkeleton";
import CopyButton from "@/presentation/feedback/CopyButton";
import FileUpload from "@/presentation/documents/FileUpload";

import { DashboardBoard } from "@/presentation/shell/workspace/DashboardBoard";
import { NotImplementedBoard } from "@/presentation/shell/workspace/NotImplementedBoard";
import { ModulePalette } from "@/components/workspace/canvas/ModulePalette";
import { ModuleInspector } from "@/components/workspace/canvas/ModuleInspector";
import { PropertyInspector } from "@/components/workspace/canvas/PropertyInspector";
import { Canvas } from "@/components/workspace/canvas";
import type { CanvasNode } from "@/components/workspace/canvas/types";
import { SystemRealityReportSection } from "@/components/workspace/SystemRealityReportSection";

import { EMPTY_RENDER_MODEL } from "@/core/workspace/renderModel";
import { resolveBoard } from "@/core/workspace/boardRouter";
import type { BoardType } from "@/core/workspace/board";
import { workspaceLayoutStore } from "@/core/workspace/workspaceLayout";
import { resolveNavItems } from "@/core/navigation/resolveNavItems";
import { ThemeProvider, ThemeToggle } from "@/presentation/foundation/tokens";

// Presentation canonical ที่ยังไม่มี consumer — เพิ่มรอบ Owner review (2026-09-22)
// ใช้ของจริงทั้งหมด: ไม่ copy source, ไม่สร้าง mock UI, ไม่ redesign
import Viewer from "@/presentation/viewer/Viewer";
import DataTable from "@/presentation/table/DataTable";
import FormField from "@/presentation/form/FormField";
import FormActions from "@/presentation/form/FormActions";
import { ChatInput } from "@/presentation/ai/ChatInput";
import { ChatMessageList } from "@/presentation/ai/ChatMessageList";
import { ClarifyingChoice } from "@/presentation/ai/ClarifyingChoice";
import { ConfirmationPreview } from "@/presentation/ai/ConfirmationPreview";
import { ResultCard } from "@/presentation/ai/ResultCard";
import { presentationAssets } from "@/presentation/assets/manifest";

const RAIL_ICON: Record<string, ElementType> = { LayoutGrid, Briefcase, Users, User };

/** nav items จริงจาก core/navigation/resolveNavItems.ts (ไม่ใช่รายการที่ประดิษฐ์ขึ้น) */
export const REAL_NAV_ITEMS = resolveNavItems("admin");

export const REAL_RAIL_ITEMS: IconRailItem[] = REAL_NAV_ITEMS.map((n) => ({
  key: n.key,
  label: n.label,
  icon: RAIL_ICON[n.icon] ?? LayoutGrid,
  href: n.href,
}));

/** เนื้อหากลางที่โฮสต์ป้อนให้ shell — ไม่มีข้อมูลธุรกิจ */
function NeutralContent({ label }: { label: string }) {
  return (
    <div className="p-6">
      <EmptyState
        message={label}
        hint="โฮสต์ของ UI Gallery ป้อน props ว่างเพื่อสาธิตโครงสร้างของ shell — ไม่ได้ใส่ข้อมูลธุรกิจตัวอย่าง"
      />
    </div>
  );
}

/** โหนดตัวอย่างสำหรับ Inspector — ชี้ไป module จริงที่ลงทะเบียนใน module-registry.json */
const PREVIEW_NODE: CanvasNode = {
  instanceId: "ui-gallery-preview-node",
  // Phase 4.1: ชี้ canonical หลัง npm run sync ลงทะเบียน presentation/ แล้ว
  // (เดิมชี้ "components/ui-kit/IconRail.tsx" ซึ่งเป็น bridge ที่ถูกลบไปแล้ว)
  // ตรวจแล้วว่า moduleRegistry.get() ของ path นี้ resolve ได้จริง
  // — ส่วนที่แสดงจะไม่หาย เพราะ NodeRenderer มี `if (!module) return null`
  moduleId: "presentation/shell/navigation/IconRail.tsx",
  x: 40,
  y: 40,
  width: 224,
  height: 120,
  color: "#ffffff",
  visibility: "visible",
  dockPosition: "floating",
};

const NOOP = () => {};

/** Canvas ต้องมี initialLayout — สร้างจาก workspaceLayoutStore.createEmpty() จริง */
function CanvasPreview() {
  const [layout, setLayout] = useState<ReturnType<typeof workspaceLayoutStore.createEmpty> | null>(null);
  useEffect(() => {
    setLayout(workspaceLayoutStore.createEmpty("UI Gallery Preview"));
  }, []);
  if (!layout) {
    return <div className="h-[520px] flex items-center justify-center text-xs text-stone-400">กำลังเตรียม Canvas…</div>;
  }
  return (
    <div className="h-[520px]">
      <Canvas initialLayout={layout} />
    </div>
  );
}

/** Flex Message แบบโครงสร้างล้วน — ไม่มีเลขที่เอกสาร/ยอดเงิน/ชื่อลูกค้า */
const STRUCTURAL_FLEX = {
  type: "bubble",
  size: "mega",
  header: {
    type: "box",
    layout: "vertical",
    contents: [{ type: "text", text: "Flex Message (โครงสร้างตัวอย่าง)", weight: "bold", size: "md" }],
  },
  body: {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [
      { type: "text", text: "ตัวอย่างโครงสร้างการ์ด ไม่มีข้อมูลธุรกิจ", size: "sm", color: "#777777", wrap: true },
      { type: "separator", margin: "md" },
      { type: "text", text: "บรรทัดตัวอย่าง", size: "sm", margin: "md" },
    ],
  },
  footer: {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: [
      { type: "button", style: "primary", action: { label: "ปุ่มตัวอย่าง" } },
      { type: "button", action: { label: "ปุ่มตัวอย่าง" } },
    ],
  },
};

/** props ที่ LAB ปรับได้ (ส่งเข้า component จริงเท่านั้น — ไม่มีสำเนา) */
export interface HostProps {
  /** rail item ที่ให้แสดง (กรองจาก REAL_RAIL_ITEMS ของจริง) */
  railKeys?: string[];
  /** WorkspaceShell theme */
  theme?: "dark" | "light";
  /** board type สำหรับ resolveBoard() */
  boardType?: BoardType;
  /** ให้ ListColumn ย่อ/ขยายได้ (ค่า width เก็บที่ localStorage key เดียวกับแอปจริง) */
  listCollapsible?: boolean;
}

/** กรอบจำกัดความสูง — shell หลายตัวเป็น h-screen/min-h-screen จึงต้องมีกรอบ */
function Stage({ children, height = 560 }: { children: ReactNode; height?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white" style={{ height }}>
      {children}
    </div>
  );
}


/**
 * hostKey ที่มีโฮสต์จริง — ใช้ตรวจความสอดคล้องกับ uiCatalog.ts
 * (ถ้า uiCatalog อ้าง hostKey ที่ไม่มีที่นี่ Preview/Lab จะขึ้น "ยังไม่มีโฮสต์")
 */
export const HOST_KEYS = [
  "shell-app-shell",
  "shell-workspace-shell",
  "shell-portal-shell",
  "shell-capability-page-shell",
  "shell-template-shell",
  "shell-theme-provider",
  "sidebar-icon-rail",
  "sidebar-list-column",
  "sidebar-admin-sidebar-nav",
  "sidebar-settings-drawer",
  "board-dashboard-board",
  "board-not-implemented",
  "board-type-any",
  "panel-inspector",
  "panel-property-inspector",
  "panel-module-inspector",
  "panel-system-reality-report",
  "panel-module-palette",
  "canvas-editor",
  "comp-window",
  "comp-empty-state",
  "comp-action-bar",
  "comp-map-view",
  "comp-flex-preview",
  "comp-capability-skeleton",
  "comp-copy-button",
  "comp-file-upload",
  "login-logout-button",
  "comp-status-pill",
  "comp-template-panel",
  // presentation canonical (ตัวที่ยังไม่มี consumer)
  "presentation-viewer",
  "presentation-data-table",
  "presentation-form-field",
  "presentation-form-actions",
  "presentation-assets-manifest",
  "ai-chat-input",
  "ai-chat-message-list",
  "ai-clarifying-choice",
  "ai-confirmation-preview",
  "ai-result-card",
] as const;

export function hasHost(hostKey?: string): boolean {
  return !!hostKey && (HOST_KEYS as readonly string[]).includes(hostKey);
}

const NO_SESSION = "(preview — ไม่มี session ในโฮสต์)";

/**
 * renderHost — คืน React node ของ component จริงตาม hostKey
 * ทุกกรณีใช้ props ว่าง / EMPTY_RENDER_MODEL เท่านั้น ไม่ประดิษฐ์ข้อมูลธุรกิจ
 */
export function renderHost(hostKey: string | undefined, props: HostProps = {}): ReactNode {
  if (!hostKey) return null;

  const railItems = props.railKeys
    ? REAL_RAIL_ITEMS.filter((r) => props.railKeys!.includes(r.key))
    : REAL_RAIL_ITEMS;
  const theme = props.theme ?? "dark";
  const boardType: BoardType = props.boardType ?? "dashboard";
  const BoardForType = resolveBoard(boardType);

  switch (hostKey) {
    case "shell-app-shell":
      return (
        <Stage>
          <AppShell
            railItems={railItems}
            activeRailKey={railItems[0]?.key ?? "admin"}
            onSelectRail={NOOP}
            listItems={[]}
            onSelectList={NOOP}
            listSearchPlaceholder="ค้นหา..."
            listEmptyMessage="ยังไม่มีรายการ (โฮสต์ป้อน props ว่าง)"
            listCollapsible
          >
            <NeutralContent label="AppShell — พื้นที่เนื้อหาหลัก (children)" />
          </AppShell>
        </Stage>
      );

    case "shell-workspace-shell":
      return (
        <Stage>
          <WorkspaceShell navItems={REAL_NAV_ITEMS} activeKey="admin" userEmail={NO_SESSION} theme={theme}>
            <NeutralContent label={`WorkspaceShell — theme="${theme}"`} />
          </WorkspaceShell>
        </Stage>
      );

    case "shell-portal-shell":
      return (
        <Stage>
          <PortalShell portalId="business_portal">
            <NeutralContent label="PortalShell — children (ไม่มีข้อมูลธุรกิจ)" />
          </PortalShell>
        </Stage>
      );

    case "shell-capability-page-shell":
      return (
        <Stage>
          <CapabilityPageShell
            title="CapabilityPageShell (ตัวอย่าง)"
            description="shell ตัวจริงจาก presentation/shell/PortalShell.tsx"
          >
            <NeutralContent label="CapabilityPageShell — children" />
          </CapabilityPageShell>
        </Stage>
      );

    case "shell-template-shell":
      return (
        <Stage>
          <TemplateShell title="TemplateShell (ตัวอย่าง)">
            <NeutralContent label="TemplateShell — children" />
          </TemplateShell>
        </Stage>
      );

    case "shell-theme-provider":
      return (
        <ThemeProvider>
          <div className="p-6 space-y-4">
            <div className="text-xs text-stone-500">
              ThemeProvider + ThemeToggle จาก presentation/foundation/tokens/index.tsx — ค่าที่เลือกเก็บใน localStorage key เดียวกับที่แอปจริงใช้
            </div>
            <ThemeToggle />
            <div className="rounded-xl border border-stone-200 p-4 text-xs text-stone-600">
              ตัวอย่างพื้นที่ที่ได้สีจาก token (ไม่ใช่ข้อมูลธุรกิจ)
            </div>
          </div>
        </ThemeProvider>
      );


    case "sidebar-icon-rail":
      return (
        <Stage height={360}>
          <div className="flex h-full">
            <IconRail items={railItems} activeKey={railItems[0]?.key ?? "admin"} onSelect={NOOP} />
            <div className="flex-1 flex items-center justify-center text-xs text-stone-400">
              IconRail (rail จริง 64px) — พื้นที่ด้านขวาคือเนื้อหาหลักของ shell
            </div>
          </div>
        </Stage>
      );

    case "sidebar-list-column":
      return (
        <Stage height={420}>
          <div className="flex h-full">
            <ListColumn
              items={[]}
              onSelect={NOOP}
              searchPlaceholder="ค้นหา..."
              emptyMessage="ยังไม่มีรายการ (โฮสต์ป้อน props ว่าง)"
              collapsible={props.listCollapsible ?? true}
            />
            <div className="flex-1 flex items-center justify-center text-xs text-stone-400">
              ListColumn (300 / 64 / 0 px) — กดปุ่มย่อในตัว component เพื่อสลับความกว้าง
            </div>
          </div>
        </Stage>
      );

    case "sidebar-admin-sidebar-nav": {
      const items = [
        { href: "/admin/line-customers", label: "เมนูตัวอย่าง 1", icon: "LayoutGrid", group: undefined as string | undefined },
        { href: "/admin/relationships", label: "เมนูตัวอย่าง 2", icon: "Network", group: undefined as string | undefined },
        { href: "/admin/ide", label: "เมนูตัวอย่าง (dev)", icon: "Cpu", group: "dev" as string | undefined },
      ];
      return (
        <Stage height={420}>
          <AdminSidebarNav navItems={items} headerLabel="AdminSidebarNav (orphan)" headerIcon="LayoutGrid" userEmail={NO_SESSION} />
        </Stage>
      );
    }

    case "sidebar-settings-drawer":
      return (
        <div className="p-6">
          <div className="text-xs text-stone-500 mb-3">
            SettingsDrawer แสดงเป็นปุ่มก่อน — กดแล้วเปิด drawer แบบ <code className="font-mono">fixed inset-0</code>{" "}
            ทับทั้งหน้าจอ (พฤติกรรมจริงของ component) และจะ fetch /api/admin/settings จริง
          </div>
          <SettingsDrawer />
        </div>
      );

    case "board-dashboard-board":
      return (
        <div className="rounded-lg border border-stone-200 bg-white">
          <DashboardBoard model={EMPTY_RENDER_MODEL} />
        </div>
      );

    case "board-not-implemented":
      return (
        <div className="rounded-lg border border-stone-200 bg-white">
          <NotImplementedBoard model={EMPTY_RENDER_MODEL} />
        </div>
      );

    case "board-type-any":
      return (
        <div className="rounded-lg border border-stone-200 bg-white">
          <BoardForType model={EMPTY_RENDER_MODEL} />
        </div>
      );

    case "panel-inspector":
      return (
        <div className="p-4">
          <Inspector title="Inspector (ตัวอย่าง)" fields={[]} onClose={NOOP} variant="window" />
        </div>
      );

    case "panel-property-inspector":
      return (
        <div className="p-4 max-w-sm rounded-lg border border-stone-200 bg-white">
          <PropertyInspector
            node={PREVIEW_NODE}
            onMove={NOOP}
            onResize={NOOP}
            onRecolor={NOOP}
            onSetDockPosition={NOOP}
            onSetVisibility={NOOP}
          />
        </div>
      );

    case "panel-module-inspector":
      return (
        <div className="p-4 max-w-sm rounded-lg border border-stone-200 bg-white">
          <ModuleInspector node={PREVIEW_NODE} nodes={[PREVIEW_NODE]} connections={[]} />
        </div>
      );

    case "panel-system-reality-report":
      return (
        <ThemeProvider>
          <div className="rounded-lg border border-stone-200 overflow-hidden">
            <SystemRealityReportSection />
          </div>
        </ThemeProvider>
      );

    case "panel-module-palette":
      return (
        <Stage height={420}>
          <div className="flex h-full">
            <ModulePalette onAddNode={NOOP} />
            <div className="flex-1 flex items-center justify-center text-xs text-stone-400">
              ModulePalette — รายการ module จริงจาก registry/module-registry.json
            </div>
          </div>
        </Stage>
      );

    case "canvas-editor":
      return (
        <div className="rounded-lg border border-stone-200 overflow-hidden">
          <CanvasPreview />
        </div>
      );


    case "comp-window":
      return (
        <div className="p-4">
          <Window title="Window (ตัวอย่าง)" subtitle="กรอบหน้าต่างร่วมของ ui-kit" onClose={NOOP}>
            <EmptyState message="เนื้อหาด้านในเป็น children ของผู้เรียก" hint="โฮสต์ใส่ EmptyState จริง ไม่ได้ประดิษฐ์ข้อมูล" />
          </Window>
        </div>
      );

    case "comp-empty-state":
      return (
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <EmptyState message="EmptyState (ค่าเริ่มต้น)" hint="component นี้คือสิ่งที่ทุกจุดใช้แทนข้อมูลที่ยังไม่มี" />
        </div>
      );

    case "comp-action-bar":
      return (
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="text-xs text-stone-400 p-3">props ตัวอย่างเพื่อสาธิตโครงสร้าง — ป้ายปุ่มไม่ใช่ข้อมูลธุรกิจ</div>
          <ActionBar
            actions={[{ key: "demo-1", label: "ปุ่มตัวอย่าง 1", icon: LayoutGrid, onClick: NOOP }]}
            overflowActions={[{ key: "demo-2", label: "ปุ่มตัวอย่าง 2 (overflow)", icon: Briefcase, onClick: NOOP }]}
          />
        </div>
      );

    case "comp-map-view":
      return (
        <div className="p-4">
          <MapView title="MapView (ตัวอย่าง)" markers={[]} onClose={NOOP} />
        </div>
      );

    case "comp-flex-preview":
      return (
        <div className="p-6">
          <div className="text-xs text-stone-500 mb-3">Flex แบบโครงสร้างล้วน — ไม่มีหมายเลข/ยอดเงิน/ชื่อลูกค้า</div>
          <FlexPreview flex={STRUCTURAL_FLEX} />
        </div>
      );

    // ONE NAVIGATION: comp-app-header / comp-home-back-bar (AppHeader + HomeBackBar)
    // ถูกลบออกทั้งระบบ — ไม่มี host ของเมนู Back/Home อีกต่อไป

    case "comp-capability-skeleton":
      return <CapabilitySkeleton cards={3} />;

    case "comp-copy-button":
      return (
        <div className="p-6 flex items-center gap-3">
          <CopyButton text="ข้อความตัวอย่างสำหรับทดสอบการคัดลอก" />
          <span className="text-xs text-stone-400">กดแล้วคัดลอกข้อความตัวอย่าง (ไม่ใช่ข้อมูลธุรกิจ)</span>
        </div>
      );

    case "comp-file-upload":
      return (
        <div className="p-6">
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
            คำเตือน: component นี้เขียนข้อมูลจริง — กด &quot;แนบไฟล์&quot; = อัปโหลดเข้า Storage จริง (documentId = &quot;ui-gallery-preview&quot;)
          </div>
          <FileUpload documentId="ui-gallery-preview" files={[]} onChange={NOOP} />
        </div>
      );

    case "login-logout-button":
      return (
        <div className="p-6">
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
            คำเตือน: กดแล้ว sign out จริงจาก session ปัจจุบัน
          </div>
          <LogoutButton />
        </div>
      );

    case "comp-status-pill":
      return (
        <div className="p-6 flex flex-wrap gap-2">
          <StatusPill tone="neutral">สถานะตัวอย่าง (neutral)</StatusPill>
          <StatusPill tone="success">สถานะตัวอย่าง (success)</StatusPill>
          <StatusPill tone="warning">สถานะตัวอย่าง (warning)</StatusPill>
          <StatusPill tone="danger">สถานะตัวอย่าง (danger)</StatusPill>
        </div>
      );

    case "comp-template-panel":
      return (
        <div className="p-6">
          <Panel title="Panel (branch-only)">
            <EmptyState message="เนื้อหา panel เป็น children" hint="Panel มาจาก presentation/shell/TemplateShell.tsx" />
          </Panel>
        </div>
      );

    // ── PRESENTATION CANONICAL (ยังไม่มี consumer) — Owner review 2026-09-22 ────
    case "presentation-viewer":
      return (
        <div className="p-6 space-y-4">
          <div className="text-xs text-stone-500">
            Viewer จาก presentation/viewer/Viewer.tsx — kind=&quot;text&quot; ด้วยข้อความว่าง (ไม่มีข้อมูลธุรกิจ)
          </div>
          <Viewer kind="text" text="—" />
          <div className="text-xs text-stone-500">
            kind=&quot;document&quot; โดยไม่ส่ง HTML → empty state จริงของ component · PDF = ยังไม่มี implementation ในระบบ
          </div>
          <Viewer kind="document" />
        </div>
      );

    case "presentation-data-table":
      return (
        <div className="p-6 space-y-4">
          <div className="text-xs text-stone-500">
            DataTable จาก presentation/table/DataTable.tsx — คอลัมน์จริง + ค่า &quot;—&quot; (ไม่มีข้อมูลธุรกิจ) · หัวคอลัมน์กดเรียงได้จริง
          </div>
          <DataTable<{ id: string }>
            columns={[
              { key: "a", label: "Column A", sortable: true },
              { key: "b", label: "Column B", sortable: true },
              { key: "c", label: "Column C", align: "right" },
            ]}
            rows={[{ id: "r1" }, { id: "r2" }]}
            rowKey={(r) => r.id}
            renderCell={() => "—"}
            sort={null}
            onSortChange={NOOP}
          />
          <div className="text-xs text-stone-500">rows = [] → empty state จริง</div>
          <DataTable<{ id: string }>
            columns={[{ key: "a", label: "Column A" }]}
            rows={[]}
            rowKey={(r) => r.id}
            renderCell={() => null}
          />
        </div>
      );

    case "presentation-form-field":
      return (
        <div className="p-6 max-w-md space-y-4">
          <div className="text-xs text-stone-500">
            FormField จาก presentation/form/FormField.tsx — primitive ถือ label/required/hint/error ส่วน control เป็นของผู้เรียก (input ด้านล่างคือ control ธรรมดา ไม่ใช่ component ใหม่)
          </div>
          <FormField id="gallery-field" label="Field label" required hint="hint จาก primitive">
            <input
              id="gallery-field"
              readOnly
              value=""
              placeholder="—"
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
            />
          </FormField>
          <FormField id="gallery-field-error" label="Field label (error)" error="ข้อความ error ที่ผู้เรียก resolve มาแล้ว">
            <input
              id="gallery-field-error"
              readOnly
              value=""
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
            />
          </FormField>
        </div>
      );

    case "presentation-form-actions":
      return (
        <div className="p-6 max-w-md">
          <div className="text-xs text-stone-500 mb-3">
            FormActions จาก presentation/form/FormActions.tsx — จัดแถวปุ่มเท่านั้น (ปุ่มเป็นของผู้เรียก · ปุ่มที่นี่ disabled เพื่อไม่ให้กดแล้วเขียนข้อมูล)
          </div>
          <FormActions>
            <button type="button" disabled className="text-sm px-3 py-1.5 rounded-lg border border-stone-200 text-stone-400">
              ยกเลิก
            </button>
            <button type="button" disabled className="text-sm px-3 py-1.5 rounded-lg bg-stone-900 text-white opacity-50">
              บันทึก
            </button>
          </FormActions>
        </div>
      );

    case "presentation-assets-manifest":
      return (
        <div className="p-6">
          <div className="text-xs text-stone-500 mb-3">
            presentation/assets/manifest.ts — ข้อมูลจริงจาก manifest (ไม่ใช่ UI ธุรกิจ): URL / ไฟล์ / สถานะ / ผู้ใช้
          </div>
          <div className="rounded-xl border border-stone-200 divide-y divide-stone-100 text-xs">
            {presentationAssets.map((a) => (
              <div key={a.key} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-stone-700 truncate">{a.url}</div>
                  <div className="text-stone-400 truncate">
                    {a.file} · {a.consumers.length > 0 ? a.consumers.join(", ") : "ไม่มี consumer"}
                  </div>
                </div>
                <span
                  className={
                    "shrink-0 px-2 py-0.5 rounded-full border " +
                    (a.status === "LIVE"
                      ? "text-emerald-700 border-emerald-200 bg-emerald-50"
                      : "text-stone-500 border-stone-200 bg-stone-50")
                  }
                >
                  {a.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      );

    case "ai-chat-input":
      return (
        <div className="p-6 max-w-md">
          <div className="text-xs text-stone-500 mb-3">
            ChatInput จาก presentation/ai/ChatInput.tsx — ส่งข้อความได้จริงแต่ปลายทางเป็น no-op (ไม่ต่อ capability)
          </div>
          <ChatInput onSend={NOOP} disabled={false} />
        </div>
      );

    case "ai-chat-message-list":
      return (
        <div className="p-6">
          <div className="text-xs text-stone-500 mb-3">
            ChatMessageList จาก presentation/ai/ChatMessageList.tsx — messages = [] → แสดง empty state จริงของ component เอง
          </div>
          <div className="flex flex-col min-h-[120px] rounded-xl bg-stone-900 p-3">
            <ChatMessageList messages={[]} activeClarifyId={null} onChoose={NOOP} running={false} />
          </div>
        </div>
      );

    case "ai-clarifying-choice":
      return (
        <div className="p-6 space-y-3">
          <div className="text-xs text-stone-500">
            ClarifyingChoice จาก presentation/ai/ClarifyingChoice.tsx — ตัวเลือกเป็นค่าตัวอย่างเชิงโครงสร้าง ไม่ใช่คำถามธุรกิจ · active=false → ปุ่ม disabled จริง
          </div>
          <div className="rounded-xl bg-stone-900 p-3">
            <ClarifyingChoice prompt="—" options={["—", "—"]} active={false} onChoose={NOOP} />
          </div>
        </div>
      );

    case "ai-confirmation-preview":
      return (
        <div className="p-6 space-y-3">
          <div className="text-xs text-stone-500">
            ConfirmationPreview จาก presentation/ai/ConfirmationPreview.tsx — Rule 72 gate UI: ไม่มีปุ่มยืนยัน มีแต่ลิงก์ไปหน้าแอดมิน
          </div>
          <div className="rounded-xl bg-stone-900 p-3">
            <ConfirmationPreview commandLabel="—" adminUrl="/admin" adminLabel="/admin" />
          </div>
        </div>
      );

    case "ai-result-card":
      return (
        <div className="p-6 space-y-3">
          <div className="text-xs text-stone-500">
            ResultCard จาก presentation/ai/ResultCard.tsx — การ์ดแสดงผลลัพธ์ของ AI (ข้อความว่าง ไม่มีข้อมูลธุรกิจ)
          </div>
          <div className="rounded-xl bg-stone-900 p-3">
            <ResultCard label="—" text="—" />
          </div>
        </div>
      );

    default:
      return null;
  }
}

