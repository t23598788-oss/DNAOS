/**
 * หน้าที่: ตัวเรนเดอร์กลาง — รับ "นิยาม surface" กับ "ข้อมูลที่ normalize แล้ว"
 * แล้วคืนตารางที่พร้อมแสดง โดยไม่รู้ว่าข้อมูลมาจากโมดูลไหน
 *
 * Owner, 2026-09-05 ข้อ 4: ห้ามมี component เฉพาะกิจของ LINE หรือของ expense
 * ไฟล์นี้จึงไม่มี import ของโมดูลใดเลย ผู้เรียกเป็นคนส่งข้อมูลเข้ามา
 *
 * กรอง/เรียง/เลือกคอลัมน์ ตามนิยามเท่านั้น ไม่มีการแปลงค่า ไม่มีการเดาค่าที่ขาด
 * ค่าที่ไม่มีคือไม่มี — ไม่เติมค่าว่างให้ดูสวย เพราะหน้าจอต้องบอกความจริง
 *
 * Input: SurfaceDefinition + แถวข้อมูล
 * Output: RenderedSurface
 * Dependency ที่อนุญาต: ./types.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้าม import โมดูลธุรกิจใด
 * - ห้ามแต่งค่าที่ข้อมูลไม่มี
 * - ห้ามคืน OK เมื่อชนิด surface ยังไม่มีตัวเรนเดอร์
 */

import { IMPLEMENTED_SURFACE_TYPES, type RenderedSurface, type SurfaceDefinition } from "./types";

function valueOf(row: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined;
}

function passesFilters(row: Readonly<Record<string, unknown>>, def: SurfaceDefinition): boolean {
  for (const f of def.filters) {
    const v = valueOf(row, f.field);
    if (f.op === "eq" && v !== f.value) return false;
    if (f.op === "contains" && !String(v ?? "").includes(String(f.value))) return false;
    if (f.op === "gte" && !(String(v ?? "") >= String(f.value))) return false;
    if (f.op === "lte" && !(String(v ?? "") <= String(f.value))) return false;
  }
  return true;
}

export function renderSurface(
  def: SurfaceDefinition,
  rows: readonly Readonly<Record<string, unknown>>[],
): RenderedSurface {
  const base = { surface_id: def.surface_id, surface_type: def.surface_type, title: def.title,
    columns: def.columns, rendered_at: new Date().toISOString(),
    source_capability: def.data_contract.capability };

  if (!IMPLEMENTED_SURFACE_TYPES.includes(def.surface_type)) {
    return { ...base, status: "UNSUPPORTED_TYPE", rows: [], row_count: 0,
      message: `ยังไม่มีตัวเรนเดอร์สำหรับ ${def.surface_type} — ประกาศไว้แล้วแต่ยังแสดงไม่ได้` };
  }

  const filtered = rows.filter((r) => passesFilters(r, def));
  const sorted = def.sort === null ? [...filtered] : [...filtered].sort((a, b) => {
    const av = String(valueOf(a, def.sort!.field) ?? ""), bv = String(valueOf(b, def.sort!.field) ?? "");
    return def.sort!.direction === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  // เลือกเฉพาะคอลัมน์ที่นิยามไว้ — ฟิลด์ที่แถวไม่มีจะไม่ถูกใส่ ไม่ใช่ใส่ค่าว่าง
  const projected = sorted.map((r) => {
    const out: Record<string, unknown> = { [def.data_contract.row_id_field]: valueOf(r, def.data_contract.row_id_field) };
    for (const c of def.columns) { const v = valueOf(r, c.key); if (v !== undefined) out[c.key] = v; }
    return out;
  });

  return projected.length === 0
    ? { ...base, status: "EMPTY", rows: [], row_count: 0, message: def.empty_state }
    : { ...base, status: "OK", rows: projected, row_count: projected.length, message: null };
}
