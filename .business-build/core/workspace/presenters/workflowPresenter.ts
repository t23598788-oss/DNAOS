import type { RenderModel } from "../renderModel";

export interface WorkflowSummaryDTO {
  items: { orderId: string; orderNo: string; txType: string; stepLabel: string; isFinal: boolean; isPending: boolean }[];
}

export function toRenderModel(dto: WorkflowSummaryDTO): RenderModel {
  return {
    title: "สถานะ Workflow คำสั่งซื้อ",
    subtitle: `${dto.items.length} รายการ`,
    widgets: [
      { id: "wf-pending", label: "รอดำเนินการ", value: dto.items.filter((i) => i.isPending).length },
      { id: "wf-final", label: "เสร็จสิ้น", value: dto.items.filter((i) => i.isFinal).length },
    ],
    tables: [{
      id: "wf-items", title: "สถานะรายคำสั่งซื้อ",
      columns: ["เลขที่คำสั่งซื้อ", "ประเภท", "ขั้นตอนปัจจุบัน", "สถานะ"],
      rows: dto.items.map((i) => [i.orderNo, i.txType, i.stepLabel, i.isFinal ? "เสร็จสิ้น" : i.isPending ? "รอดำเนินการ" : "กำลังดำเนินการ"]),
    }],
    cards: [], charts: [], panels: [], actions: [],
  };
}