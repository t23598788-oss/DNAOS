/**
 * หน้าที่: ขอบเขตสาธารณะของ control/standard-surface/
 * Input: re-export เท่านั้น
 * Output: renderSurface, ชนิดของ surface และรายชื่อชนิดที่เรนเดอร์ได้จริง
 * Dependency ที่อนุญาต: ./types.ts, ./renderer.ts
 * สิ่งที่ห้ามแตะ: ห้าม export อะไรที่ผูกกับโมดูลธุรกิจใด
 */
export { renderSurface } from "./renderer";
export { IMPLEMENTED_SURFACE_TYPES } from "./types";
export type { SurfaceDefinition, SurfaceType, SurfaceColumn, SurfaceAction,
  SurfaceDataContract, RenderedSurface, SurfaceStatus } from "./types";
