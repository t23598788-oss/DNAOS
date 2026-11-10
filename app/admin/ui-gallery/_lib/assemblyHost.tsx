"use client";

// UI Gallery — assemblyHost.tsx
//
// ที่เดียวที่ "ประกอบหน้าจอ" จาก component จริงที่ migrate มาแล้ว (presentation/ 34 ไฟล์
// + component เดิมที่ inventory พบ) โดยไม่คัดลอก source, ไม่สร้าง mock UI, ไม่ redesign,
// ไม่แตะ appearance ของ component เดิม และไม่แตะ business/capability ใด ๆ
//
// หลักการข้อมูล (Owner directive): ไม่ประดิษฐ์ข้อมูลธุรกิจ
//   1) props ว่าง / state จริงของ component เอง
//   2) EMPTY_RENDER_MODEL (ที่มีอยู่แล้วใน core/workspace/renderModel.ts)
//   3) EmptyState จริงของ component
//   + ข้อความที่ Owner พิมพ์เองในชุด AI (ไม่ใช่ข้อมูลที่แต่งขึ้น)
// action ที่ยังไม่มี backend → แสดงปุ่มจริงแต่ disabled พร้อมป้าย NOT WIRED

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Download, Plus, Printer, RefreshCw, Save, Search, Trash2 } from "lucide-react";

import AppShell from "@/presentation/shell/AppShell";
import ListColumn from "@/presentation/shell/navigation/ListColumn";
import Inspector, { type InspectorField } from "@/presentation/panels/Inspector";
import ActionBar, { type ActionBarItem } from "@/presentation/panels/ActionBar";
import EmptyState from "@/presentation/feedback/EmptyState";
import CapabilitySkeleton from "@/presentation/feedback/CapabilitySkeleton";
import CopyButton from "@/presentation/feedback/CopyButton";
import Viewer from "@/presentation/viewer/Viewer";
import DataTable, { type DataTableSort } from "@/presentation/table/DataTable";
import FormField from "@/presentation/form/FormField";
import FormActions from "@/presentation/form/FormActions";
import FileUpload, { type UploadedFile } from "@/presentation/documents/FileUpload";
import { Panel, StatusPill, TemplateShell } from "@/presentation/shell/TemplateShell";
import PortalShell from "@/presentation/shell/PortalShell";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import { DashboardBoard } from "@/presentation/shell/workspace/DashboardBoard";
import { ChatInput } from "@/presentation/ai/ChatInput";
import { ChatMessageList } from "@/presentation/ai/ChatMessageList";
import { ClarifyingChoice } from "@/presentation/ai/ClarifyingChoice";
import { ConfirmationPreview } from "@/presentation/ai/ConfirmationPreview";
import { ResultCard } from "@/presentation/ai/ResultCard";

import { EMPTY_RENDER_MODEL } from "@/core/workspace/renderModel";
import { resolveBoard } from "@/core/workspace/boardRouter";
import type { BoardType } from "@/core/workspace/board";
import { resolveNavItems } from "@/core/navigation/resolveNavItems";
import type { ChatMessage } from "@/app/playground/_lib/conversationState";

import { REAL_RAIL_ITEMS, renderHost } from "./componentHost";

const NOOP = () => {};

/** กรอบของ LAB เท่านั้น (ไม่ใช่ UI ที่ส่งมอบ) — พื้นหลัง/หัวข้อ ไว้แยกชุดให้ Owner ดูง่าย */
export function AssemblyFrame({
  title,
  hint,
  notWired,
  children,
}: {
  title: string;
  hint?: string;
  notWired?: string[];
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
      <div className="border-b border-stone-100 px-3 py-2">
        <div className="text-xs font-semibold text-stone-700">{title}</div>
        {hint && <div className="mt-0.5 text-[10px] text-stone-400">{hint}</div>}
      </div>
      {notWired && notWired.length > 0 && (
        <div className="border-b border-amber-100 bg-amber-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">NOT WIRED (ไม่มี backend ในชุดนี้)</div>
          <ul className="mt-1 list-disc pl-4 text-[10px] text-amber-800">
            {notWired.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="bg-stone-50">{children}</div>
    </div>
  );
}

/** ปุ่มควบคุมของ LAB (สลับ state ให้ดูความต่าง) — ไม่ใช่ UI ที่ส่งมอบ */
function LabToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full border px-2.5 py-1 text-[11px] transition-colors " +
        (active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-600 hover:border-stone-500")
      }
    >
      {children}
    </button>
  );
}

function LabRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-stone-400">{label}</span>
      {children}
    </div>
  );
}

