import moduleRegistryData from "@/registry/module-registry.json";
import dependencyGraphData from "@/registry/dependency-graph.json";

// Module Registry — reads the existing, already-authoritative
// registry/module-registry.json (380 real modules, every file in this repo
// already required to register there — see CLAUDE.md's "ห้ามมี Shadow
// System") and generates a Node definition for each one automatically. This
// file never rewrites a module and never imports one directly; the Workspace
// consumes this registry, not the modules themselves.

export interface ModuleNode {
  id: string; // file path — already the unique key module-registry.json uses
  name: string;
  icon: string;
  category: string; // = layer (api/app/core/engines/gateway/cognitive/presenter/services/plugins/...)
  inputPorts: string[]; // layers this module's layer is allowed to import from
  outputPorts: string[]; // layers allowed to import this module's layer
  status: string;
  metadata: {
    owner: string;
    purpose: string;
    purposeTh?: string;
    exports: string[];
    filePath: string;
  };
}

interface ModuleRegistryFile {
  modules: Record<
    string,
    {
      owner: string;
      layer: string;
      purpose: string;
      purpose_th?: string;
      exports?: string[];
      status: string;
    }
  >;
}

interface DependencyGraphFile {
  allowed_imports: Record<string, string[]>;
}

const LAYER_ICON: Record<string, string> = {
  api: "Server",
  app: "LayoutGrid",
  core: "Cpu",
  engines: "Calculator",
  gateway: "DoorOpen",
  cognitive: "Brain",
  presenter: "MonitorSmartphone",
  services: "Plug",
  plugins: "Puzzle",
  registry: "Database",
  components: "Component",
  ui: "PaintBucket",
  config: "Settings",
  scripts: "Terminal",
  supabase: "Database",
  "middleware.ts": "Shield",
};

function iconFor(layer: string): string {
  return LAYER_ICON[layer] ?? "Box";
}

// Ports are derived, not stored — read straight out of
// registry/dependency-graph.json's layer-level allowed_imports map, the
// existing single source of truth for cross-layer imports in this codebase
// (CLAUDE.md: "ทุก import ข้ามlayer ต้องอยู่ใน dependency-graph.json").
function portsFor(layer: string, allowedImports: Record<string, string[]>): { inputPorts: string[]; outputPorts: string[] } {
  const inputPorts = allowedImports[layer] ?? [];
  const outputPorts = Object.entries(allowedImports)
    .filter(([, deps]) => deps.includes(layer))
    .map(([consumerLayer]) => consumerLayer);
  return { inputPorts, outputPorts };
}

export function generateModuleNodes(): ModuleNode[] {
  const { modules } = moduleRegistryData as ModuleRegistryFile;
  const { allowed_imports } = dependencyGraphData as DependencyGraphFile;

  return Object.entries(modules).map(([filePath, mod]) => {
    const { inputPorts, outputPorts } = portsFor(mod.layer, allowed_imports);
    return {
      id: filePath,
      name: mod.purpose_th || mod.purpose || filePath.split("/").pop() || filePath,
      icon: iconFor(mod.layer),
      category: mod.layer,
      inputPorts,
      outputPorts,
      status: mod.status,
      metadata: {
        owner: mod.owner,
        purpose: mod.purpose,
        purposeTh: mod.purpose_th,
        exports: mod.exports ?? [],
        filePath,
      },
    };
  });
}

// Computed once at module load — module-registry.json/dependency-graph.json
// are static build-time data, not runtime-mutable state, so there's nothing
// to subscribe to here (unlike runtimeRegistry/attachmentRegistry).
const nodes = generateModuleNodes();
const nodesById = new Map(nodes.map((n) => [n.id, n]));

export const moduleRegistry = {
  list(): ModuleNode[] {
    return nodes;
  },
  get(id: string): ModuleNode | undefined {
    return nodesById.get(id);
  },
  byCategory(category: string): ModuleNode[] {
    return nodes.filter((n) => n.category === category);
  },
};

export type ModuleRegistry = typeof moduleRegistry;