import type { RenderModel } from "../renderModel";

export interface MaterialSummaryDTO {
  totalCount: number;
  items: { id: string; name: string }[];
}

export function toRenderModel(dto: MaterialSummaryDTO): RenderModel {
  return {
    title: "ประเภทวัสดุ",
    subtitle: `${dto.totalCount} ประเภท`,
    widgets: [{ id: "material-count", label: "จำนวนประเภทวัสดุ", value: dto.totalCount }],
    tables: [{
      id: "material-items", title: "รายชื่อวัสดุ",
      columns: ["ชื่อวัสดุ"],
      rows: dto.items.map((i) => [i.name]),
    }],
    cards: [], charts: [], panels: [], actions: [],
  };
}