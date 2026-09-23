// UI Gallery — uiIndex.ts
//
// ชั้น "จัดเรียง/นับ" ของ UI Gallery — pure function ล้วน:
//   - ไม่มี I/O (ไม่ fetch, ไม่อ่าน localStorage, ไม่ import registry JSON)
//   - ไม่ import React component (component จริงอยู่ที่ _lib/componentHost.tsx)
//   - ไม่มี business logic และไม่มี business data
//
// แหล่งข้อมูลเดียวคือ UI_CATALOG (presentation metadata) — Owner ข้อ 8
// (ไม่สร้าง registry ใหม่, ไม่แก้ registry/module-registry.json รอบนี้)

import {
  UI_CATALOG,
  UI_CATEGORY_ORDER,
  UI_COMPARE_PRESETS,
  PRESENTATION_CATALOG,
  PRESENTATION_GROUP_ORDER,
  type PresentationEntry,
  type PresentationGroup,
  type UiCategory,
  type UiComparePreset,
  type UiItem,
  type UiRenderMode,
} from "./uiCatalog";

export type { UiCategory, UiComparePreset, UiItem, UiRenderMode, PresentationEntry, PresentationGroup };
export { UI_CATEGORY_ORDER, UI_COMPARE_PRESETS, PRESENTATION_GROUP_ORDER };

// ── PRESENTATION CANONICAL (34 ไฟล์) — กลุ่มสำหรับ Owner review ────────────────
// ข้อมูลล้วน (ไม่มี I/O, ไม่มี React) — path/กลุ่ม/โหมดแสดงผล ของ presentation/ จริง

export function presentationItemsByGroup(): { group: PresentationGroup; items: PresentationEntry[] }[] {
  return PRESENTATION_GROUP_ORDER.map((group) => ({
    group,
    items: PRESENTATION_CATALOG.filter((i) => i.group === group),
  })).filter((g) => g.items.length > 0);
}

export const PRESENTATION_COUNTS = {
  total: PRESENTATION_CATALOG.length,
  renderable: PRESENTATION_CATALOG.filter((i) => i.kind === "renderable").length,
  nonVisual: PRESENTATION_CATALOG.filter((i) => i.kind === "non-visual").length,
  groups: PRESENTATION_GROUP_ORDER.filter((g) => PRESENTATION_CATALOG.some((i) => i.group === g)).length,
};

export interface UiCounts {
  total: number;
  main: number;
  branch: number;
  previewable: number;
  byCategory: Record<UiCategory, number>;
  byRenderMode: Record<UiRenderMode, number>;
  needsRealData: number;
  writeCapable: number;
  orphan: number;
}

export function listUiItems(): UiItem[] {
  return UI_CATALOG;
}

export function getUiItem(id: string): UiItem | undefined {
  return UI_CATALOG.find((i) => i.id === id);
}

export function getUiItems(ids: string[]): UiItem[] {
  return ids.map((id) => getUiItem(id)).filter((i): i is UiItem => !!i);
}

/** จัดกลุ่มตาม category ตามลำดับ UI_CATEGORY_ORDER (category ที่ไม่มี item จะไม่ถูกแสดง) */
export function uiItemsByCategory(): { category: UiCategory; items: UiItem[] }[] {
  return UI_CATEGORY_ORDER.map((category) => ({
    category,
    items: UI_CATALOG.filter((i) => i.category === category),
  })).filter((g) => g.items.length > 0);
}

/** ลายเซ็นของ shell/layout ที่ใช้ — ใช้ติดป้ายในหน้า compare ว่าสอง UI ใช้ shell เดียวกันหรือไม่ */
export function shellSignature(item: UiItem): string {
  if (item.shell) return item.shell;
  if (item.layout) return item.layout;
  return "— (component เดี่ยว ไม่มี shell)";
}

export function computeUiCounts(): UiCounts {
  const byCategory = {} as Record<UiCategory, number>;
  for (const c of UI_CATEGORY_ORDER) byCategory[c] = 0;

  const byRenderMode: Record<UiRenderMode, number> = { route: 0, component: 0, blocked: 0 };

  for (const item of UI_CATALOG) {
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
    byRenderMode[item.renderMode] += 1;
  }

  return {
    total: UI_CATALOG.length,
    main: UI_CATALOG.filter((i) => i.branch === "main").length,
    branch: UI_CATALOG.filter((i) => i.branch === "branch").length,
    previewable: byRenderMode.route + byRenderMode.component,
    byCategory,
    byRenderMode,
    needsRealData: UI_CATALOG.filter((i) => i.needsRealData).length,
    writeCapable: UI_CATALOG.filter((i) => i.writeCapable).length,
    orphan: UI_CATALOG.filter((i) => i.orphan).length,
  };
}

export const UI_COUNTS = computeUiCounts();

export interface UiFilter {
  query?: string;
  category?: UiCategory | "all";
  branch?: "all" | "main" | "branch";
  renderMode?: "all" | UiRenderMode;
}

export function filterUiItems(filter: UiFilter): UiItem[] {
  const q = (filter.query ?? "").trim().toLowerCase();
  return UI_CATALOG.filter((item) => {
    if (filter.category && filter.category !== "all" && item.category !== filter.category) return false;
    if (filter.branch && filter.branch !== "all" && item.branch !== filter.branch) return false;
    if (filter.renderMode && filter.renderMode !== "all" && item.renderMode !== filter.renderMode) return false;
    if (!q) return true;
    const haystack = [item.id, item.label, item.path, item.route, item.notes, item.shell]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * ป้ายกำกับสถานะของ item สำหรับแสดงในรายการ (คำนวณจาก metadata เท่านั้น)
 */
export function uiBadges(item: UiItem): string[] {
  const badges: string[] = [];
  if (item.branch === "branch") badges.push("branch-only");
  if (item.orphan) badges.push("orphan");
  if (item.needsRealData) badges.push("ข้อมูลจริง");
  if (item.writeCapable) badges.push("เขียนได้");
  if (item.renderMode === "blocked") badges.push("preview ตรง ๆ ไม่ได้");
  if (item.renderMode === "component") badges.push("component จริง");
  if (item.renderMode === "route") badges.push("route จริง");
  return badges;
}
