import { supabase } from "@/lib/supabase/queries";

export interface RulesConfig {
  [key: string]: number | string;
}

let _cache: RulesConfig | null = null;
let _cacheExpiry = 0;

const CACHE_TTL = 60_000;

export async function loadConfigs(): Promise<RulesConfig> {
  if (_cache && Date.now() < _cacheExpiry) return _cache;

  const { data, error } = await supabase()
    .from("app_configs")
    .select("title, data");

  if (error) throw new Error(`config-loader: ${error.message}`);

  const configs: RulesConfig = {};
  for (const row of data ?? []) {
    const num = Number(row.data);
    configs[row.title] = isNaN(num) ? row.data : num;
  }

  _cache = configs;
  _cacheExpiry = Date.now() + CACHE_TTL;
  return configs;
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
