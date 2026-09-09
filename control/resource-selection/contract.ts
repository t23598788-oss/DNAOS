/**
 * หน้าที่: ขอบเขตสาธารณะของ control/resource-selection/
 * Input: re-export เท่านั้น
 * Output: selectResourcesFor และชนิดข้อมูลของผล
 * Dependency ที่อนุญาต: ./select.ts
 * สิ่งที่ห้ามแตะ: ห้าม export ทางที่ให้ผู้เรียกระบุ resource เอง
 */
export { selectResourcesFor } from "./select";
export { requiredCapabilitiesFor, CAPABILITY_MARKERS } from "./intent-capabilities";
export type { IntentCapabilityResolution, CapabilityMarker } from "./intent-capabilities";
export type { SelectionResult, SelectedResource } from "./select";
export { recordResolution, resolutionFor, RESOLUTION_FILE } from "./resolution-store";
export type { ResourceResolutionRecord, ResourceExecution } from "./resolution-store";