function WorkAreaNote({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-white px-3 py-6 text-center text-[11px] text-stone-500">{text}</div>
  );
}

// ── 1 · Application Shell ────────────────────────────────────────────────────
// AppShell(rail + ListColumn + children) + ActionBar + Inspector — โครงเดียวกับ
// app/admin/line-customers/page.tsx:486 และ app/admin/relationships/workspace.tsx:1215
export function AsmApplicationShell() {
  const [railKey, setRailKey] = useState(REAL_RAIL_ITEMS[0]?.key ?? "admin");
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const actions: ActionBarItem[] = [
    { key: "refresh", label: "รีเฟรช", icon: RefreshCw, onClick: NOOP, disabled: true, tooltip: "NOT WIRED — ไม่มี backend ในชุดนี้" },
    { key: "create", label: "สร้างใหม่", icon: Plus, onClick: NOOP, disabled: true, tooltip: "NOT WIRED" },
  ];
  const overflow: ActionBarItem[] = [
    { key: "delete", label: "ลบ", icon: Trash2, onClick: NOOP, disabled: true, tooltip: "NOT WIRED" },
  ];
  const fields: InspectorField[] = [
    { label: "Selection", value: null },
    { label: "Panel source", value: "Inspector (variant=panel)" },
  ];

  return (
    <div className="h-[620px]">
      <AppShell
        railItems={REAL_RAIL_ITEMS}
        activeRailKey={railKey}
        onSelectRail={setRailKey}
        listItems={[]}
        activeListId={null}
        onSelectList={NOOP}
        listCollapsible
        listEmptyMessage="ยังไม่มีข้อมูลจริง — ListColumn แสดง EmptyState ของตัวเอง"
        listSearchPlaceholder="ค้นหา (ช่องค้นหาจริงของ ListColumn)"
      >
        <div className="flex h-full min-h-0">
          <div className="min-w-0 flex-1 space-y-3 p-4">
            <ActionBar actions={actions} overflowActions={overflow} />
            <WorkAreaNote text="Main work area = children ของ AppShell (ของจริงคือ workspace ของหน้านั้น)" />
            {!inspectorOpen && (
              <button
                type="button"
                onClick={() => setInspectorOpen(true)}
                className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-[11px] text-stone-600"
              >
                เปิด Inspector กลับมา
              </button>
            )}
          </div>
          {inspectorOpen && (
            <div className="w-[320px] shrink-0 border-l border-stone-200 p-3">
              <Inspector title="Inspector" fields={fields} onClose={() => setInspectorOpen(false)} variant="panel" />
            </div>
          )}
        </div>
      </AppShell>
    </div>
  );
}

// ── 2 · Workspace + Board ────────────────────────────────────────────────────
// board จริงจาก core/workspace/boardRouter.ts + EMPTY_RENDER_MODEL (ไม่มีข้อมูลจริง)
export function AsmWorkspaceBoard() {
  const [boardType, setBoardType] = useState<BoardType>("dashboard");
  const Board = resolveBoard(boardType);
  const types: BoardType[] = ["dashboard", "business", "finance", "partner", "mobile"];

  return (
    <div className="space-y-3 p-3">
      <LabRow label="board type (resolveBoard)">
        {types.map((t) => (
          <LabToggle key={t} active={t === boardType} onClick={() => setBoardType(t)}>
            {t}
          </LabToggle>
        ))}
      </LabRow>
      <div className="rounded-xl border border-stone-200 bg-white p-3">
        <Board model={EMPTY_RENDER_MODEL} />
      </div>
    </div>
  );
}

