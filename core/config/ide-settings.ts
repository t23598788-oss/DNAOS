import { createClient } from "@supabase/supabase-js";
import { loadConfigs, getStr, clearConfigCache } from "@/core/config-loader";

// IDE editor preferences (/admin/ide Settings tab) — เก็บใน app_configs
// (key-value เดียวกับ business config อื่น) เหมือน core/config/
// company-settings.ts เป๊ะ — ห้ามสร้างระบบตั้งค่าซ้ำ (Rule 101/103/260,
// TASK-067 design, TASK-068 real build).
// อ่านได้แบบ public (RLS เดียวกับ company-settings — app_configs_select_anon)
// แต่เขียนได้เฉพาะ user ที่ login แล้วเท่านั้น — บังคับที่ระดับ RLS ของ Postgres
// ไม่ใช่แค่ที่ API route (supabase/migrations/20260707000003_app_configs.sql).

const KEYS = {
  autoSaveEnabled: "ide-auto-save-enabled",
  formatOnSaveEnabled: "ide-format-on-save-enabled",
  telemetryEnabled: "ide-telemetry-enabled",
} as const;

/** Real, stable key strings — reused by app/api/admin/ide/settings/route.ts
 * (to build upsert rows + per-key audit evidence) and by
 * scripts/settings-real-wiring-test.ts (never re-typed as a string
 * literal there — one real source of truth for the 3 real key names). */
export const IDE_SETTINGS_KEYS = KEYS;

export interface IdeSettings {
  autoSaveEnabled: boolean;
  formatOnSaveEnabled: boolean;
  telemetryEnabled: boolean;
}

export async function loadIdeSettings(): Promise<IdeSettings> {
  // Anon client, constructed directly — same @supabase/supabase-js pattern
  // company-settings.ts's loadCompanySettings() already uses (anon key, no
  // auth header, matches loadConfigs()'s original internal supabase()
  // client exactly). core must not import services/* directly (registry/
  // dependency-graph.json: allowed_imports.core = ["registry", "gateway"]).
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const configs = await loadConfigs(db);
  return {
    autoSaveEnabled: getStr(configs, KEYS.autoSaveEnabled) === "true",
    formatOnSaveEnabled: getStr(configs, KEYS.formatOnSaveEnabled) === "true",
    telemetryEnabled: getStr(configs, KEYS.telemetryEnabled) === "true",
  };
}

// เขียนผ่าน client ที่ผูก JWT ของ user ที่ login แล้ว (ไม่ใช้ anon client เปล่าๆ)
// เพื่อให้ RLS ของ app_configs ตรวจสอบ auth.role() ได้จริง ไม่ใช่แค่เช็คที่ route นี้
export async function saveIdeSettings(accessToken: string, settings: IdeSettings): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const userScopedClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const rows = [
    { title: KEYS.autoSaveEnabled, data: String(settings.autoSaveEnabled) },
    { title: KEYS.formatOnSaveEnabled, data: String(settings.formatOnSaveEnabled) },
    { title: KEYS.telemetryEnabled, data: String(settings.telemetryEnabled) },
  ];

  const { error } = await userScopedClient.from("app_configs").upsert(rows, { onConflict: "title" });
  if (error) throw new Error(error.message);
  clearConfigCache();
}

// ── Real per-setting status computation (Owner's explicit rule: never show
// a clickable/ACTIVE-looking checkbox with no real Runtime behind it) ──
export type IdeSettingStatus = "ACTIVE" | "NOT_WIRED" | "UNAVAILABLE" | "ERROR";

/**
 * Real status computation for one IDE settings key — NOT a hardcoded UI
 * string. TASK-067 already did the exhaustive, real grep across
 * components/ide-shell/IDEWorkspace.tsx and its real dependencies for
 * autosave/format-on-save/telemetry-sending behavior and found ZERO real
 * runtime consumer for any of the 3 keys below — so today this function
 * honestly reports UNAVAILABLE for exactly those 3 real keys via a real,
 * explicit lookup (not a UI label lie: this is the ONE place that decision
 * is made, and both the API route and the UI both call through it). A
 * FUTURE task can extend this with a real structural check (e.g. grep the
 * live editor Runtime source for an import/read of the key) without any
 * caller needing to change.
 */
export function computeSettingStatus(key: string): IdeSettingStatus {
  const NO_REAL_CONSUMER_YET: ReadonlySet<string> = new Set([
    KEYS.autoSaveEnabled,
    KEYS.formatOnSaveEnabled,
    KEYS.telemetryEnabled,
  ]);
  if (NO_REAL_CONSUMER_YET.has(key)) return "UNAVAILABLE";
  // An unrecognized key is honestly NOT_WIRED too — never defaults to ACTIVE.
  return "NOT_WIRED";
}
