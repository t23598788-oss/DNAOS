/**
 * GET /api/v1/mcp/architecture/summary
 *
 * Read-scoped summary from the dedicated System Metadata database.
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

  const body = mcpEnvelope({
    system: "DNA OS System Metadata",
    project_ref: system.projectRef,
    index_run: run,
    graph_schema: { node_types: ["File", "Function", "Module", "Task"], edge_types: ["IMPORTS", "CALLS", "DEPENDS_ON", "TASK_LINKED_TO"] },
    limitations: ["CALLS contains only statically resolved local/named-import references; dynamic calls are intentionally omitted."],
  }, {
    source_files: ["registry/architecture-book.json", "registry/module-registry.json", "registry/TASK_QUEUE.json"],
    registry_version: { system_graph_schema: 1 },
    confidence: "high",
  });
  return NextResponse.json(body, { headers: corsHeaders });
}