// ── 3 · Viewer Workspace ─────────────────────────────────────────────────────
// ActionBar + Viewer + Inspector — หลักฐาน: ActionBar/Inspector อยู่คู่กันจริง
// ใน app/admin/relationships/workspace.tsx:1461,1481
export function AsmViewerWorkspace() {
  const [kind, setKind] = useState<"text" | "document" | "image" | "pdf">("text");
  const [zoom, setZoom] = useState(1);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const kinds: ("text" | "document" | "image" | "pdf")[] = ["text", "document", "image", "pdf"];

  const actions: ActionBarItem[] = [
    { key: "download", label: "ดาวน์โหลด", icon: Download, onClick: NOOP, disabled: true, tooltip: "NOT WIRED" },
    { key: "print", label: "พิมพ์", icon: Printer, onClick: NOOP, disabled: true, tooltip: "NOT WIRED" },
  ];
  const fields: InspectorField[] = [
    { label: "Kind", value: kind },
    { label: "Zoom", value: zoom },
  ];

  return (
    <div className="flex min-h-[560px]">
      <div className="min-w-0 flex-1 space-y-3 p-3">
        <LabRow label="kind">
          {kinds.map((k) => (
            <LabToggle key={k} active={k === kind} onClick={() => setKind(k)}>
              {k}
            </LabToggle>
          ))}
        </LabRow>
        <LabRow label="zoom">
          {[1, 1.5].map((z) => (
            <LabToggle key={z} active={z === zoom} onClick={() => setZoom(z)}>
              {z}x
            </LabToggle>
          ))}
        </LabRow>
        <ActionBar actions={actions} />
        <Viewer
          kind={kind}
          text={kind === "text" ? "—" : undefined}
          zoom={zoom}
          toolbar={<span className="text-[11px] text-stone-500">toolbar = prop จริงของ Viewer (ผู้เรียกเป็นเจ้าของ)</span>}
        />
      </div>
      {inspectorOpen && (
        <div className="w-[300px] shrink-0 border-l border-stone-200 p-3">
          <Inspector title="Inspector" fields={fields} onClose={() => setInspectorOpen(false)} variant="panel" />
        </div>
      )}
    </div>
  );
}

// ── 4 · Table Workspace ──────────────────────────────────────────────────────
// DataTable (primitive กลาง) + ActionBar + selection → Inspector
export function AsmTableWorkspace() {
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const rows = empty ? [] : [{ id: "row-1" }, { id: "row-2" }, { id: "row-3" }];
  const actions: ActionBarItem[] = [
    { key: "refresh", label: "รีเฟรช", icon: RefreshCw, onClick: NOOP, disabled: true, tooltip: "NOT WIRED" },
    { key: "create", label: "เพิ่มแถว", icon: Plus, onClick: NOOP, disabled: true, tooltip: "NOT WIRED" },
  ];
  const fields: InspectorField[] = [
    { label: "Selected row", value: activeId },
    { label: "Sort", value: sort ? `${sort.key} ${sort.direction}` : null },
  ];

  return (
    <div className="flex min-h-[560px]">
      <div className="min-w-0 flex-1 space-y-3 p-3">
        <LabRow label="ข้อมูลในตาราง">
          <LabToggle active={!empty} onClick={() => setEmpty(false)}>
            มี 3 แถว (ค่าเป็น — )
          </LabToggle>
          <LabToggle active={empty} onClick={() => setEmpty(true)}>
            rows = []
          </LabToggle>
        </LabRow>
        <ActionBar actions={actions} />
        <DataTable<{ id: string }>
          columns={[
            { key: "a", label: "คอลัมน์ A", sortable: true },
            { key: "b", label: "คอลัมน์ B", sortable: true },
            { key: "c", label: "คอลัมน์ C", align: "right" },
          ]}
          rows={rows}
          rowKey={(r) => r.id}
          renderCell={() => "—"}
          sort={sort}
          onSortChange={setSort}
          activeId={activeId}
          onSelect={setActiveId}
          toolbar={
            <div className="flex w-full flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-stone-400" />
                <input
                  disabled
                  placeholder="ค้นหา / กรอง — NOT WIRED"
                  className="w-60 rounded-lg border border-stone-200 bg-stone-50 py-1 pl-7 pr-2 text-[11px] text-stone-500"
                />
              </div>
              <span className="text-[10px] text-stone-400">
                ช่องค้นหา/filter ที่ทำงานได้จริงคือของ ListColumn (ดูชุดที่ 1) — ไม่ยัดเข้า DataTable
              </span>
            </div>
          }
        />
      </div>
      {inspectorOpen && (
        <div className="w-[300px] shrink-0 border-l border-stone-200 p-3">
          <Inspector title="Inspector" fields={fields} onClose={() => setInspectorOpen(false)} variant="panel" />
        </div>
      )}
    </div>
  );
}


