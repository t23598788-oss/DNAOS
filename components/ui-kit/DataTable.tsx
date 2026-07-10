"use client";

// UIKit — DataTable
// ตารางทั่วไป (คู่ค้า/เอกสาร/ธุรกรรม ฯลฯ) — รับ columns/rows ผ่าน props เท่านั้น
// ไม่มีคอลัมน์ธุรกิจตายตัว ไม่มีข้อมูลตัวอย่างฝังในไฟล์

import Window from "./Window";
import EmptyState from "./EmptyState";
import { Table2 } from "lucide-react";

export interface DataTableColumn {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
}

export default function DataTable({
  title = "Table",
  columns,
  rows,
  onRowClick,
  onClose,
}: {
  title?: string;
  columns: DataTableColumn[];
  rows: Array<Record<string, string | number | null | undefined>>;
  onRowClick?: (row: Record<string, string | number | null | undefined>) => void;
  onClose: () => void;
}) {
  return (
    <Window
      title={title}
      subtitle={rows.length + " รายการ"}
      icon={<Table2 className="w-4 h-4 text-stone-400" />}
      onClose={onClose}
      width={520}
    >
      {rows.length === 0 ? (
        <EmptyState message="ยังไม่มีข้อมูลในตาราง" />
      ) : (
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-stone-200">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={
                    "px-4 py-2 font-medium text-stone-400 " +
                    (col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left")
                  }
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                onClick={() => onRowClick?.(row)}
                className={
                  "border-b border-stone-100 " + (onRowClick ? "cursor-pointer hover:bg-stone-50" : "")
                }
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={
                      "px-4 py-2 text-stone-700 " +
                      (col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left")
                    }
                  >
                    {row[col.key] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Window>
  );
}
