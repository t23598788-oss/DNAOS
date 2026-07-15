import type { RenderModel } from "../renderModel";

// Transport Presenter — carries an explicit `available` state rather than
// silently returning empty data or crashing. Confirmed via live schema
// inspection (2026-07-14): no transport-job table exists anywhere in the
// production database (transport_jobs, jobs, delivery_jobs,
// transportation_jobs, vehicle_jobs, shipments all checked — none exist).
// This is not "0 rows", it's "no real data source" — the two states must
// stay visually distinguishable, so `available: false` is a real, separate
// case, not fabricated placeholder content.
export interface TransportSummaryDTO {
  available: boolean;
  totalCount: number;
  items: { id: string; jobNo: string; status: string; cost: number }[];
}

export function toRenderModel(dto: TransportSummaryDTO): RenderModel {
  if (!dto.available) {
    return {
      title: "งานขนส่ง",
      subtitle: "ไม่พร้อมใช้งาน",
      widgets: [],
      tables: [],
      cards: [{
        id: "transport-unavailable",
        title: "ยังไม่มีข้อมูลจริง",
        body: "ไม่พบตารางงานขนส่งในฐานข้อมูลจริง (ตรวจสอบ schema แล้ว 2026-07-14) — ต้องสร้างตารางจริงก่อนจึงจะแสดงข้อมูลได้",
      }],
      charts: [], panels: [], actions: [],
    };
  }

  return {
    title: "งานขนส่ง",
    subtitle: `${dto.totalCount} งาน`,
    widgets: [{ id: "transport-count", label: "จำนวนงานขนส่ง", value: dto.totalCount }],
    tables: [{
      id: "transport-items", title: "รายการงานขนส่ง",
      columns: ["เลขที่งาน", "สถานะ", "ค่าขนส่ง"],
      rows: dto.items.map((i) => [i.jobNo, i.status, i.cost.toLocaleString("th-TH", { minimumFractionDigits: 2 })]),
    }],
    cards: [], charts: [], panels: [], actions: [],
  };
}