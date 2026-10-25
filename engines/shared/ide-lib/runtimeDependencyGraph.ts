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
  { id: "executionRuntime", file: "engines/shared/ide-lib/executionRuntime.ts" },
  { id: "queueRuntime", file: "engines/shared/ide-lib/queueRuntime.ts" },
  { id: "inspectionRuntime", file: "engines/shared/ide-lib/inspectionRuntime.ts" },
  { id: "governanceRuntime", file: "engines/shared/ide-lib/governanceRuntime.ts" },
  { id: "artifactRuntime", file: "engines/shared/ide-lib/artifactRuntime.ts" },
  { id: "changeSetRuntime", file: "engines/shared/ide-lib/changeSetRuntime.ts" },
  { id: "testRuntime", file: "engines/shared/ide-lib/testRuntime.ts" },
  { id: "buildRuntime", file: "engines/shared/ide-lib/buildRuntime.ts" },
  { id: "releaseRuntime", file: "engines/shared/ide-lib/releaseRuntime.ts" },
  { id: "factoryCompletionRuntime", file: "engines/shared/ide-lib/factoryCompletionRuntime.ts" },
  { id: "deploymentRuntime", file: "engines/shared/ide-lib/deploymentRuntime.ts" },
  { id: "globalFactoryRuntime", file: "engines/shared/ide-lib/globalFactoryRuntime.ts" },
  { id: "monitoringRuntime", file: "engines/shared/ide-lib/monitoringRuntime.ts" },
  { id: "incidentRuntime", file: "engines/shared/ide-lib/incidentRuntime.ts" },
  { id: "recoveryRuntime", file: "engines/shared/ide-lib/recoveryRuntime.ts" },
  { id: "continuousOperationsRuntime", file: "engines/shared/ide-lib/continuousOperationsRuntime.ts" },
  { id: "alertRuntime", file: "engines/shared/ide-lib/alertRuntime.ts" },
  { id: "backupRuntime", file: "engines/shared/ide-lib/backupRuntime.ts" },
  { id: "restoreTestRuntime", file: "engines/shared/ide-lib/restoreTestRuntime.ts" },
];


export function computeRuntimeDependencyGraph(): RuntimeDependencyGraph {
  const fileToId = new Map<string, string>();
  for (const n of RUNTIME_NODES) if (n.file) fileToId.set(path.basename(n.file, ".ts"), n.id);

  const nodes: RuntimeNode[] = RUNTIME_NODES.map((n) => {
    if (!n.file) {
      return { id: n.id, file: null, status: "NOT_IMPLEMENTED", evidence: `no real source file found under engines/shared/ide-lib/ (grep-verified) — this Runtime does not exist yet` };
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
