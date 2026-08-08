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

const settingsStore = new Map<string, WorkerSettings>();

export function getWorkerSettings(ownerId: string): WorkerSettings {
  return settingsStore.get(ownerId) ?? defaultSettings(ownerId);
}

/** Real, Owner-only update — never accepts a secret value field (there
 * is none in the real WorkerSettings shape; secrets stay in real
 * process.env, never here — Section 16). */
export function updateWorkerSettings(ownerId: string, patch: Partial<Omit<WorkerSettings, "ownerId" | "updatedAt">>): WorkerSettings {
  const current = getWorkerSettings(ownerId);
  const updated: WorkerSettings = { ...current, ...patch, ownerId, updatedAt: new Date().toISOString() };
  settingsStore.set(ownerId, updated);
  return updated;
}

export interface ProviderSettingsStatus { adapterId: string; enabled: boolean; status: SettingsStatus; reason: string }

/** Real, live-checked status per Adapter — reuses each real Adapter's
 * own availability() (never a second config-presence check). */
export function computeProviderStatuses(ownerId: string): ProviderSettingsStatus[] {
  const settings = getWorkerSettings(ownerId);
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
