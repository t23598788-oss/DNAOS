"use client";

/**
 * BUSINESS DISPLAY RENDERER — renderer ตัวเดียวสำหรับ display model ทุกชนิด
 *
 * หลักการ: DATA → DISPLAY MODEL → RENDER
 *   - ไม่วาด layout เฉพาะรายการทีละตัว: เพิ่มข้อมูลใน display model = ได้หน้าจอเพิ่มเอง
 *   - delegate ไป primitive เดิมของ presentation/ ทุกชนิดที่ทำได้
 *     · fields       → panels/Inspector (variant="panel")
 *     · table        → table/DataTable
 *     · document     → viewer/Viewer (kind="document") = พื้นที่ขาวตาม WHITE RULE
 *     · conversation → ai/ChatMessageList (+ ChatInput disabled)
 *     · rows อื่น (tree/diff/problems/search/references/lines) → แถวบรรทัดเดียว
 *       ด้วย typography/โทนสีชุดเดียวกับ primitive เดิม (ไม่ใช่ design language ใหม่)
 *
 * ไม่มี business logic · ไม่มี scanner · ไม่มี validation · ไม่มี diff algorithm
 * ค่าทุกอย่างมาจาก display model ที่ผู้เรียกเตรียมแล้ว
 */
import type { ElementType } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Info, XCircle } from "lucide-react";
import type { ChatMessage } from "@/engines/shared/business-display/conversationState";
import Inspector, { type InspectorField } from "@/presentation/panels/Inspector";
import DataTable from "@/presentation/table/DataTable";
import Viewer from "@/presentation/viewer/Viewer";
import { ChatMessageList } from "@/presentation/ai/ChatMessageList";
import { ChatInput } from "@/presentation/ai/ChatInput";
import EmptyState from "@/presentation/feedback/EmptyState";
import type { BusinessDisplayModel, DisplayBlock, Tone } from "./businessDisplayModel";

// โทนสีชุดเดียวกับ presentation/panels/Inspector.tsx (reuse ค่าเดิม ไม่คิดใหม่)
const TONE_TEXT: Record<Tone, string> = {
  default: "text-stone-700",
  success: "text-emerald-600",
  warning: "text-amber-600",
  danger: "text-rose-600",
  muted: "text-stone-400",
};

const SEVERITY_ICON: Record<string, ElementType> = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_TONE: Record<string, Tone> = {
  error: "danger",
  warning: "warning",
  info: "success",
};

const DIFF_TONE: Record<string, Tone> = {
  changed: "default",
  added: "success",
  missing: "danger",
};

function Row({ children, indent = 0, itemId, onSelect }: { children: React.ReactNode; indent?: number; itemId?: string; onSelect?: (id: string) => void }) {
  return (
    <div
      data-item-id={itemId}
      onClick={itemId && onSelect ? () => onSelect(itemId) : undefined}
      className={
        "flex items-baseline gap-2 border-b border-[#F0EBE5] px-2 py-1 text-xs leading-relaxed hover:bg-[#F7F4EF]" +
        (itemId && onSelect ? " cursor-pointer" : "")
      }
      style={indent ? { paddingLeft: 8 + indent * 14 } : undefined}
    >
      {children}
    </div>
  );
}

function BlockHeader({ title }: { title?: string }) {
  if (!title) return null;
  return (
    <div className="border-b border-[#E9E1D6] px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
      {title}
    </div>
  );
}


