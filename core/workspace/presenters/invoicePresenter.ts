import type { RenderModel } from "../renderModel";

export interface InvoiceSummaryDTO {
  totalCount: number;
  totalAmount: number;
  items: { id: string; documentNumber: string; status: string; partyName: string; netAmount: number }[];
}

export function toRenderModel(dto: InvoiceSummaryDTO): RenderModel {
  return {
    title: "ใบแจ้งหนี้",
    subtitle: `${dto.totalCount} ฉบับ`,
    widgets: [
      { id: "invoice-count", label: "จำนวนใบแจ้งหนี้", value: dto.totalCount },
      { id: "invoice-total", label: "ยอดรวม", value: dto.totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 }) },
    ],
    tables: [{
      id: "invoice-items", title: "รายการใบแจ้งหนี้",
      columns: ["เลขที่", "สถานะ", "คู่ค้า", "ยอดเงิน"],
      rows: dto.items.map((i) => [i.documentNumber, i.status, i.partyName, i.netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })]),
    }],
    cards: [], charts: [], panels: [], actions: [],
  };
}