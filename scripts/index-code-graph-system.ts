import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

type ArchSymbol = { name: string; kind: string; line_start: number; line_end: number };
type ArchNode = {
  id: string; type: string; layer?: string; name_en?: string; exports?: string[];
  status?: string; runtime_entry_point?: boolean; symbols?: ArchSymbol[];
  import_sites?: { specifier: string; resolved_target: string | null }[];
  internal_dependencies?: string[]; dependents?: string[]; purpose_th?: string;
  data_tables?: string[] | "UNKNOWN";
};
type ArchEdge = { source: string; target: string; label: string };
type TaskRecord = { id?: string; title?: string; status?: string; priority?: string; context_sources?: unknown; owner_request_ref?: unknown; gate?: unknown };
type GraphNode = {
  index_run_id: string; node_key: string; node_type: "File" | "Function" | "Module" | "Task";
  name: string; source_path: string | null; signature: string | null; metadata: Record<string, unknown>;
};
type GraphEdge = {
  index_run_id: string; edge_type: "IMPORTS" | "CALLS" | "DEPENDS_ON" | "TASK_LINKED_TO";
  source_node_key: string; target_node_key: string; evidence: Record<string, unknown>;
};

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const BATCH = 400;
const GRAPH_FILES = [
  "registry/architecture-book.json",
  "registry/module-registry.json",
  "registry/TASK_QUEUE.json",
];

function readJson<T>(rel: string): T {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) throw new Error(`Required index source missing: ${rel}`);
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

function assertCanonicalProject(url: string, expectedUrl: string): string {
  const parsed = new URL(url);
  const hostRef = parsed.hostname.split(".")[0];
  const expected = expectedUrl ? new URL(expectedUrl) : null;
  if (
    parsed.protocol !== "https:" ||
    !expected ||
    expected.protocol !== "https:" ||
    parsed.origin !== expected.origin
  ) {
    throw new Error("Supabase URL must match DNAOS_CANONICAL_SUPABASE_URL; refusing to write");
  }
  return hostRef;
}

function packageBatches<T>(items: T[], size = BATCH): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function modulePath(id: string): string | null {
  return id.startsWith("module:") ? id.slice("module:".length).replace(/\\/g, "/") : null;
}

function functionKey(sourcePath: string, symbol: ArchSymbol): string {
  return `function:${sourcePath}#${symbol.name}@${symbol.line_start}`;
}

