"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { FGData, FGNode } from "./ForceGraph3DView";

// ── Types ──────────────────────────────────────────

type NodeStatus = "OK" | "BROKEN" | "UNUSED" | "UNREGISTERED";

interface ArchNode {
  id: string;
  type: string;
  layer: string;
  name_en: string;
  purpose_th: string;
  status: NodeStatus;
  error_th?: string;
}

interface ArchEdge {
  source: string;
  target: string;
  label: string;
}

interface GovernanceData {
  nodes: ArchNode[];
  edges: ArchEdge[];
  summary: { total: number; ok: number; broken: number; unused: number };
}

interface NodeDeps {
  node: ArchNode;
  imports: ArchNode[];
  importedBy: ArchNode[];
  impact: ArchNode[];
}

// ── Constants ──────────────────────────────────────

const STATUS_COLOR: Record<NodeStatus, string> = {
  OK:           "#16a34a",
  BROKEN:       "#dc2626",
  UNUSED:       "#ca8a04",
  UNREGISTERED: "#94a3b8",
};

const LAYER_ORDER = [
  "shared", "middleware", "supabase",
  "v2-rules", "v3-engines", "v4-ai", "v5-presenter", "v6-executor",
  "documents", "commands", "cognitive", "runtime", "agent",
  "browser", "drivers", "macos", "platform",
  "registry", "app", "components", "scripts",
];

// ── Dynamic import of 3D component (browser-only WebGL) ───────────────────────

const ForceGraph3DView = dynamic(
  () => import("./ForceGraph3DView"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[600px] bg-[#050510]">
        <div className="text-center">
          <div className="text-2xl mb-3 animate-spin">⚙</div>
          <p className="text-sm text-slate-400">กำลังโหลด WebGL engine…</p>
        </div>
      </div>
    ),
  }
);

// ── Layer Flow View ────────────────────────────────

