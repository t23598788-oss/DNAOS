/**
 * RESULT CONTRACT (owner spec 2026-09-25 — BUSINESS RESULT PRESENTATION):
 * ONE COMPOSER เหมือนเดิม แต่ผลลัพธ์ render ตามชนิดข้อมูลจริง — ชนิดผลลัพธ์
 * map กับของเดิมในระบบ (ไม่สร้าง business data shape ซ้ำ):
 *   table           = DisplayBlock["table"] ของ businessDisplayModel (columns/rows string)
 *   document        = DisplayBlock["document"] (html จาก engine จริง)
 *   finance_summary = ตัวเลขจาก /api/admin/finance-summary (canonical) + rows จาก
 *                     /api/admin/documents (canonical reader ต่อแถว) — ไม่มีการคำนวณใหม่
 *   timeline        = PartnerTimelineEntry[]/PartnerSummary ของ /partners/[id]/timeline
 *   file/image      = ฟิลด์เดียวกับ /api/admin/upload response (path/name/size/type)
 *   confirmation    = confirm_token/confirm_action/flex_preview/doc_html ของ board เดิม
 * ไฟล์นี้มีแต่ type — client (WorkspaceFrame) import แบบ type-only ได้ปลอดภัย
 */
import type { PartnerSummary, PartnerTimelineEntry } from "@/core/shared/types";
import type { DisplayBlock } from "@/app/admin/ui-gallery/_lib/businessDisplayModel";

export interface ResultField {
  id: string;
  label: string;
  value: string;
}

/** shape เดียวกับ BoardSection ของ cognitive/board (workspace.sections) */
export interface ResultSectionLike {
  type?: string;
  title?: string;
  subtitle?: string | null;
  html?: string;
  items?: { title?: string; subtitle?: string | null; label?: string; value?: string }[];
}

/** sections ของ board response → display blocks ของ BusinessDisplayRenderer */
export function sectionsToBlocks(sections: ResultSectionLike[]): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];
  sections.forEach((s, i) => {
    const id = `sec-${i}`;
    if (s.html) {
      blocks.push({ kind: "document", id, title: s.title, html: s.html });
      return;
    }
    if (s.items && s.items.length > 0) {
      blocks.push({
        kind: "fields",
        id,
        title: s.title,
        fields: s.items.map((it, j) => ({
          kind: "field" as const,
          id: `${id}-${j}`,
          label: String(it.title ?? it.label ?? ""),
          value: String(it.subtitle ?? it.value ?? ""),
        })),
      });
    }
  });
  return blocks;
}

/** shape เดียวกับ DisplayBlock kind "table" ของ businessDisplayModel */
export interface ResultTable {
  columns: { key: string; label: string }[];
  rows: string[][];
}

export type ChatResult =
  | { type: "text"; text: string }
  | { type: "table"; title?: string; table: ResultTable }
  | {
      type: "finance_summary";
      title: string;
      summary: ResultField[];
      notes: string[];
      table: ResultTable;
    }
  | { type: "document"; title: string; html: string }
  | { type: "file"; name: string; path: string; mime: string; size: number }
  | { type: "image"; name: string; path: string; mime: string; size: number }
  | {
      type: "timeline";
      title: string;
      summary: PartnerSummary | null;
      items: PartnerTimelineEntry[];
    }
  | { type: "error"; message: string }
  | {
      type: "confirmation";
      text: string;
      action: string;
      token: string;
      html?: string;
    }
  /** board response workspace.sections (ยุบมาจากเลขาเดิม) → BusinessDisplayRenderer */
  | { type: "sections"; blocks: DisplayBlock[] };