// ── 5 · Form Workspace ───────────────────────────────────────────────────────
// FormField + FormActions + panel แสดงค่าที่กรอก (ค่ามาจาก Owner พิมพ์เอง ไม่ใช่ข้อมูลที่แต่ง)
export function AsmFormWorkspace() {
  const [valueA, setValueA] = useState("");
  const [showError, setShowError] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const fields: InspectorField[] = [
    { label: "ช่องที่ 1 (ที่พิมพ์)", value: valueA === "" ? null : valueA },
    { label: "สถานะ error", value: showError ? "แสดง" : "ปกติ" },
  ];

  return (
    <div className="flex min-h-[520px]">
      <div className="min-w-0 flex-1 space-y-3 p-4">
        <LabRow label="state ของ FormField">
          <LabToggle active={!showError} onClick={() => setShowError(false)}>
            ปกติ
          </LabToggle>
          <LabToggle active={showError} onClick={() => setShowError(true)}>
            error
          </LabToggle>
        </LabRow>
        <div className="max-w-md space-y-4 rounded-xl border border-stone-200 bg-white p-4">
          <FormField id="asm-field-a" label="ช่องที่ 1 (required)" required hint="hint จาก primitive">
            <input
              id="asm-field-a"
              value={valueA}
              onChange={(e) => setValueA(e.target.value)}
              placeholder="พิมพ์ได้จริง (client state)"
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
            />
          </FormField>
          <FormField
            id="asm-field-b"
            label="ช่องที่ 2 (disabled)"
            disabled
            error={showError ? "ข้อความ error ที่ผู้เรียกส่งเข้ามา" : null}
          >
            <input
              id="asm-field-b"
              disabled
              value=""
              placeholder="—"
              className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm"
            />
          </FormField>
          <FormActions>
            <button type="button" disabled className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-400">
              ยกเลิก
            </button>
            <button type="button" disabled className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white opacity-50">
              บันทึก (NOT WIRED)
            </button>
          </FormActions>
        </div>
      </div>
      {inspectorOpen && (
        <div className="w-[300px] shrink-0 border-l border-stone-200 p-3">
          <Inspector title="Inspector" fields={fields} onClose={() => setInspectorOpen(false)} variant="panel" />
        </div>
      )}
    </div>
  );
}

// ── 6 · Document Workspace ───────────────────────────────────────────────────
// FileUpload + Viewer(kind=document) + ActionBar — หลักฐาน: DocumentBuilder.tsx:568
// (DocumentBuilder/DocumentPreview เต็มตัวไม่ประกอบที่นี่: mixed boundary + ต้องมี draft จริง)
export function AsmDocumentWorkspace() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const actions: ActionBarItem[] = [
    { key: "print", label: "พิมพ์", icon: Printer, onClick: NOOP, disabled: true, tooltip: "NOT WIRED" },
    { key: "save", label: "บันทึก", icon: Save, onClick: NOOP, disabled: true, tooltip: "NOT WIRED" },
  ];
  const fields: InspectorField[] = [
    { label: "ไฟล์แนบ", value: files.length },
    { label: "Preview", value: "Viewer (kind=document)" },
  ];

  return (
    <div className="flex min-h-[560px]">
      <div className="min-w-0 flex-1 space-y-3 p-4">
        <ActionBar actions={actions} />
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          FileUpload ตัวนี้เขียนข้อมูลจริง (อัปโหลดเข้า Storage เมื่อแนบไฟล์) — กดเฉพาะเมื่อต้องการทดสอบจริง
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-3">
          <FileUpload documentId="ui-gallery-assembly" files={files} onChange={setFiles} />
        </div>
        <Viewer kind="document" emptyMessage="ยังไม่มี HTML เอกสาร — ต้องมี draft + CompanySettings จริง (DocumentBuilder)" />
      </div>
      {inspectorOpen && (
        <div className="w-[300px] shrink-0 border-l border-stone-200 p-3">
          <Inspector title="Inspector" fields={fields} onClose={() => setInspectorOpen(false)} variant="panel" />
        </div>
      )}
    </div>
  );
}


