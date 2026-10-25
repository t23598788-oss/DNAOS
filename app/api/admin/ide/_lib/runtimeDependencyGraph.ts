/** Existing source-derived dependency graph; no Developer runtime imports. */
import { readFileSync, existsSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
const ROOT = WORKSPACE_ROOT;
function safeRead(rel: string): string { try { return readFileSync(path.join(ROOT, rel), "utf-8"); } catch { return ""; } }


// ============================================================
// Phase 4 — Runtime Dependency Graph (mechanical, from real imports)
// ============================================================
export interface RuntimeNode {
  id: string;
  file: string | null;
  status: "REAL" | "NOT_IMPLEMENTED";
  evidence: string;
}

export interface RuntimeEdge {
  from: string;
  to: string;
}

export interface RuntimeDependencyGraph {
  generatedAt: string;
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
}


/** The real set of Runtime files this audit covers — every `file` entry
 * here was verified present by direct inspection. monitoringRuntime/
 * incidentRuntime/recoveryRuntime are real, existing files as of Step 12
 * (observe/plan/verify only — never a real mutation). */
const RUNTIME_NODES: { id: string; file: string | null }[] = [
  { id: "executionRuntime", file: "app/api/admin/ide/_lib/executionRuntime.ts" },
  { id: "queueRuntime", file: "app/api/admin/ide/_lib/queueRuntime.ts" },
  { id: "inspectionRuntime", file: "app/api/admin/ide/_lib/inspectionRuntime.ts" },
  { id: "governanceRuntime", file: "app/api/admin/ide/_lib/governanceRuntime.ts" },
  { id: "artifactRuntime", file: "app/api/admin/ide/_lib/artifactRuntime.ts" },
  { id: "changeSetRuntime", file: "app/api/admin/ide/_lib/changeSetRuntime.ts" },
  { id: "testRuntime", file: "app/api/admin/ide/_lib/testRuntime.ts" },
  { id: "buildRuntime", file: "app/api/admin/ide/_lib/buildRuntime.ts" },
  { id: "releaseRuntime", file: "app/api/admin/ide/_lib/releaseRuntime.ts" },
  { id: "factoryCompletionRuntime", file: "app/api/admin/ide/_lib/factoryCompletionRuntime.ts" },
  { id: "deploymentRuntime", file: "app/api/admin/ide/_lib/deploymentRuntime.ts" },
  { id: "globalFactoryRuntime", file: "app/api/admin/ide/_lib/globalFactoryRuntime.ts" },
  { id: "monitoringRuntime", file: "app/api/admin/ide/_lib/monitoringRuntime.ts" },
  { id: "incidentRuntime", file: "app/api/admin/ide/_lib/incidentRuntime.ts" },
  { id: "recoveryRuntime", file: "app/api/admin/ide/_lib/recoveryRuntime.ts" },
  { id: "continuousOperationsRuntime", file: "app/api/admin/ide/_lib/continuousOperationsRuntime.ts" },
  { id: "alertRuntime", file: "app/api/admin/ide/_lib/alertRuntime.ts" },
  { id: "backupRuntime", file: "app/api/admin/ide/_lib/backupRuntime.ts" },
  { id: "restoreTestRuntime", file: "app/api/admin/ide/_lib/restoreTestRuntime.ts" },
];


export function computeRuntimeDependencyGraph(): RuntimeDependencyGraph {
  const fileToId = new Map<string, string>();
  for (const n of RUNTIME_NODES) if (n.file) fileToId.set(path.basename(n.file, ".ts"), n.id);

  const nodes: RuntimeNode[] = RUNTIME_NODES.map((n) => {
    if (!n.file) {
      return { id: n.id, file: null, status: "NOT_IMPLEMENTED", evidence: `no real source file found under app/api/admin/ide/_lib/ (grep-verified) — this Runtime does not exist yet` };
    }
    const exists = existsSync(path.join(ROOT, n.file));
    return { id: n.id, file: n.file, status: exists ? "REAL" : "NOT_IMPLEMENTED", evidence: exists ? `real, existing file: ${n.file}` : `declared file ${n.file} does not exist on disk` };
  });

  const edges: RuntimeEdge[] = [];
  for (const n of RUNTIME_NODES) {
    if (!n.file || !existsSync(path.join(ROOT, n.file))) continue;
    const src = safeRead(n.file);
    const importRegex = /from\s+["']\.\/(\w+)["']/g;
    for (const m of src.matchAll(importRegex)) {
      const targetId = fileToId.get(m[1]);
      if (targetId && targetId !== n.id) edges.push({ from: n.id, to: targetId });
    }
  }

  return { generatedAt: new Date().toISOString(), nodes, edges };
}
