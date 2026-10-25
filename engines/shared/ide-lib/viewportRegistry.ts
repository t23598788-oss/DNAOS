/**
 * Viewport Profile Registry (owner, 2026-08-06, Software Factory Step 6:
 * UI Inspection Capability). Single source of truth for every viewport
 * shape the Browser Inspection Runtime can scan against — reused by
 * browserInspectionRuntime.ts and every UI Inspection API route, never
 * hardcoded a second time.
 */
export interface ViewportProfile {
  id: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  orientation: "portrait" | "landscape";
  status: "IMPLEMENTED";
  evidenceSource: string;
}

export const VIEWPORT_PROFILE_REGISTRY: Record<string, ViewportProfile> = {
  DESKTOP_1920_1080: { id: "DESKTOP_1920_1080", width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false, orientation: "landscape", status: "IMPLEMENTED", evidenceSource: "playwright page.setViewportSize + browserContext deviceScaleFactor" },
  DESKTOP_1440_900: { id: "DESKTOP_1440_900", width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false, orientation: "landscape", status: "IMPLEMENTED", evidenceSource: "playwright page.setViewportSize + browserContext deviceScaleFactor" },
  LAPTOP_1366_768: { id: "LAPTOP_1366_768", width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false, orientation: "landscape", status: "IMPLEMENTED", evidenceSource: "playwright page.setViewportSize + browserContext deviceScaleFactor" },
  LAPTOP_1280_720: { id: "LAPTOP_1280_720", width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false, orientation: "landscape", status: "IMPLEMENTED", evidenceSource: "playwright page.setViewportSize + browserContext deviceScaleFactor" },
  TABLET_1024_768: { id: "TABLET_1024_768", width: 1024, height: 768, deviceScaleFactor: 2, isMobile: true, hasTouch: true, orientation: "landscape", status: "IMPLEMENTED", evidenceSource: "playwright page.setViewportSize + browserContext deviceScaleFactor/isMobile/hasTouch" },
  TABLET_768_1024: { id: "TABLET_768_1024", width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true, orientation: "portrait", status: "IMPLEMENTED", evidenceSource: "playwright page.setViewportSize + browserContext deviceScaleFactor/isMobile/hasTouch" },
  MOBILE_430_932: { id: "MOBILE_430_932", width: 430, height: 932, deviceScaleFactor: 3, isMobile: true, hasTouch: true, orientation: "portrait", status: "IMPLEMENTED", evidenceSource: "playwright page.setViewportSize + browserContext deviceScaleFactor/isMobile/hasTouch (iPhone 15 Pro Max class)" },
  MOBILE_390_844: { id: "MOBILE_390_844", width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true, orientation: "portrait", status: "IMPLEMENTED", evidenceSource: "playwright page.setViewportSize + browserContext deviceScaleFactor/isMobile/hasTouch (iPhone 14/15 class)" },
  MOBILE_360_800: { id: "MOBILE_360_800", width: 360, height: 800, deviceScaleFactor: 3, isMobile: true, hasTouch: true, orientation: "portrait", status: "IMPLEMENTED", evidenceSource: "playwright page.setViewportSize + browserContext deviceScaleFactor/isMobile/hasTouch (common Android class)" },
};

export function listViewportProfiles(): ViewportProfile[] {
  return Object.values(VIEWPORT_PROFILE_REGISTRY);
}
export function getViewportProfile(id: string): ViewportProfile | undefined {
  return VIEWPORT_PROFILE_REGISTRY[id];
}
