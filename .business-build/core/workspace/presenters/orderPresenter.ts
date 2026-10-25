import type { RenderModel } from "../renderModel";

export interface OrderSummaryDTO {
  totalCount: number;
  items: { id: string; orderNo: string; status: string; partnerName: string }[];
}

export function toRenderModel(dto: OrderSummaryDTO): RenderModel {
  return {
    title: "คำสั่งซื้อ",
    subtitle: `${dto.totalCount} รายการ`,
    widgets: [{ id: "order-count", label: "จำนวนคำสั่งซื้อ", value: dto.totalCount }],
    tables: [{
      id: "order-items", title: "รายการคำสั่งซื้อ",
      columns: ["เลขที่", "สถานะ", "คู่ค้า"],
      rows: dto.items.map((i) => [i.orderNo, i.status, i.partnerName]),
    }],
    cards: [], charts: [], panels: [], actions: [],
  };
}