/**
 * Compute Resource Registry Runtime (owner, 2026-08-10, DigitalOcean AI
 * Inference Infrastructure Control & Billing Layer). Real, provider-
 * neutral CPU/RAM/GPU/VRAM/storage/region/price/runtime-status/health
 * tracking — registry/COMPUTE_RESOURCE_REGISTRY.json. Deliberately NOT
 * bound to DigitalOcean (Owner's own instruction: "อย่าผูก Compute
 * Registry กับ DigitalOcean โดยตรง") — the same shape and functions here
 * work for RunPod, GPU Droplets, Dedicated Inference, or any future
 * compute provider; provider is just a field value, never a branch.
 *
 * Starts with zero entries (see the registry file's own honesty_note) —
 * this module provides the real, structural write path; a future,
 * separate live-query integration (RunPod API / DigitalOcean Dedicated
 * Inference API) is what would actually populate it, not this pass.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";

const REGISTRY_PATH = join(WORKSPACE_ROOT, "registry", "COMPUTE_RESOURCE_REGISTRY.json");

export interface ComputeResource {
  provider: string;
  provider_resource_id: string;
  cpu_cores: number | null;
  ram_gb: number | null;
  gpu: string | null;
  vram_gb: number | null;
  storage_gb: number | null;
  region: string | null;
  price_per_hour: number | null;
  currency: string | null;
  runtime_status: string;
  health: string;
  current_workload: string | null;
  last_verified_at: string | null;
}

interface ComputeResourceRegistryFile {
  version: number;
  resources: ComputeResource[];
}

function loadFile(): ComputeResourceRegistryFile {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as ComputeResourceRegistryFile;
}

function saveFile(file: ComputeResourceRegistryFile): void {
  writeFileSync(REGISTRY_PATH, JSON.stringify(file, null, 2) + "\n", "utf-8");
}

export function listComputeResources(): ComputeResource[] {
  return loadFile().resources;
}

/** Real upsert, keyed by (provider, provider_resource_id) — matches the
 * real resource's own real identity, never a fabricated id. */
export function upsertComputeResource(resource: ComputeResource): ComputeResource {
  const file = loadFile();
  const idx = file.resources.findIndex((r) => r.provider === resource.provider && r.provider_resource_id === resource.provider_resource_id);
  if (idx >= 0) file.resources[idx] = resource;
  else file.resources.push(resource);
  saveFile(file);
  return resource;
}

export function listComputeResourcesByProvider(provider: string): ComputeResource[] {
  return loadFile().resources.filter((r) => r.provider === provider);
}
