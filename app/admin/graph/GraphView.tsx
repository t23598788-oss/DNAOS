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

// ── Page ───────────────────────────────────────────
// Owner directive (2026-07-31): Layer Flow and Module Deps views removed —
// both were redundant with this 3D graph (same /api/governance data, same
// click-for-details sidebar). This page now shows only the 3D force graph,
// no view switcher.

// Real-Time Signal Pulse (owner, 2026-07-26 — "REVERT AND RESTORE: USE
// ORIGINAL ARCHITECTURE GRAPH"): reused directly by app/admin/telemetry
// (named export below) instead of building a second graph implementation —
// same real 539 nodes / real edges / click-for-details sidebar, just handed
// a live set of currently-active node ids + edge keys to light up.
interface GraphPageProps {
  pulseNodeIds?: Set<string>;
  pulseLinkKeys?: Set<string>;
  // app/admin/system/page.tsx already passes these (embedded mode inside the
  // unified Build/Graph/Telemetry screen) — type widened to match real
  // callers (owner, 2026-08-05: was a real type-check failure blocking
  // deploy). Not wired into behavior here yet — that's a separate, real
  // design decision for embedded mode the owner hasn't made yet.
  embedded?: boolean;
  showHeader?: boolean;
  focusNodeId?: string | null;
}

export default function GraphPage({ pulseNodeIds, pulseLinkKeys }: GraphPageProps = {}) {
  const router = useRouter();
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
      </div>

      {/* ── Content ── */}
      <div className="flex-1 p-0 overflow-hidden">
        {loading && (
          <div className="text-stone-400 text-sm text-center py-12">กำลังโหลดแผนที่…</div>
        )}
        {!loading && !data && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 m-6">
            ไม่สามารถโหลดข้อมูลได้ — กรุณารัน npm run sync ก่อน
          </div>
        )}

        {/* ── 3D Force Graph ── */}
        {data && (
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
