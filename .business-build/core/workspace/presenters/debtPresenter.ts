import type { RenderModel } from "../renderModel";

// Debt Presenter (Phase 4B vertical slice) — transform only. This file has
// exactly one import (RenderModel) and it is a type. No Supabase, no
// service_role, no auth, no fetch, no SQL — it cannot reach the database
// even by accident, because nothing here can execute I/O. It defines the
// DTO shape it expects; the Presentation Gateway is responsible for
// producing data in this shape from wherever it actually lives.
export interface DebtSummaryDTO {
  totalOutstanding: number;
  openCount: number;
  items: { id: string; outstandingAmount: number; status: string }[];
}

export function toRenderModel(dto: DebtSummaryDTO): RenderModel {
  return {
    title: "หนี้ค้างชำระ",
    subtitle: `${dto.openCount} รายการเปิดอยู่`,
    widgets: [
      { id: "total-outstanding", label: "ยอดค้างชำระรวม", value: dto.totalOutstanding.toLocaleString("th-TH", { minimumFractionDigits: 2 }) },
      { id: "open-count", label: "จำนวนรายการ", value: dto.openCount },
    ],
    tables: [
      {
        id: "debt-items",
        title: "รายการหนี้",
        columns: ["ID", "ยอดค้างชำระ", "สถานะ"],
        rows: dto.items.map((i) => [i.id, i.outstandingAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 }), i.status]),
      },
    ],
    cards: [],
    charts: [],
    panels: [],
    actions: [],
  };
}