function collectTaskSourcePaths(value: unknown, known: Set<string>): string[] {
  const text: string[] = [];
  const visit = (v: unknown) => {
    if (typeof v === "string") text.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  const matches = new Set<string>();
  for (const raw of text) {
    const normalized = normalize(raw).replace(/\\/g, "/").replace(/^\.\//, "");
    for (const candidate of known) {
      if (normalized === candidate || normalized.includes(`/${candidate}`) || normalized.startsWith(`${candidate}#`)) matches.add(candidate);
    }
  }
  return [...matches].sort();
}

function buildGraph(runId: string) {
  const arch = readJson<{ generated_at: string; version: number; nodes: ArchNode[]; edges: ArchEdge[] }>(GRAPH_FILES[0]);
  const moduleRegistry = readJson<{ modules: Record<string, { layer?: string; owner?: string; purpose?: string; status?: string }> }>(GRAPH_FILES[1]);
  const rawTasks = readJson<Record<string, TaskRecord>>(GRAPH_FILES[2]);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeKeys = new Set<string>();
  const edgeKeys = new Set<string>();
  const addNode = (node: Omit<GraphNode, "index_run_id">) => {
    if (nodeKeys.has(node.node_key)) return;
    nodeKeys.add(node.node_key);
    nodes.push({ ...node, index_run_id: runId });
  };
  const addEdge = (edge: Omit<GraphEdge, "index_run_id">) => {
    if (edge.source_node_key === edge.target_node_key && edge.edge_type !== "CALLS") return;
    const key = `${edge.edge_type}|${edge.source_node_key}|${edge.target_node_key}`;
    if (edgeKeys.has(key)) return;
    if (!nodeKeys.has(edge.source_node_key) || !nodeKeys.has(edge.target_node_key)) return;
    edgeKeys.add(key);
    edges.push({ ...edge, index_run_id: runId });
  };

  const moduleNodes = arch.nodes.filter((node) => node.type === "Module");
  const sourcePaths = new Set<string>();
  const functionsByFile = new Map<string, ArchSymbol[]>();
  const functionKeysByFileAndName = new Map<string, string[]>();
  const layers = new Set<string>();

  for (const node of moduleNodes) {
    const sourcePath = modulePath(node.id);
    if (!sourcePath) continue;
    sourcePaths.add(sourcePath);
    const layer = node.layer || "unknown";
    layers.add(layer);
    addNode({
      node_key: `file:${sourcePath}`, node_type: "File", name: node.name_en || sourcePath,
      source_path: sourcePath, signature: null,
      metadata: {
        layer, source_status: node.status || "UNKNOWN", runtime_entry_point: node.runtime_entry_point ?? null,
        exports: node.exports || [], data_tables: node.data_tables ?? "UNKNOWN",
      },
    });
    const symbols = (node.symbols || []).filter((symbol) => symbol.kind === "function");
    functionsByFile.set(sourcePath, symbols);
    for (const symbol of symbols) {
      const key = functionKey(sourcePath, symbol);
      addNode({
        node_key: key, node_type: "Function", name: symbol.name, source_path: sourcePath,
        signature: null,
        metadata: { line_start: symbol.line_start, line_end: symbol.line_end, symbol_kind: symbol.kind },
      });
      const mapKey = `${sourcePath}#${symbol.name}`;
      functionKeysByFileAndName.set(mapKey, [...(functionKeysByFileAndName.get(mapKey) || []), key]);
    }
  }

  for (const layer of layers) {
    const registryMembers = Object.entries(moduleRegistry.modules).filter(([, entry]) => entry.layer === layer);
    addNode({
      node_key: `module:${layer}`, node_type: "Module", name: layer, source_path: null, signature: null,
      metadata: { layer, registry_file_count: registryMembers.length },
    });
  }

  const fileLayer = new Map<string, string>();
  for (const node of moduleNodes) {
    const sourcePath = modulePath(node.id);
    if (sourcePath && node.layer) fileLayer.set(sourcePath, node.layer);
  }
  for (const edge of arch.edges) {
    if (edge.label !== "imports") continue;
    const source = modulePath(edge.source), target = modulePath(edge.target);
    if (!source || !target || !sourcePaths.has(source) || !sourcePaths.has(target)) continue;
    addEdge({ edge_type: "IMPORTS", source_node_key: `file:${source}`, target_node_key: `file:${target}`, evidence: { source: "architecture-book.json", relation: "static import" } });
    const a = fileLayer.get(source), b = fileLayer.get(target);
    if (a && b && a !== b) addEdge({ edge_type: "DEPENDS_ON", source_node_key: `module:${a}`, target_node_key: `module:${b}`, evidence: { source: "architecture-book.json", aggregation: "cross-layer file imports" } });
  }

  // CALLS edges are emitted only when a real TypeScript AST call resolves to
  // exactly one function symbol in the same file or an explicitly named import.
  for (const [sourcePath, symbols] of functionsByFile) {
    const absolute = resolve(ROOT, sourcePath);
    if (!existsSync(absolute)) continue;
    const text = readFileSync(absolute, "utf8");
    const kind = sourcePath.endsWith(".tsx") ? ts.ScriptKind.TSX : sourcePath.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true, kind);
    const sites = moduleNodes.find((n) => modulePath(n.id) === sourcePath)?.import_sites || [];
    const importTargets = new Map<string, { file: string; exported: string | "*" }>();
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      const resolved = sites.find((site) => site.specifier === specifier)?.resolved_target?.replace(/\\/g, "/");
      if (!resolved || !sourcePaths.has(resolved) || !statement.importClause) continue;
      const clause = statement.importClause;
      if (clause.name) importTargets.set(clause.name.text, { file: resolved, exported: "default" });
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) importTargets.set(clause.namedBindings.name.text, { file: resolved, exported: "*" });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) importTargets.set(element.name.text, { file: resolved, exported: (element.propertyName || element.name).text });
      }
    }
    const resolveTarget = (expr: ts.Expression): string | null => {
      if (ts.isIdentifier(expr)) {
        const local = functionKeysByFileAndName.get(`${sourcePath}#${expr.text}`) || [];
        if (local.length === 1) return local[0];
        const imp = importTargets.get(expr.text);
        if (imp && imp.exported !== "*") {
          const imported = functionKeysByFileAndName.get(`${imp.file}#${imp.exported}`) || [];
          if (imported.length === 1) return imported[0];
        }
      }
      if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
        const imp = importTargets.get(expr.expression.text);
        if (imp?.exported === "*") {
          const imported = functionKeysByFileAndName.get(`${imp.file}#${expr.name.text}`) || [];
          if (imported.length === 1) return imported[0];
        }
      }
      return null;
    };
    const containingSymbol = (line: number): ArchSymbol | undefined => symbols
      .filter((symbol) => symbol.line_start <= line && symbol.line_end >= line)
      .sort((a, b) => (a.line_end - a.line_start) - (b.line_end - b.line_start))[0];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const caller = containingSymbol(line);
        const target = resolveTarget(node.expression);
        if (caller && target) {
          addEdge({ edge_type: "CALLS", source_node_key: functionKey(sourcePath, caller), target_node_key: target,
            evidence: { source: "TypeScript AST", path: sourcePath, line, resolution: "unique local or named import", completeness: "static subset" } });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const tasks = Object.values(rawTasks).filter((task): task is TaskRecord => !!task && typeof task === "object" && typeof task.id === "string");
  for (const task of tasks) {
    const key = `task:${task.id}`;
    addNode({
      node_key: key, node_type: "Task", name: task.title || task.id!, source_path: null, signature: null,
      metadata: { status: task.status || "UNKNOWN", priority: task.priority || "UNKNOWN", gate: task.gate || null },
    });
    const linkedPaths = collectTaskSourcePaths([task.context_sources, task.owner_request_ref, task.gate], sourcePaths);
    for (const sourcePath of linkedPaths) addEdge({ edge_type: "TASK_LINKED_TO", source_node_key: key, target_node_key: `file:${sourcePath}`, evidence: { source: "registry/TASK_QUEUE.json", matched: "exact registered source path" } });
  }

  const digest = createHash("sha256");
  const hashFiles = [...new Set([...GRAPH_FILES, ...sourcePaths])].sort();
  for (const file of hashFiles) {
    digest.update(file);
    digest.update("\0");
    const absolute = resolve(ROOT, file);
    if (existsSync(absolute)) digest.update(readFileSync(absolute));
    else digest.update("MISSING");
    digest.update("\0");
  }
  return { nodes, edges, sourceRevision: digest.digest("hex") };
}

