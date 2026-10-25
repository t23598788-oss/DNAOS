import type { RenderModel } from "../renderModel";

export interface PartnerSummaryDTO {
  totalCount: number;
  items: { id: string; name: string; type: string; phone: string }[];
}

export function toRenderModel(dto: PartnerSummaryDTO): RenderModel {
  return {
    title: "พาร์ทเนอร์",
    subtitle: `${dto.totalCount} ราย`,
    widgets: [{ id: "partner-count", label: "จำนวนพาร์ทเนอร์", value: dto.totalCount }],
    tables: [{
      id: "partner-items", title: "รายชื่อพาร์ทเนอร์",
      columns: ["ชื่อ", "ประเภท", "โทรศัพท์"],
      rows: dto.items.map((i) => [i.name, i.type, i.phone]),
    }],
    cards: [], charts: [], panels: [], actions: [],
  };
}