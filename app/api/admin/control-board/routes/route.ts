import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getSystemGraphClient } from "@/services/system-graph/systemGraphClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailable(code: string, status = 503) {
  return NextResponse.json({ ok: false, code }, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function GET() {
  const actor = await requireAuth(ADMIN_TIER);
  if (actor instanceof NextResponse) return actor;

  const system = getSystemGraphClient();
  if (!system.ok) return unavailable(system.code);

  const { data: map, error: mapError } = await system.client
    .from("system_engine_route_maps")
    .select("id,map_version,source_revision,status,created_at,node_count,edge_count")
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (mapError) return unavailable("ROUTE_MAP_SCHEMA_NOT_READY");
  if (!map) return unavailable("ROUTE_MAP_NOT_SEEDED");

  const [nodes, edges] = await Promise.all([
    system.client.from("system_engine_route_nodes")
      .select("node_key,node_type,name,status,status_detail,source_path,source_line_start,source_line_end,metadata")
      .eq("map_id", map.id)
      .order("node_type", { ascending: true }),
    system.client.from("system_engine_route_edges")
      .select("edge_key,source_node_key,target_node_key,edge_type,status,label,source_path,source_line_start,source_line_end,evidence")
      .eq("map_id", map.id)
      .order("edge_key", { ascending: true }),
  ]);

  if (nodes.error || edges.error) return unavailable("ROUTE_MAP_QUERY_FAILED");

  return NextResponse.json({
    ok: true,
    route_map: {
      map,
      nodes: nodes.data ?? [],
      edges: edges.data ?? [],
      status_basis: "source map only; green requires an explicit production_verified record",
    },
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