function Block({ block, onSelectItem }: { block: DisplayBlock; onSelectItem?: (id: string) => void }) {
  switch (block.kind) {
    case "lines":
      return (
        <div className="overflow-hidden">
          <BlockHeader title={block.title} />
          {block.items.map((it) =>
            it.kind === "text" ? (
              <Row key={it.id} itemId={it.id} onSelect={onSelectItem}>
                <span className={(it.mono ? "font-mono " : "") + TONE_TEXT[it.tone ?? "default"]}>{it.text}</span>
              </Row>
            ) : null
          )}
        </div>
      );

    case "tree":
      return (
        <div className="overflow-hidden">
          <BlockHeader title={block.title} />
          {block.items.map((node) => (
            <Row key={node.id} indent={node.depth} itemId={node.id} onSelect={onSelectItem}>
              <span className="w-3 flex-shrink-0 text-stone-400">
                {node.expandable ? (
                  node.expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
                ) : null}
              </span>
              <span
                className={
                  "flex-1 truncate " +
                  (node.selected ? "font-medium text-stone-900" : TONE_TEXT[node.tone ?? "default"])
                }
              >
                {node.label}
              </span>
              {typeof node.badge === "number" && (
                <span className="rounded-md border border-[#E9E1D6] bg-[#F7F4EF] px-1.5 text-[10px] text-stone-500">
                  {node.badge}
                </span>
              )}
              {node.selected && <span className="text-[10px] text-[#B49C7C]">selected</span>}
            </Row>
          ))}
        </div>
      );

    case "fields": {
      // reuse primitive เดิม: panels/Inspector (variant="panel" = ไม่มีกรอบ/ปุ่มปิด)
      // InspectorField.tone รองรับ default|success|warning|danger — "muted" ของ display model map เป็น default
      const fields: InspectorField[] = block.fields.map((f) => ({
        label: f.label,
        value: f.value,
        tone: !f.tone || f.tone === "muted" ? "default" : f.tone,
      }));
      return (
        <div className="h-[240px] overflow-hidden rounded-lg border border-[#E9E1D6]">
          <Inspector title={block.title ?? "Fields"} fields={fields} onClose={() => {}} variant="panel" />
        </div>
      );
    }

    case "table":
      return (
        <div className="overflow-hidden rounded-lg border border-[#E9E1D6]">
          {block.title && <BlockHeader title={block.title} />}
          <DataTable<string[]>
            columns={block.columns.map((c) => ({ key: c.key, label: c.label }))}
            rows={block.rows}
            rowKey={(_, i) => String(i)}
            renderCell={(row, column) => {
              const idx = block.columns.findIndex((c) => c.key === column.key);
              return row[idx] ?? "";
            }}
            emptyMessage="ยังไม่มีข้อมูล"
          />
        </div>
      );

    case "diff":
      return (
        <div className="overflow-hidden">
          <BlockHeader title={block.title} />
          {block.items.map((d) => (
            <Row key={d.id}>
              <span className="w-40 flex-shrink-0 truncate text-stone-500">{d.label}</span>
              <span className="font-mono text-stone-400 line-through">{d.before}</span>
              <span className="text-stone-400">→</span>
              <span className={"font-mono " + TONE_TEXT[DIFF_TONE[d.state]]}>{d.after}</span>
            </Row>
          ))}
        </div>
      );

    case "problems":
      return (
        <div className="overflow-hidden">
          <BlockHeader title={block.title} />
          {block.items.map((p) => {
            const Icon = SEVERITY_ICON[p.severity] ?? Info;
            return (
              <Row key={p.id}>
                <Icon className={"h-3.5 w-3.5 flex-shrink-0 " + TONE_TEXT[SEVERITY_TONE[p.severity]]} />
                <span className="flex-1 truncate text-stone-700">{p.message}</span>
                <span className="flex-shrink-0 font-mono text-[10px] text-stone-400">{p.source}</span>
                {p.location && <span className="flex-shrink-0 font-mono text-[10px] text-stone-400">{p.location}</span>}
              </Row>
            );
          })}
        </div>
      );

    case "search":
      return (
        <div className="overflow-hidden">
          <BlockHeader title={block.title} />
          {block.items.map((h) => (
            <Row key={h.id} itemId={h.id} onSelect={onSelectItem}>
              <span className="w-32 flex-shrink-0 truncate text-stone-500">{h.source}</span>
              <span className="w-10 flex-shrink-0 text-right font-mono text-[10px] text-stone-400">{h.line}</span>
              <span className="flex-1 truncate font-mono text-stone-700">{h.text}</span>
            </Row>
          ))}
        </div>
      );

    case "references":
      return (
        <div className="overflow-hidden">
          <BlockHeader title={block.title} />
          {block.items.map((r) => (
            <Row key={r.id}>
              <span className="w-40 flex-shrink-0 truncate text-stone-500">{r.label}</span>
              <span className={"flex-1 truncate font-mono text-[11px] " + TONE_TEXT[r.tone ?? "default"]}>{r.target}</span>
            </Row>
          ))}
        </div>
      );

    case "document":
      return (
        <div className="overflow-hidden rounded-lg border border-[#E9E1D6]">
          {block.title && <BlockHeader title={block.title} />}
          <Viewer kind="document" html={block.html} documentHeight={260} />
        </div>
      );

    case "conversation": {
      const messages: ChatMessage[] = block.messages.map((m) => ({
        id: m.id,
        sender: m.role === "user" ? "user" : "system",
        kind: "text",
        text: m.text,
      }));
      return (
        <div className="overflow-hidden rounded-lg border border-[#E9E1D6]">
          {block.title && <BlockHeader title={block.title} />}
          <div className="h-[180px] overflow-y-auto">
            <ChatMessageList messages={messages} activeClarifyId={null} onChoose={() => {}} running={false} />
          </div>
          <ChatInput onSend={() => {}} disabled />
        </div>
      );
    }

    default:
      return <EmptyState message="ยังไม่มี display block ชนิดนี้" />;
  }
}

export function BusinessDisplayRenderer({ model, onSelectItem }: { model: BusinessDisplayModel; onSelectItem?: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#E9E1D6] bg-[#FDFBF8]">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-[#E9E1D6] px-2.5 py-2">
        <span className="text-xs font-semibold text-stone-800">{model.title}</span>
        <span className="text-[10px] text-stone-400">{model.domain}</span>
        <span className="ml-auto font-mono text-[10px] text-stone-400">{model.blocks.map((b) => b.kind).join(" · ")}</span>
      </div>
      <div className="divide-y divide-[#F0EBE5]">
        {model.blocks.map((b) => (
          <Block key={b.id} block={b} onSelectItem={onSelectItem} />
        ))}
      </div>
    </div>
  );
}