async function insertBatches(client: SupabaseClient<any, any, "system", any, any>, table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (const batch of packageBatches(rows)) {
    const { error } = await client.from(table).insert(batch);
    if (error) throw new Error(`System graph write failed (${table}): ${error.code || "DB_ERROR"}`);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const expectedProjectUrl = process.env.DNAOS_CANONICAL_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  let projectRef = url ? assertCanonicalProject(url, expectedProjectUrl) : "";
  if (apply) {
    if (!url || !serviceRoleKey) throw new Error("Apply requires SUPABASE_URL and server-side SUPABASE_SERVICE_ROLE_KEY");
  }
  const runId = randomUUID();
  const graph = buildGraph(runId);
  const stats = {
    nodes: graph.nodes.length, edges: graph.edges.length,
    node_types: graph.nodes.reduce<Record<string, number>>((acc, node) => ((acc[node.node_type] = (acc[node.node_type] || 0) + 1), acc), {}),
    edge_types: graph.edges.reduce<Record<string, number>>((acc, edge) => ((acc[edge.edge_type] = (acc[edge.edge_type] || 0) + 1), acc), { IMPORTS: 0, CALLS: 0, DEPENDS_ON: 0, TASK_LINKED_TO: 0 }),
  };
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ mode: "dry-run", canonical_project_ref: projectRef || null, run_id: runId, source_revision: graph.sourceRevision, ...stats }, null, 2)}\n`);
    return;
  }

  const client = createClient(url, serviceRoleKey, {
    db: { schema: "system" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: runError } = await client.from("system_graph_index_runs").insert({ id: runId, source_revision: graph.sourceRevision, status: "indexing" });
  if (runError) throw new Error(`Could not begin system graph index run (${runError.code || "DB_ERROR"})`);
  try {
    await insertBatches(client, "system_graph_nodes", graph.nodes as unknown as Record<string, unknown>[]);
    await insertBatches(client, "system_graph_edges", graph.edges as unknown as Record<string, unknown>[]);
    const { error } = await client.from("system_graph_index_runs").update({ status: "succeeded", finished_at: new Date().toISOString(), node_count: stats.nodes, edge_count: stats.edges }).eq("id", runId);
    if (error) throw new Error(`Could not finalize system graph index run (${error.code || "DB_ERROR"})`);
  } catch (error) {
    await client.from("system_graph_index_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_code: "INDEX_WRITE_FAILED" }).eq("id", runId);
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ mode: "applied", system_project_ref: projectRef, run_id: runId, source_revision: graph.sourceRevision, ...stats }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`[system-graph-index] ${error instanceof Error ? error.message : "Unexpected failure"}\n`);
  process.exitCode = 1;
});
