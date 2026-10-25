import registryData from "@/registry/capability-registry.json";

// Read-only accessor over registry/capability-registry.json — the ONLY data
// source anything in core/workspace/composer/ is allowed to touch. No
// Runtime, no Business Engine, no Gateway, no Presenter, no Supabase import
// anywhere in this directory — structurally verified by grep, not just by
// convention (see Composer Validation Report).

export interface CapabilityEntry {
  CapabilityId: string;
  OwnerModule: string;
  ExportName: string;
  Category: string;
  Description: string;
  Version: string;
  InputContract: string;
  OutputContract: string;
  ExecutionType: string;
  Mutability: string;
  StatePolicy: string;
  MultipleInstanceSupport: boolean;
  Dependencies: string[];
  Tags: string[];
  Status: string;
  DiscoveryMetadata: Record<string, unknown>;
}

interface CapabilityRegistryFile {
  version: string;
  frozen: boolean;
  checksum: string;
  capabilityCount: number;
  capabilities: CapabilityEntry[];
}

const registry = registryData as CapabilityRegistryFile;
const byId = new Map(registry.capabilities.map((c) => [c.CapabilityId, c]));

export const capabilityRegistryAccess = {
  version: registry.version,
  checksum: registry.checksum,

  get(id: string): CapabilityEntry | undefined {
    return byId.get(id);
  },

  exists(id: string): boolean {
    return byId.has(id);
  },

  list(): CapabilityEntry[] {
    return registry.capabilities;
  },
};