function LayerFlowView({ nodes }: { nodes: ArchNode[] }) {
  const router = useRouter();

  const layerMap = useMemo(() => {
    const m: Record<string, { ok: number; broken: number; unused: number; total: number }> = {};
    for (const n of nodes) {
      if (n.type !== "Module") continue;
      const l = n.layer || "unknown";
      if (!m[l]) m[l] = { ok: 0, broken: 0, unused: 0, total: 0 };
      m[l].total++;
      if (n.status === "OK") m[l].ok++;
      else if (n.status === "BROKEN") m[l].broken++;
      else if (n.status === "UNUSED") m[l].unused++;
    }
    return m;
  }, [nodes]);

  const orderedLayers = LAYER_ORDER.filter((l) => layerMap[l]);
  const unknown = Object.keys(layerMap).filter((l) => !LAYER_ORDER.includes(l));
  const allLayers = [...orderedLayers, ...unknown];

  const COLS = 4;
  const BOX_W = 160;
  const BOX_H = 72;
  const GAP_X = 40;
  const GAP_Y = 32;
  const rows = Math.ceil(allLayers.length / COLS);
  const SVG_W = COLS * BOX_W + (COLS - 1) * GAP_X + 40;
  const SVG_H = rows * BOX_H + (rows - 1) * GAP_Y + 40;

  function boxPos(i: number) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return {
      x: 20 + col * (BOX_W + GAP_X),
      y: 20 + row * (BOX_H + GAP_Y),
    };
  }

  return (
    <div className="overflow-auto">
      <p className="text-[11px] text-stone-400 mb-3">คลิก layer เพื่อกรองใน Dashboard</p>
      <svg width={SVG_W} height={SVG_H} className="block">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
          </marker>
        </defs>
        {allLayers.map((layer, i) => {
          const { x, y } = boxPos(i);
          const stats = layerMap[layer];
          const hasError = stats.broken + stats.unused > 0;
          const fillColor = hasError ? "#fef2f2" : "#f0fdf4";
          const borderColor = hasError ? "#fca5a5" : "#86efac";
          const healthPct = stats.total > 0 ? Math.round((stats.ok / stats.total) * 100) : 100;
          const nextSameColPos = allLayers[i + COLS] ? boxPos(i + COLS) : null;

          return (
            <g
              key={layer}
              style={{ cursor: "pointer" }}
              onClick={() => router.push(`/admin/architecture`)}
            >
              {nextSameColPos && (
                <line
                  x1={x + BOX_W / 2} y1={y + BOX_H}
                  x2={x + BOX_W / 2} y2={nextSameColPos.y}
                  stroke="#d1d5db" strokeWidth={1.5} strokeDasharray="4,3"
                  markerEnd="url(#arrow)"
                />
              )}
              <rect x={x} y={y} width={BOX_W} height={BOX_H} rx={10}
                fill={fillColor} stroke={borderColor} strokeWidth={1.5} />
              <text x={x + 12} y={y + 22} fontSize={12} fontWeight="600" fill="#374151">
                {layer}
              </text>
              <text x={x + 12} y={y + 38} fontSize={10} fill="#6b7280">
                {stats.total} modules · {healthPct}% OK
              </text>
              {hasError && (
                <text x={x + 12} y={y + 54} fontSize={10} fill="#dc2626">
                  {stats.broken > 0 ? `${stats.broken} เสียหาย ` : ""}
                  {stats.unused > 0 ? `${stats.unused} ไม่ได้ใช้` : ""}
                </text>
              )}
              <rect x={x + 12} y={y + 58} width={BOX_W - 24} height={4} rx={2} fill="#e5e7eb" />
              <rect x={x + 12} y={y + 58}
                width={Math.round((BOX_W - 24) * (healthPct / 100))} height={4} rx={2}
                fill={healthPct >= 70 ? "#16a34a" : healthPct >= 40 ? "#ca8a04" : "#dc2626"} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Module Dependency View ─────────────────────────

function ModuleDepsView({ nodes, edges }: { nodes: ArchNode[]; edges: ArchEdge[] }) {
  const router = useRouter();
  const [selectedLayer, setSelectedLayer] = useState<string>("v3-engines");
  const [selectedNode, setSelectedNode] = useState<ArchNode | null>(null);
  const [nodeDeps, setNodeDeps] = useState<NodeDeps | null>(null);
  const [loadingDeps, setLoadingDeps] = useState(false);

  const layers = useMemo(() => {
    const s = new Set<string>();
    for (const n of nodes) if (n.type === "Module") s.add(n.layer);
    return Array.from(s).sort();
  }, [nodes]);

  const layerNodes = useMemo(
    () => nodes.filter((n) => n.type === "Module" && n.layer === selectedLayer),
    [nodes, selectedLayer]
  );

  const layerNodeIds = new Set(layerNodes.map((n) => n.id));
  const relEdges = edges.filter(
    (e) => e.label === "imports" && (layerNodeIds.has(e.source) || layerNodeIds.has(e.target))
  );

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const BOX_W = 200;
  const BOX_H = 44;
  const GAP = 10;
  const CENTER_X = 320;
  const LEFT_X = 40;
  const RIGHT_X = 600;

  const centerY = (i: number, total: number) => {
    const totalH = total * (BOX_H + GAP) - GAP;
    return 30 + i * (BOX_H + GAP) + Math.max(0, (400 - totalH) / 2);
  };

  const importerIds = new Set(relEdges.filter((e) => layerNodeIds.has(e.target)).map((e) => e.source));
  const importedIds = new Set(relEdges.filter((e) => layerNodeIds.has(e.source)).map((e) => e.target));
  const importers = [...importerIds].map((id) => nodeById.get(id)).filter(Boolean) as ArchNode[];
  const imported = [...importedIds].map((id) => nodeById.get(id)).filter(Boolean) as ArchNode[];

  const SVG_H = Math.max(
    layerNodes.length * (BOX_H + GAP) + 60,
    importers.length * (BOX_H + GAP) + 60,
    imported.length * (BOX_H + GAP) + 60
  );

  const loadDeps = useCallback(async (node: ArchNode) => {
    setSelectedNode(node);
    setLoadingDeps(true);
    setNodeDeps(null);
    const res = await fetch(`/api/governance?node=${encodeURIComponent(node.id)}`);
    setNodeDeps(await res.json());
    setLoadingDeps(false);
  }, []);

  function nodeBox(n: ArchNode, x: number, y: number) {
    const color = STATUS_COLOR[n.status] ?? "#94a3b8";
    const shortName = n.name_en.split("/").slice(-1)[0];
    const isSelected = selectedNode?.id === n.id;
    return (
      <g
        key={n.id}
        style={{ cursor: "pointer" }}
        onClick={() => loadDeps(n)}
      >
        <rect x={x} y={y} width={BOX_W} height={BOX_H} rx={8}
          fill={isSelected ? "#ede9fe" : "white"}
          stroke={isSelected ? "#7c3aed" : color}
          strokeWidth={isSelected ? 2 : 1.5} />
        <text x={x + 8} y={y + 16} fontSize={10} fontWeight="600" fill="#374151">
          {shortName.length > 22 ? shortName.slice(0, 22) + "…" : shortName}
        </text>
        <text x={x + 8} y={y + 30} fontSize={9} fill={color}>{n.status}</text>
        <text x={x + 8} y={y + 42} fontSize={9} fill="#9ca3af">{n.layer}</text>
      </g>
    );
  }

  return (
    <div className="flex gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-2 mb-4">
          {layers.map((l) => (
            <button
              key={l}
              onClick={() => { setSelectedLayer(l); setSelectedNode(null); setNodeDeps(null); }}
              className={`px-2.5 py-1 text-[11px] rounded-lg transition ${
                selectedLayer === l
                  ? "bg-violet-600 text-white"
                  : "bg-white border border-stone-200 text-stone-600 hover:border-violet-400"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="overflow-auto">
          <svg width={860} height={Math.max(SVG_H, 280)} className="block">
            <defs>
              <marker id="arr2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#6366f1" />
              </marker>
            </defs>

            <text x={LEFT_X + BOX_W / 2} y={16} textAnchor="middle" fontSize={10} fill="#9ca3af">
              import เข้ามา
            </text>
            <text x={CENTER_X + BOX_W / 2} y={16} textAnchor="middle" fontSize={11} fontWeight="700" fill="#6366f1">
              {selectedLayer}
            </text>
            <text x={RIGHT_X + BOX_W / 2} y={16} textAnchor="middle" fontSize={10} fill="#9ca3af">
              ถูก import ไป
            </text>

            {layerNodes.slice(0, 12).map((n, i) => {
              const y = centerY(i, Math.min(layerNodes.length, 12));
              return nodeBox(n, CENTER_X, y);
            })}

            {importers.slice(0, 10).map((n, i) => {
              const y = centerY(i, Math.min(importers.length, 10));
              const targetNode = layerNodes.find((ln) =>
                relEdges.some((e) => e.source === n.id && e.target === ln.id)
              );
              const targetY = targetNode
                ? centerY(layerNodes.indexOf(targetNode), Math.min(layerNodes.length, 12))
                : centerY(0, 1);
              return (
                <g key={n.id}>
                  {nodeBox(n, LEFT_X, y)}
                  <line
                    x1={LEFT_X + BOX_W} y1={y + BOX_H / 2}
                    x2={CENTER_X} y2={targetY + BOX_H / 2}
                    stroke="#6366f1" strokeWidth={1} opacity={0.5}
                    markerEnd="url(#arr2)"
                  />
                </g>
              );
            })}

            {imported.slice(0, 10).map((n, i) => {
              const y = centerY(i, Math.min(imported.length, 10));
              const sourceNode = layerNodes.find((ln) =>
                relEdges.some((e) => e.source === ln.id && e.target === n.id)
              );
              const sourceY = sourceNode
                ? centerY(layerNodes.indexOf(sourceNode), Math.min(layerNodes.length, 12))
                : centerY(0, 1);
              return (
                <g key={n.id}>
                  {nodeBox(n, RIGHT_X, y)}
                  <line
                    x1={CENTER_X + BOX_W} y1={sourceY + BOX_H / 2}
                    x2={RIGHT_X} y2={y + BOX_H / 2}
                    stroke="#6366f1" strokeWidth={1} opacity={0.5}
                    markerEnd="url(#arr2)"
                  />
                </g>
              );
            })}

            {layerNodes.length === 0 && (
              <text x={CENTER_X + BOX_W / 2} y={120} textAnchor="middle" fontSize={12} fill="#9ca3af">
                ไม่พบ module ใน layer นี้
              </text>
            )}
          </svg>
        </div>

        {layerNodes.length > 12 && (
          <p className="text-[11px] text-stone-400 mt-2">
            แสดง 12 จาก {layerNodes.length} modules ใน {selectedLayer}
          </p>
        )}
      </div>

      {/* ── Node detail sidebar ── */}
      {selectedNode && (
        <div className="w-72 shrink-0 bg-stone-50 border border-stone-200 rounded-xl p-4 space-y-3 self-start">
          <div>
            <div className="text-[10px] text-stone-400 uppercase tracking-wider mb-1">Module</div>
            <div className="text-xs font-mono font-semibold text-stone-700 break-all">
              {selectedNode.name_en}
            </div>
            <div
              className="text-[10px] mt-1 font-medium"
              style={{ color: STATUS_COLOR[selectedNode.status] }}
            >
              {selectedNode.status}
            </div>
            {selectedNode.error_th && (
              <p className="text-[11px] text-red-600 mt-1">⚠ {selectedNode.error_th}</p>
            )}
          </div>

          {loadingDeps && (
            <div className="text-[11px] text-stone-400">กำลังโหลด dependencies…</div>
          )}

          {nodeDeps && (
            <>
              <div>
                <div className="text-[10px] text-stone-400 uppercase tracking-wider mb-1">
                  import จาก ({nodeDeps.imports.length})
                </div>
                {nodeDeps.imports.length > 0 ? (
                  <div className="space-y-0.5">
                    {nodeDeps.imports.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => router.push(`/admin/reader?path=${encodeURIComponent(n.name_en)}`)}
                        className="w-full text-left text-[10px] font-mono text-stone-600 hover:text-violet-700 truncate block"
                      >
                        {n.name_en.split("/").slice(-1)[0]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-[11px] text-stone-400">ไม่มี</span>
                )}
              </div>

              <div>
                <div className="text-[10px] text-stone-400 uppercase tracking-wider mb-1">
                  ถูก import โดย ({nodeDeps.importedBy.length})
                </div>
                {nodeDeps.importedBy.length > 0 ? (
                  <div className="space-y-0.5">
                    {nodeDeps.importedBy.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => router.push(`/admin/reader?path=${encodeURIComponent(n.name_en)}`)}
                        className="w-full text-left text-[10px] font-mono text-stone-600 hover:text-violet-700 truncate block"
                      >
                        {n.name_en.split("/").slice(-1)[0]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-[11px] text-stone-400">ไม่มี</span>
                )}
              </div>

              {nodeDeps.impact.length > 0 && (
                <div>
                  <div className="text-[10px] text-red-500 uppercase tracking-wider mb-1">
                    ผลกระทบ ({nodeDeps.impact.length})
                  </div>
                  <div className="space-y-0.5">
                    {nodeDeps.impact.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => router.push(`/admin/reader?path=${encodeURIComponent(n.name_en)}`)}
                        className="w-full text-left text-[10px] font-mono text-red-600 hover:text-red-800 truncate block"
                      >
                        {n.name_en.split("/").slice(-1)[0]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <button
            onClick={() => router.push(`/admin/reader?path=${encodeURIComponent(selectedNode.name_en)}`)}
            className="w-full text-xs bg-violet-600 text-white rounded-lg py-1.5 hover:bg-violet-700 transition"
          >
            เปิดใน Reader →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────

type View = "3d-force" | "layer-flow" | "module-deps";

const VIEW_LABELS: Record<View, string> = {
  "3d-force":    "3D Force",
  "layer-flow":  "Layer Flow",
  "module-deps": "Module Deps",
};

// Real-Time Signal Pulse (owner, 2026-07-26 — "REVERT AND RESTORE: USE
// ORIGINAL ARCHITECTURE GRAPH"): reused directly by app/admin/telemetry
// (named export below) instead of building a second graph implementation —
// same real 539 nodes / real edges / click-for-details sidebar, just handed
// a live set of currently-active node ids + edge keys to light up.
interface GraphPageProps {
  pulseNodeIds?: Set<string>;
  pulseLinkKeys?: Set<string>;
}

export default function GraphPage({ pulseNodeIds, pulseLinkKeys }: GraphPageProps = {}) {
  const router = useRouter();
  const [view, setView] = useState<View>("3d-force");
  const [data, setData] = useState<GovernanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode3D, setSelectedNode3D] = useState<FGNode | null>(null);
  const [nodeDeps3D, setNodeDeps3D] = useState<NodeDeps | null>(null);
  const [loadingDeps3D, setLoadingDeps3D] = useState(false);

  useEffect(() => {
    fetch("/api/governance")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  // Build graph data for 3D view
  const fgData = useMemo<FGData>(() => {
    if (!data) return { nodes: [], links: [] };
    const nodes: FGNode[] = data.nodes
      .filter((n) => n.type === "Module")
      .map((n) => ({
        id: n.id,
        name_en: n.name_en,
        layer: n.layer,
        status: n.status as any,
        purpose_th: n.purpose_th,
        error_th: n.error_th,
      }));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = data.edges
      .filter((e) => e.label === "imports" && nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, label: e.label }));
    return { nodes, links };
  }, [data]);

  // Click on 3D node → fetch deps
  const handle3DNodeClick = useCallback(async (node: FGNode) => {
    setSelectedNode3D(node);
    setLoadingDeps3D(true);
    setNodeDeps3D(null);
    const res = await fetch(`/api/governance?node=${encodeURIComponent(node.id)}`);
    setNodeDeps3D(await res.json());
    setLoadingDeps3D(false);
  }, []);

  const STATUS_COLOR_3D: Record<string, string> = {
    OK: "#16a34a", BROKEN: "#dc2626", UNUSED: "#ca8a04", UNREGISTERED: "#94a3b8",
  };

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* ── Header ── */}
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-stone-800">Architecture Graph</h1>
          <p className="text-[11px] text-stone-400">
            {data
              ? `${data.summary.total} modules · ${data.summary.ok} OK · ${data.summary.broken} เสียหาย`
              : "architecture-book.json"}
          </p>
        </div>
        <div className="flex gap-1.5">
          {(["3d-force", "layer-flow", "module-deps"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs rounded-lg transition ${
                view === v
                  ? "bg-violet-600 text-white"
                  : "bg-white border border-stone-200 text-stone-600 hover:border-violet-400"
              }`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className={`flex-1 ${view === "3d-force" ? "p-0 overflow-hidden" : "p-6"}`}>
        {loading && (
          <div className="text-stone-400 text-sm text-center py-12">กำลังโหลดแผนที่…</div>
        )}
        {!loading && !data && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 m-6">
            ไม่สามารถโหลดข้อมูลได้ — กรุณารัน npm run sync ก่อน
          </div>
        )}

        {data && view !== "3d-force" && (
          <>
            <div className="flex items-center gap-4 mb-4">
              {Object.entries(STATUS_COLOR).map(([status, color]) => (
                <div key={status} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[11px] text-stone-500">{status}</span>
                </div>
              ))}
              <span className="text-[11px] text-stone-400 ml-auto">
                {data.summary.total} modules · {data.summary.ok} OK
              </span>
            </div>
            <div className="bg-white border border-stone-200 rounded-xl p-4 overflow-auto">
              {view === "layer-flow"  && <LayerFlowView  nodes={data.nodes} />}
              {view === "module-deps" && <ModuleDepsView nodes={data.nodes} edges={data.edges} />}
            </div>
          </>
        )}

        {/* ── 3D Force Graph ── */}
        {data && view === "3d-force" && (
          <div className="flex h-full" style={{ minHeight: "calc(100vh - 65px)" }}>
            {/* Graph canvas */}
            <div className="flex-1 min-w-0">
              <ForceGraph3DView
                graphData={fgData}
                onNodeClick={handle3DNodeClick}
                pulseNodeIds={pulseNodeIds}
                pulseLinkKeys={pulseLinkKeys}
              />
            </div>

            {/* Node detail sidebar */}
            {selectedNode3D && (
              <div className="w-72 shrink-0 bg-[#0a0a1a] border-l border-[#1e2535] p-4 space-y-3 overflow-y-auto">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-xs font-mono font-semibold break-all leading-snug"
                      style={{ color: STATUS_COLOR_3D[selectedNode3D.status] ?? "#94a3b8" }}
                    >
                      {selectedNode3D.name_en.split("/").slice(-1)[0]}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 font-mono truncate">
                      {selectedNode3D.name_en}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{
                          background: (STATUS_COLOR_3D[selectedNode3D.status] ?? "#94a3b8") + "22",
                          color: STATUS_COLOR_3D[selectedNode3D.status] ?? "#94a3b8",
                        }}
                      >
                        {selectedNode3D.status}
                      </span>
                      <span className="text-[10px] text-slate-500">{selectedNode3D.layer}</span>
                    </div>
                    {selectedNode3D.error_th && (
                      <p className="text-[10px] text-red-400 mt-1.5">⚠ {selectedNode3D.error_th}</p>
                    )}
                    {selectedNode3D.purpose_th && (
                      <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                        {selectedNode3D.purpose_th}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedNode3D(null)}
                    className="text-slate-600 hover:text-slate-300 ml-2 shrink-0"
                  >
                    ×
                  </button>
                </div>

                <div className="border-t border-[#1e2535]" />

                {loadingDeps3D && (
                  <div className="text-[11px] text-slate-500">กำลังโหลด dependencies…</div>
                )}

                {nodeDeps3D && (
                  <>
                    <DepList
                      label={`import จาก (${nodeDeps3D.imports.length})`}
                      nodes={nodeDeps3D.imports}
                      onClick={(n) => router.push(`/admin/reader?path=${encodeURIComponent(n.name_en)}`)}
                    />
                    <DepList
                      label={`ถูก import โดย (${nodeDeps3D.importedBy.length})`}
                      nodes={nodeDeps3D.importedBy}
                      onClick={(n) => router.push(`/admin/reader?path=${encodeURIComponent(n.name_en)}`)}
                    />
                    {nodeDeps3D.impact.length > 0 && (
                      <DepList
                        label={`ผลกระทบ (${nodeDeps3D.impact.length})`}
                        nodes={nodeDeps3D.impact}
                        onClick={(n) => router.push(`/admin/reader?path=${encodeURIComponent(n.name_en)}`)}
                        danger
                      />
                    )}
                  </>
                )}

                <button
                  onClick={() => router.push(`/admin/reader?path=${encodeURIComponent(selectedNode3D.name_en)}`)}
                  className="w-full text-xs bg-violet-700 text-white rounded-lg py-1.5 hover:bg-violet-600 transition"
                >
                  เปิดใน Reader →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DepList({
  label, nodes, onClick, danger = false,
}: {
  label: string;
  nodes: ArchNode[];
  onClick: (n: ArchNode) => void;
  danger?: boolean;
}) {
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-wider mb-1 ${danger ? "text-red-500" : "text-slate-500"}`}>
        {label}
      </div>
      {nodes.length > 0 ? (
        <div className="space-y-0.5 max-h-36 overflow-y-auto">
          {nodes.map((n) => (
            <button
              key={n.id}
              onClick={() => onClick(n)}
              className={`w-full text-left text-[10px] font-mono truncate block py-0.5 hover:underline ${
                danger ? "text-red-400 hover:text-red-300" : "text-slate-400 hover:text-violet-400"
              }`}
            >
              {n.name_en.split("/").slice(-1)[0]}
            </button>
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-slate-600">ไม่มี</span>
      )}
    </div>
  );
}

// Named export so app/admin/telemetry/page.tsx can reuse this exact
// component (real graph, no duplicate implementation) with live pulse data.
export { GraphPage };
