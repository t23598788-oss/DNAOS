/**
 * GET /api/v1/mcp/architecture/dependency-graph
 *
 * Read-scoped API Gateway for the dedicated System Metadata database.
 * Graph rows are never read from the business Supabase project.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/app/api/v1/mcp/governance/_lib/auth";
import { getSystemGraphClient } from "@/services/system-graph/systemGraphClient";
import { mcpEnvelope } from "../../_lib/envelope";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-DNA-Token",
  "Cache-Control": "private, no-store",
  "Vary": "Origin",
};

function withCors(response: NextResponse): NextResponse {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
  return new NextResponse(response.body, { status: response.status, statusText: response.statusText, headers });
}

function intParam(value: string | null, fallback: number, max: number): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), max) : fallback;
}

const nodeTypes = new Set(["File", "Function", "Module", "Task"]);
const edgeTypes = new Set(["IMPORTS", "CALLS", "DEPENDS_ON", "TASK_LINKED_TO"]);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  let auth: Awaited<ReturnType<typeof authenticate>>;
  try {
    auth = await authenticate(req, "read");
  } catch {
    return NextResponse.json({ ok: false, error: "DNA OS read-token service is unavailable" }, { status: 503, headers: corsHeaders });
  }
  if (!auth.ok) return withCors(auth.response);

  const system = getSystemGraphClient();
  if (!system.ok) return NextResponse.json({ ok: false, error: system.code }, { status: 503, headers: corsHeaders });

  const { data: run, error: runError } = await system.client
    .from("system_graph_index_runs")
    .select("id,source_revision,finished_at,node_count,edge_count")
    .eq("status", "succeeded")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) return NextResponse.json({ ok: false, error: "SYSTEM_GRAPH_QUERY_FAILED" }, { status: 503, headers: corsHeaders });
  if (!run) return NextResponse.json({ ok: false, error: "SYSTEM_GRAPH_NOT_INDEXED" }, { status: 503, headers: corsHeaders });

  const params = req.nextUrl.searchParams;
  const nodeType = params.get("node_type");
  const edgeType = params.get("edge_type");
  const query = (params.get("q") || "").trim().slice(0, 120);
  const sourceNode = params.get("source_node_key");
  const targetNode = params.get("target_node_key");
  if (nodeType && !nodeTypes.has(nodeType)) return NextResponse.json({ ok: false, error: "INVALID_NODE_TYPE" }, { status: 400, headers: corsHeaders });
  if (edgeType && !edgeTypes.has(edgeType)) return NextResponse.json({ ok: false, error: "INVALID_EDGE_TYPE" }, { status: 400, headers: corsHeaders });

  const limit = intParam(params.get("limit"), 100, 500);
  const offset = intParam(params.get("offset"), 0, 1000000);
  let nodesQuery = system.client.from("system_graph_nodes")
    .select("node_key,node_type,name,source_path,signature,metadata", { count: "exact" })
    .eq("index_run_id", run.id)
    .order("node_key", { ascending: true })
    .range(offset, offset + limit - 1);
  if (nodeType) nodesQuery = nodesQuery.eq("node_type", nodeType);
  if (query) nodesQuery = nodesQuery.ilike("node_key", `%${query.replace(/[\\%_]/g, "\\$&")}%`);

  let edgesQuery = system.client.from("system_graph_edges")
    .select("edge_type,source_node_key,target_node_key,evidence", { count: "exact" })
    .eq("index_run_id", run.id)
    .order("source_node_key", { ascending: true })
    .range(offset, offset + limit - 1);
  if (edgeType) edgesQuery = edgesQuery.eq("edge_type", edgeType);
  if (sourceNode) edgesQuery = edgesQuery.eq("source_node_key", sourceNode.slice(0, 300));
  if (targetNode) edgesQuery = edgesQuery.eq("target_node_key", targetNode.slice(0, 300));

  const [nodeResult, edgeResult] = await Promise.all([nodesQuery, edgesQuery]);
  if (nodeResult.error || edgeResult.error) return NextResponse.json({ ok: false, error: "SYSTEM_GRAPH_QUERY_FAILED" }, { status: 503, headers: corsHeaders });

  const body = mcpEnvelope({
    index_run: run,
    nodes: nodeResult.data || [],
    edges: edgeResult.data || [],
    pagination: {
      limit, offset,
      nodes_total: nodeResult.count || 0,
      edges_total: edgeResult.count || 0,
      nodes_has_more: offset + limit < (nodeResult.count || 0),
      edges_has_more: offset + limit < (edgeResult.count || 0),
    },
  }, {
    source_files: ["registry/architecture-book.json", "registry/module-registry.json", "registry/TASK_QUEUE.json"],
    registry_version: { system_graph_schema: 1 },
    confidence: "medium",
  });
  return NextResponse.json(body, { headers: corsHeaders });
}
