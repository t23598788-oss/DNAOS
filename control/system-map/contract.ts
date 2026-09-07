/**
 * หน้าที่: ขอบเขตสาธารณะของ control/system-map/
 * Input: re-export เท่านั้น
 * Output: การค้นแผนที่ และการคำนวณ/ตรวจขอบเขต
 * Dependency ที่อนุญาต: ./surface-map.ts, ./scope.ts
 * สิ่งที่ห้ามแตะ: ห้าม export ทางที่ให้ผู้เรียกกำหนด allowed_files เอง
 */
export { SURFACES, findSurface, surfacesWithElement } from "./surface-map";
export type { SurfaceSpec, SurfaceElement } from "./surface-map";
export { resolveScope, activeScopeFor, closeScope, pathInScope, SCOPE_FILE } from "./scope";
export type { ScopeGrant, ScopeResolution, ScopeIntent } from "./scope";
