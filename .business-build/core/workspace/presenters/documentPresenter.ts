import type { RenderModel } from "../renderModel";

export interface DocumentSummaryDTO {
  totalCount: number;
  items: { id: string; documentType: string; documentNumber: string; status: string; partyName: string }[];
}

export function toRenderModel(dto: DocumentSummaryDTO): RenderModel {
  return {
    title: "เอกสาร",
    subtitle: `${dto.totalCount} ฉบับ`,
    widgets: [{ id: "document-count", label: "จำนวนเอกสาร", value: dto.totalCount }],
    tables: [{
      id: "document-items", title: "รายการเอกสาร",
      columns: ["ประเภท", "เลขที่", "สถานะ", "คู่ค้า"],
      rows: dto.items.map((i) => [i.documentType, i.documentNumber, i.status, i.partyName]),
    }],
    cards: [], charts: [], panels: [], actions: [],
  };
}