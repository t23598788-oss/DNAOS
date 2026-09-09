/**
 * หน้าที่: สัญญากลางของหน้าจอมาตรฐาน — STANDARD_SURFACE_V1
 *
 * Owner, 2026-09-05: โมดูลห้ามสร้างหน้าเอง มันประกาศแค่ว่าต้องการ surface ชนิดไหน
 * ผูกกับข้อมูลอะไร แล้วตัวเรนเดอร์กลางเป็นคนแสดง เป้าหมายคือเพิ่มหน้าใหม่ได้ด้วย
 * การผูกข้อมูล ไม่ใช่การให้ Agent เขียนหน้า React ใหม่ทุกครั้ง
 *
 * ไฟล์นี้ห้ามรู้จัก LINE ห้ามรู้จัก expense ห้ามรู้จักผู้ให้บริการใด — ถ้ามีชื่อ
 * เหล่านั้นโผล่ในไฟล์นี้เมื่อไร แปลว่า contract รั่วกลายเป็นของเฉพาะกิจแล้ว
 *
 * Input: none (นิยามชนิดล้วน)
 * Output: SurfaceDefinition, SurfaceColumn, SurfaceAction, RenderedSurface
 * Dependency ที่อนุญาต: none
 * สิ่งที่ห้ามแตะ:
 * - ห้ามใส่ตรรกะของผู้ให้บริการหรือของโมดูลใดลงในชนิดเหล่านี้
 * - ห้ามให้ surface ถือข้อมูลเอง มันถือแค่ "วิธีอ่าน" ข้อมูล
 * - ห้ามรวม empty_state เข้ากับ error_state — ไม่มีข้อมูล ≠ อ่านไม่ได้
 */

export type SurfaceType =
  | "INBOX" | "THREAD" | "TABLE" | "DOCUMENT_LIST" | "DOCUMENT_VIEWER"
  | "FORM" | "APPROVAL" | "STATUS" | "DASHBOARD" | "REPORT";

/** ชนิดที่มีตัวเรนเดอร์จริงแล้วในรอบนี้ — ที่เหลือประกาศไว้แต่ยังเรนเดอร์ไม่ได้ */
export const IMPLEMENTED_SURFACE_TYPES: readonly SurfaceType[] =
  ["INBOX", "DOCUMENT_LIST", "TABLE", "STATUS", "APPROVAL"];

export interface SurfaceColumn {
  readonly key: string;
  readonly label: string;
  /** ใช้จัดรูปแบบเท่านั้น ไม่ได้เปลี่ยนค่า */
  readonly kind: "text" | "number" | "money" | "datetime" | "state";
  readonly primary?: boolean;
}

export interface SurfaceAction {
  readonly action_id: string;
  readonly label: string;
  /** ความสามารถที่ต้องมีจึงจะกดได้ — ตรวจที่ชั้นสิทธิ์ ไม่ใช่ที่หน้าจอ */
  readonly required_capability: string;
  readonly read_write_class: "READ_ONLY" | "EXTERNAL_WRITE";
}

/** ที่มาของข้อมูล — ตัวชี้ไปยังความสามารถในทะเบียน ไม่ใช่ path ของไฟล์ */
export interface SurfaceDataContract {
  readonly capability: string;
  readonly row_shape: readonly string[];
  readonly row_id_field: string;
}

export interface SurfaceDefinition {
  readonly surface_id: string;
  readonly surface_type: SurfaceType;
  readonly title: string;
  readonly data_contract: SurfaceDataContract;
  readonly actions: readonly SurfaceAction[];
  readonly permissions: readonly string[];
  readonly filters: readonly { readonly field: string; readonly op: "eq" | "contains" | "gte" | "lte"; readonly value: unknown }[];
  readonly sort: { readonly field: string; readonly direction: "asc" | "desc" } | null;
  readonly columns: readonly SurfaceColumn[];
  readonly refresh_policy: { readonly kind: "ON_DEMAND" | "POLL"; readonly interval_ms?: number };
  readonly empty_state: string;
  readonly error_state: string;
}

export type SurfaceStatus = "OK" | "EMPTY" | "ERROR" | "UNSUPPORTED_TYPE";

export interface RenderedSurface {
  readonly surface_id: string;
  readonly surface_type: SurfaceType;
  readonly title: string;
  readonly status: SurfaceStatus;
  readonly columns: readonly SurfaceColumn[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly row_count: number;
  readonly message: string | null;
  readonly rendered_at: string;
  /** ใครเป็นคนบอกข้อมูลนี้ — ตรวจย้อนได้ว่าไม่ได้แต่งขึ้น */
  readonly source_capability: string;
}
