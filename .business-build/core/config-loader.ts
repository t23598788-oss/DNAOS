import type { SupabaseClient } from "@supabase/supabase-js";

// Phase 2.3A: core must not import services/* directly (registry/
// dependency-graph.json: allowed_imports.core = ["registry"]). loadConfigs
// now takes the Supabase client as a parameter — callers (already allowed
// to import services/) pass in supabase() themselves.

export interface RulesConfig {
  [key: string]: number | string;
}

let _cache: RulesConfig | null = null;
let _cacheMeta: Record<string, string> = {}; // key → updated_at ISO timestamp
let _cacheExpiry = 0;

const CACHE_TTL = 60_000;

export function clearConfigCache(): void {
  _cache = null;
  _cacheMeta = {};
  _cacheExpiry = 0;
}

export async function loadConfigs(db: SupabaseClient): Promise<RulesConfig> {
  if (_cache && Date.now() < _cacheExpiry) return _cache;

  const { data, error } = await db
    .from("app_configs")
    .select("title, data, updated_at");

  if (error) throw new Error(`config-loader: ${error.message}`);

  const configs: RulesConfig = {};
  const meta: Record<string, string> = {};
  for (const row of data ?? []) {
    const num = Number(row.data);
    // แปลงเป็น number เฉพาะตอนแปลงกลับได้ค่าเดิมเป๊ะ — กัน string ที่ดูเหมือนเลขแต่มีความหมายตามตัวอักษร
    // เช่น เลขผู้เสียภาษี "0405569002851" ห้ามเสีย 0 นำหน้าไป
    configs[row.title] = !isNaN(num) && String(num) === row.data ? num : row.data;
    if (row.updated_at) meta[row.title] = row.updated_at;
  }

  _cache = configs;
  _cacheMeta = meta;
  _cacheExpiry = Date.now() + CACHE_TTL;
  return configs;
}

export function getConfigUpdatedAt(key: string): string | undefined {
  return _cacheMeta[key];
}

/** Real, current cached value for one key (owner, 2026-08-10, TASK-069 —
 * Auto-save real debounce runtime, capability #61) — reads the SAME `_cache`
 * loadConfigs() populates, never a second store. Used by
 * app/api/admin/ide/_lib/artifactRuntime.ts's SETTING_PERSISTED/
 * RUNTIME_BEHAVIOR_VERIFIED/SETTING_RELOADED evidence checks to verify a
 * real, CURRENT persisted value (not just "a write happened at some point",
 * which getConfigUpdatedAt() alone proves) — returns undefined when nothing
 * has been loaded into cache for that key, same honest-undefined contract
 * as getConfigUpdatedAt(). */
export function getConfigCachedValue(key: string): string | number | undefined {
  return _cache ? _cache[key] : undefined;
}

export function getNum(configs: RulesConfig, key: string): number {
  const v = configs[key];
  if (typeof v !== "number") {
    throw new Error(`[CONFIG MISSING] key="${key}" — ต้องใส่ใน app_configs table ก่อนใช้งาน`);
  }
  return v;
}

export function getStr(configs: RulesConfig, key: string): string {
  const v = configs[key];
  if (v === undefined) {
    throw new Error(`[CONFIG MISSING] key="${key}" — ต้องใส่ใน app_configs table ก่อนใช้งาน`);
  }
  return String(v);
}

export interface AuditTrail {
  engine: string;
  inputs: Record<string, unknown>;
  rules_used: Record<string, unknown>;
  result: Record<string, unknown>;
  calculated_at: string;
}

export function audit(engine: string, inputs: object, rules: object, result: object): AuditTrail {
  return {
    engine,
    inputs: inputs as Record<string, unknown>,
    rules_used: rules as Record<string, unknown>,
    result: result as Record<string, unknown>,
    calculated_at: new Date().toISOString(),
  };
}

// ── Consciousness Layer — ชั้นจิตสำนึก ────────────────────────────────────────
// กฎ 1: ระบบมีสิทธิ์ไม่รู้ แต่ไม่มีสิทธิ์เดาแล้วนำเสนอเป็นความจริง
// กฎ 2: ข้อมูลที่มี source จริงแต่หมดอายุแล้ว = ความรู้สองทันที

export type SourceTag = "db" | "config" | "calculated" | "assumed" | "user_input";

export interface VerifiedValue {
  key: string;
  value: number | string;
  source: SourceTag;
  reference?: string;       // e.g. "pit_materials:pit_profile_id=xxx" หรือ "app_configs.fuel-price"
  refreshed_at?: string;    // ISO timestamp ที่ข้อมูลถูก update ล่าสุดใน DB
  staleness_hours?: number; // อายุสูงสุดที่ยอมรับได้ก่อนเป็น "ความรู้สอง"
}

// อัตราการผันผวนของแต่ละ key — ราคาน้ำมันผันผวนตามสงคราม/ค่าบาท ต้องอัปเดตถี่กว่าค่าแรง
export const STALENESS_HOURS: Record<string, number> = {
  "fuel-price":               7 * 24,  // 7 วัน — ผันผวนตามตลาดน้ำมันโลก เงินเฟ้อ ค่าบาท
  "driver-wage-per-trip":    90 * 24,  // 90 วัน — ขยับตามค่าแรงขั้นต่ำ
  "pricing-markup-percent": 180 * 24,  // 6 เดือน — กลยุทธ์ธุรกิจ
  "wear-percent":           365 * 24,  // 1 ปี — เกือบคงที่ตามวิศวกรรม
  "vehicle-default-capacity": 365 * 24,
  "default-fuel-consumption": 365 * 24,
  "system-fee-percent":     180 * 24,
  "urgent-fee-percent":     180 * 24,
};

export function assertAllKnown(inputs: VerifiedValue[]): void {
  const unknown = inputs.filter((i) => i.source === "assumed");
  if (unknown.length > 0) {
    throw new Error(
      `[UNKNOWN_INPUT] ต้องการข้อมูลจริงก่อนคำนวณ: ${unknown.map((i) => i.key).join(", ")}`
    );
  }
}

export function assertNotStale(inputs: VerifiedValue[]): void {
  const now = Date.now();
  const stale = inputs.filter((i) => {
    if (!i.refreshed_at || !i.staleness_hours) return false;
    const ageHours = (now - new Date(i.refreshed_at).getTime()) / (1000 * 60 * 60);
    return ageHours > i.staleness_hours;
  });
  if (stale.length > 0) {
    const details = stale.map((i) => {
      const ageDays = Math.round((now - new Date(i.refreshed_at!).getTime()) / (1000 * 60 * 60 * 24));
      const maxDays = Math.round(i.staleness_hours! / 24);
      return `${i.key} (เก่า ${ageDays} วัน — ต้องอัปเดตทุก ${maxDays} วัน)`;
    });
    throw new Error(
      `[STALE_DATA] ความรู้สอง — ข้อมูลเก่าเกินเชื่อถือได้: ${details.join(", ")}`
    );
  }
}
