/**
 * Owner Worker Settings Runtime (owner, 2026-08-08, Software Factory
 * Step 13.6, Section 15). Real, Owner-only settings over the Universal
 * Worker Bridge — never a Public Settings surface, never a secret value
 * in the returned shape (only real CONFIGURED/NOT_CONFIGURED/ACTIVE/
 * PARTIAL/UNKNOWN status per field, per Section 15's explicit mandate).
 */
import { WORKER_ADAPTER_REGISTRY } from "./workerSelectorRuntime";

export type SettingsStatus = "CONFIGURED" | "NOT_CONFIGURED" | "ACTIVE" | "PARTIAL" | "UNKNOWN";
export type LocalCloudPreference = "LOCAL_PREFERRED" | "CLOUD_PREFERRED" | "NO_PREFERENCE";
export type FallbackPolicyMode = "ALLOW_FALLBACK" | "NO_FALLBACK";
export type ApprovalMode = "OWNER_APPROVAL_REQUIRED" | "AUTO_LOW_RISK";

export interface WorkerSettings {
  ownerId: string;
  providerEnabled: Record<string, boolean>;
  localCloudPreference: LocalCloudPreference;
  allowedWorkerTypes: string[];
  budgetDefaults: { maxProviderCalls: number; maxTokens: number; maxEstimatedCost: number | null };
  privacyPolicy: "LOCAL_ONLY" | "CLOUD_ALLOWED";
  fallbackPolicy: FallbackPolicyMode;
  modelPreference: string[];
  toolAccess: string[];
  maxContextBytes: number;
  approvalMode: ApprovalMode;
  updatedAt: string;
}

function defaultSettings(ownerId: string): WorkerSettings {
  return {
    ownerId, providerEnabled: Object.fromEntries(WORKER_ADAPTER_REGISTRY.map((a) => [a.id, true])),
    localCloudPreference: "NO_PREFERENCE", allowedWorkerTypes: ["CODE_WORKER", "ANALYSIS_WORKER", "REVIEW_WORKER", "TEST_WORKER", "TOOL_WORKER", "HUMAN_WORKER"],
    budgetDefaults: { maxProviderCalls: 1, maxTokens: 8000, maxEstimatedCost: 1.0 },
    privacyPolicy: "CLOUD_ALLOWED", fallbackPolicy: "ALLOW_FALLBACK", modelPreference: [], toolAccess: [],
    maxContextBytes: 200_000, approvalMode: "OWNER_APPROVAL_REQUIRED", updatedAt: new Date().toISOString(),
  };
}

/**
 * PERSISTENT store (owner 2026-10-08 review of a91d8b0): a JSON file inside
 * the container is NOT durable — the container has no volume, so a
 * redeploy/restart wipes it. Settings now live in the existing
 * `app_configs` table (title = "worker-settings", data = JSON — no new
 * migration, same table company-settings already uses), written through
 * supabaseAdmin (service role) and cached in-process only as a read
 * accelerator. Survives restart AND redeploy because the truth is in the
 * database, not on disk.
 */
import { supabaseAdmin } from "@/services/supabase/queries";

const SETTINGS_ROW = "worker-settings";

type SettingsFile = Record<string, WorkerSettings>;

let settingsCache: SettingsFile | null = null;

async function loadStore(): Promise<SettingsFile> {
  if (settingsCache) return settingsCache;
  const { data, error } = await supabaseAdmin()
    .from("app_configs")
    .select("data")
    .eq("title", SETTINGS_ROW)
    .maybeSingle();
  if (error) throw new Error(`โหลด worker settings ไม่สำเร็จ: ${error.message}`);
  if (!data || typeof data.data !== "string" || !data.data.trim()) {
    settingsCache = {};
    return settingsCache;
  }
  try {
    const parsed = JSON.parse(data.data) as SettingsFile;
    settingsCache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Corrupt row is treated as "no saved settings yet" — never a fabricated
    // guess at its contents (same rule as executionContextRuntime).
    settingsCache = {};
  }
  return settingsCache;
}

async function persistStore(file: SettingsFile): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("app_configs")
    .upsert({ title: SETTINGS_ROW, data: JSON.stringify(file) }, { onConflict: "title" });
  if (error) throw new Error(`บันทึก worker settings ไม่สำเร็จ: ${error.message}`);
  settingsCache = file;
}

export async function getWorkerSettings(ownerId: string): Promise<WorkerSettings> {
  const store = await loadStore();
  return store[ownerId] ?? defaultSettings(ownerId);
}

/** Real, Owner-only update — never accepts a secret value field (there
 * is none in the real WorkerSettings shape; secrets stay in real
 * process.env, never here — Section 16). Persists to the database row. */
export async function updateWorkerSettings(
  ownerId: string,
  patch: Partial<Omit<WorkerSettings, "ownerId" | "updatedAt">>,
): Promise<WorkerSettings> {
  const current = await getWorkerSettings(ownerId);
  const updated: WorkerSettings = { ...current, ...patch, ownerId, updatedAt: new Date().toISOString() };
  const store = await loadStore();
  store[ownerId] = updated;
  await persistStore(store);
  return updated;
}

export interface ProviderSettingsStatus { adapterId: string; enabled: boolean; status: SettingsStatus; reason: string }

/** Real, live-checked status per Adapter — reuses each real Adapter's
 * own availability() (never a second config-presence check). */
export async function computeProviderStatuses(ownerId: string): Promise<ProviderSettingsStatus[]> {
  const settings = await getWorkerSettings(ownerId);
  return WORKER_ADAPTER_REGISTRY.map((a) => {
    const enabled = settings.providerEnabled[a.id] ?? true;
    const avail = a.availability();
    let status: SettingsStatus;
    if (!enabled) status = "NOT_CONFIGURED";
    else if (!avail.available) status = "NOT_CONFIGURED";
    else status = "CONFIGURED";
    return { adapterId: a.id, enabled, status, reason: avail.reason };
  });
}
