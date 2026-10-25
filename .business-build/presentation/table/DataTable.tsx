"use client";

// presentation/table — DataTable (canonical TABLE primitive, Phase 3)
//
// Built ONLY from the requirements proven in UI_PRESENTATION_BOUNDARY_PLAN.md §6,
// where the trace showed there is no shared table primitive today (13 files write
// their own <thead>/<tbody>) while every one of these behaviours already exists:
//
//   columns / rows  → RenderModel.TableModel (core/workspace/renderModel.ts) + the 13
//                     hand-written tables. Here they arrive as props.
//   selection       → ListColumn.activeId (single) + useCanvasState.selectedIds (multi)
//                     → both `activeId` and `selectedIds` are supported.
//   editing         → inline <input> inside rows (pits / equipment / connectors /
//                     line-profiles) → `editingRowId`; the caller's own renderCell
//                     decides what the editor looks like.
//   sorting         → .sort() scattered over 12 files → `sort` + `onSortChange`
//                     (asc → desc → none). The primitive never sorts data itself.
//   filtering       → ListColumn's search box / filter chips in jobs+dbd → stays with
//                     the caller and is passed in through `toolbar`.
//   loading         → 35 files hold a loading flag; CapabilitySkeleton is the only
//                     existing skeleton → rendered here as skeleton rows.
//   empty           → presentation/feedback/EmptyState (reused, not re-styled).
//   error           → 19 files render their own error block → `error` + `onRetry`.
//
// Boundary: no fetch, no Supabase/engine/service, no business state, no requirement
// invented beyond the list above. Data, state and handlers all arrive via props.

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, AlertTriangle } from "lucide-react";
import EmptyState from "@/presentation/feedback/EmptyState";

export interface DataTableColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  width?: number | string;
  /** อ่านค่าจาก `sort` + เรียก `onSortChange` — primitive ไม่เรียงข้อมูลเอง */
  sortable?: boolean;
}

export interface DataTableSort {
  key: string;
  direction: "asc" | "desc";
}

export interface DataTableProps<Row> {
  columns: DataTableColumn[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  renderCell: (row: Row, column: DataTableColumn, index: number) => ReactNode;
  sort?: DataTableSort | null;
  /** asc → desc → null (ยกเลิก) — ผู้เรียกเป็นเจ้าของข้อมูลและการเรียงจริง */
  onSortChange?: (next: DataTableSort | null) => void;
  /** เลือกแบบเดี่ยว (หลักฐาน: ListColumn.activeId) */
  activeId?: string | null;
  /** เลือกแบบหลายรายการ (หลักฐาน: useCanvasState.selectedIds) */
  selectedIds?: string[];
  onSelect?: (id: string) => void;
  /** แถวที่กำลังแก้ไข inline (หลักฐาน: <input> ใน pits/equipment/connectors/line-profiles) */
  editingRowId?: string | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyMessage?: string;
  emptyHint?: string;
  /** ช่องค้นหา / filter chips / ปุ่ม — ผู้เรียกเป็นเจ้าของ (ListColumn search, jobs/dbd chips) */
  toolbar?: ReactNode;
  caption?: string;
  /** ความกว้างขั้นต่ำก่อนเกิด horizontal scroll */
  minWidth?: number;
  className?: string;
}

const ALIGN: Record<NonNullable<DataTableColumn["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

const SKELETON_ROWS = 5;

export default function DataTable<Row>({
  columns,
  rows,
  rowKey,
  renderCell,
  sort = null,
  onSortChange,
  activeId = null,
  selectedIds,
  onSelect,
  editingRowId = null,
  loading = false,
  error = null,
  onRetry,
  emptyMessage = "ยังไม่มีข้อมูล",
  emptyHint,
  toolbar,
  caption,
  minWidth,
  className = "",
}: DataTableProps<Row>) {
  const selected = selectedIds ? new Set(selectedIds) : null;
  const colSpan = Math.max(columns.length, 1);

  function nextSort(column: DataTableColumn): DataTableSort | null {
    if (sort?.key !== column.key) return { key: column.key, direction: "asc" };
    if (sort.direction === "asc") return { key: column.key, direction: "desc" };
    return null;
  }

  return (
    <div className={"flex flex-col bg-white border border-stone-200 rounded-xl overflow-hidden " + className}>
      {toolbar && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-stone-100 flex-shrink-0">
          {toolbar}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={minWidth ? { minWidth } : undefined}>
          {caption && <caption className="text-left px-3 py-2 text-xs text-stone-400">{caption}</caption>}
          <thead>
            <tr className="border-b border-stone-100">
              {columns.map((column) => {
                const isSorted = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    aria-sort={isSorted ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                    className={
                      "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400 " +
                      ALIGN[column.align ?? "left"]
                    }
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(nextSort(column))}
                        className="inline-flex items-center gap-1 hover:text-stone-700 transition-colors"
                      >
                        {column.label}
                        {isSorted ? (
                          sort.direction === "asc" ? (
                            <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowDown className="w-3 h-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="w-3 h-3 text-stone-300" />
                        )}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-b border-stone-50 animate-pulse">
                  {columns.map((column) => (
                    <td key={column.key} className="px-3 py-3">
                      <div className="h-3 bg-stone-100 rounded" />
                    </td>
                  ))}
                </tr>
              ))}

            {!loading && error && (
              <tr>
                <td colSpan={colSpan} className="px-3 py-8">
                  <div className="flex flex-col items-center justify-center text-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    <p className="text-xs text-stone-500">{error}</p>
                    {onRetry && (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="text-xs px-2.5 py-1 rounded-md border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
                      >
                        ลองใหม่
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {!loading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={colSpan}>
                  <EmptyState message={emptyMessage} hint={emptyHint} />
                </td>
              </tr>
            )}

            {!loading &&
              !error &&
              rows.map((row, index) => {
                const id = rowKey(row, index);
                const isActive = activeId === id;
                const isSelected = selected ? selected.has(id) : false;
                const isEditing = editingRowId === id;
                return (
                  <tr
                    key={id}
                    onClick={onSelect ? () => onSelect(id) : undefined}
                    className={
                      "border-b border-stone-50 transition-colors " +
                      (onSelect ? "cursor-pointer " : "") +
                      (isActive || isSelected ? "bg-stone-50 " : "hover:bg-stone-50/60 ") +
                      (isEditing ? "bg-amber-50/40 " : "")
                    }
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={"px-3 py-2.5 text-stone-700 " + ALIGN[column.align ?? "left"]}
                      >
                        {renderCell(row, column, index)}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

