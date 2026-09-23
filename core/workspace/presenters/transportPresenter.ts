import type { RenderModel } from "../renderModel";

// Transport Presenter — carries an explicit `available` state rather than
// silently returning empty data or crashing.
//
// CORRECTION (2026-09-23, live read-only check): the earlier note here claimed
// no job table exists anywhere in production (2026-07-14 inspection). That is
// no longer true — public.jobs EXISTS and is the table the job capability reads
// (getJobs(), scoped to deleted_at IS NULL); only public.transport_jobs,
// delivery_jobs and the other legacy names checked remain absent. This presenter
// is still NOT wired to that data source, and its DTO still carries the old
// transport_jobs shape, so `available: false` stays exactly as-is: a real
// "not wired" state, never fabricated placeholder content.
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