// ── 7 · AI / Communication Workspace ─────────────────────────────────────────
// ChatMessageList + ChatInput ตามลำดับจริงของ app/playground/page.tsx:340,353
// + การ์ดย่อย 3 ตัวที่ ChatMessageList import ใช้เอง (ResultCard/ClarifyingChoice/ConfirmationPreview)
export function AsmAiWorkspace() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  function handleSend(text: string) {
    // เก็บเฉพาะข้อความที่ Owner พิมพ์เอง — ไม่มีคำตอบปลอมจากระบบ
    setMessages((prev) => [...prev, { id: `m-${prev.length + 1}`, sender: "user", kind: "text", text }]);
  }

  return (
    <div className="space-y-3 p-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-[420px] flex-col gap-3 rounded-xl bg-stone-900 p-3">
          <ChatMessageList messages={messages} activeClarifyId={null} onChoose={NOOP} running={false} />
          <ChatInput onSend={handleSend} disabled={false} />
        </div>
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-stone-400">การ์ดย่อย (component จริง — ค่าเป็นโครงสร้าง)</div>
          <div className="rounded-xl bg-stone-900 p-3">
            <ResultCard label="—" text="—" />
          </div>
          <div className="rounded-xl bg-stone-900 p-3">
            <ClarifyingChoice prompt="—" options={["—", "—"]} active={false} onChoose={NOOP} />
          </div>
          <div className="rounded-xl bg-stone-900 p-3">
            <ConfirmationPreview commandLabel="—" adminUrl="/admin" adminLabel="/admin" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 8 · Business Workspace Template (ชุดเดียว 4 หน้า) ─────────────────────────
// 4 route จริงของ branch-only template เปิดพร้อมกันเป็นชุดเดียว + Panel/StatusPill ตัวจริง
export function AsmTemplateSuite() {
  const pages = [
    { id: "overview", label: "ภาพรวม", route: "/business-workspace-template/overview" },
    { id: "workspace", label: "พื้นที่ทำงาน", route: "/business-workspace-template/workspace" },
    { id: "tasks", label: "งาน", route: "/business-workspace-template/tasks" },
    { id: "documents", label: "เอกสาร", route: "/business-workspace-template/documents" },
  ];
  const [activeId, setActiveId] = useState(pages[0].id);
  const active = pages.find((p) => p.id === activeId) ?? pages[0];

  return (
    <div className="space-y-3 p-3">
      <LabRow label="หน้าในชุดเดียวกัน">
        {pages.map((p) => (
          <LabToggle key={p.id} active={p.id === active.id} onClick={() => setActiveId(p.id)}>
            {p.label}
          </LabToggle>
        ))}
      </LabRow>
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-3 py-2 font-mono text-[11px] text-stone-500">iframe → {active.route}</div>
        <iframe src={active.route} title={active.route} className="w-full border-0 bg-white" style={{ height: 420 }} />
      </div>
      <div className="rounded-xl border border-stone-200 bg-white p-3">
        <div className="mb-2 text-[11px] text-stone-500">Panel + StatusPill ตัวจริงจาก presentation/shell/TemplateShell.tsx</div>
        <div className="mb-3 flex flex-wrap gap-2">
          <StatusPill tone="neutral">neutral</StatusPill>
          <StatusPill tone="success">success</StatusPill>
          <StatusPill tone="warning">warning</StatusPill>
          <StatusPill tone="danger">danger</StatusPill>
        </div>
        <Panel title="Panel (children เป็นของผู้เรียก)">
          <EmptyState message="ยังไม่มีข้อมูลจริง" />
        </Panel>
      </div>
    </div>
  );
}


// ── 9 · Admin / Owner Workspace ──────────────────────────────────────────────
// WorkspaceShell (ใช้ร่วม business/user/partner) ตาม source จริง
// ONE NAVIGATION: HomeBackBar + AppHeader (แถบ Back/Home) ถูกลบออกทั้งระบบแล้ว
export function AsmAdminOwnerWorkspace() {
  const navItems = useMemo(() => resolveNavItems("admin"), []);
  const [activeKey, setActiveKey] = useState(navItems[0]?.key ?? "admin");

  return (
    <div className="space-y-3 p-3">
      <div className="h-[440px] overflow-hidden rounded-xl border border-stone-200 bg-white">
        <WorkspaceShell theme="light">
          <div className="space-y-3 p-4">
            <LabRow label="active nav (state จริงของ WorkspaceShell)">
              {navItems.map((n) => (
                <LabToggle key={n.key} active={n.key === activeKey} onClick={() => setActiveKey(n.key)}>
                  {n.label}
                </LabToggle>
              ))}
            </LabRow>
            <div className="rounded-xl bg-white p-4">
              <EmptyState
                message="พื้นที่งานของ WorkspaceShell (children)"
                hint="ของจริงคือเนื้อหาหน้า business / user / partner"
              />
            </div>
          </div>
        </WorkspaceShell>
      </div>
    </div>
  );
}

// ── 10 · Portal / Capability Shell ───────────────────────────────────────────
// PortalShell (merged DEL-05: 2 โหมด interface) + CopyButton + CapabilitySkeleton
export function AsmPortalCapability() {
  const [mode, setMode] = useState<"portal" | "capability">("portal");

  return (
    <div className="space-y-3 p-3">
      <LabRow label="โหมดของ PortalShell">
        <LabToggle active={mode === "portal"} onClick={() => setMode("portal")}>
          portalId (อ่าน registry/portals.json)
        </LabToggle>
        <LabToggle active={mode === "capability"} onClick={() => setMode("capability")}>
          title + description
        </LabToggle>
      </LabRow>

      {mode === "portal" ? (
        <PortalShell portalId="download_center">
          <div className="mx-auto max-w-2xl rounded-xl border border-stone-800 bg-stone-950 p-4 text-xs text-stone-400">
            children ของ shell — ในของจริงคือเนื้อหาของ /download
          </div>
        </PortalShell>
      ) : (
        <PortalShell
          title="Capability page (ตัวอย่าง)"
          description="โหมดที่สองของ shell เดียวกัน — title/description ส่งมาจากผู้เรียก ไม่ได้อ่าน registry"
        >
          <CapabilitySkeleton cards={4} />
        </PortalShell>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white p-3">
        <span className="text-[11px] text-stone-500">CopyButton (คัดลอกจริง — ข้อความว่าง ไม่ใช่ข้อมูลธุรกิจ)</span>
        <CopyButton text="—" />
      </div>
    </div>
  );
}

// ── 11 · Canvas Workspace ────────────────────────────────────────────────────
// ใช้ Canvas จริงตาม host ที่มีอยู่แล้ว (initialLayout จาก workspaceLayoutStore.createEmpty())
export function AsmCanvasWorkspace() {
  return <div className="p-3">{renderHost("canvas-editor")}</div>;
}

// ── entry ────────────────────────────────────────────────────────────────────

export function AssemblyHost({ id }: { id: string }) {
  switch (id) {
    case "application-shell":
      return <AsmApplicationShell />;
    case "workspace-board":
      return <AsmWorkspaceBoard />;
    case "viewer-workspace":
      return <AsmViewerWorkspace />;
    case "table-workspace":
      return <AsmTableWorkspace />;
    case "form-workspace":
      return <AsmFormWorkspace />;
    case "document-workspace":
      return <AsmDocumentWorkspace />;
    case "ai-workspace":
      return <AsmAiWorkspace />;
    case "template-suite":
      return <AsmTemplateSuite />;
    case "admin-owner-workspace":
      return <AsmAdminOwnerWorkspace />;
    case "portal-capability":
      return <AsmPortalCapability />;
    case "canvas-workspace":
      return <AsmCanvasWorkspace />;
    default:
      return (
        <div className="p-6">
          <EmptyState message={`ไม่รู้จัก assembly "${id}"`} hint="เลือกจากรายการใน /admin/ui-gallery/lab" />
        </div>
      );
  }
}

