"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeStatus = "OK" | "BROKEN" | "UNUSED" | "UNREGISTERED";

export interface FGNode {
  id: string;
  name_en: string;
  layer: string;
  status: NodeStatus;
  purpose_th?: string;
  error_th?: string;
  // filled by force-graph at runtime:
  x?: number; y?: number; z?: number;
  vx?: number; vy?: number; vz?: number;
  fx?: number; fy?: number; fz?: number;
  __threeObj?: unknown;
}

export interface FGLink {
  source: string | FGNode;
  target: string | FGNode;
  label?: string;
}

export interface FGData {
  nodes: FGNode[];
  links: FGLink[];
}

// ── Color maps ────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<NodeStatus, string> = {
  OK:           "#22c55e",
  BROKEN:       "#ef4444",
  UNUSED:       "#eab308",
  UNREGISTERED: "#64748b",
};

const LAYER_COLOR: Record<string, string> = {
  "cognitive":    "#7c3aed",
  "v2-rules":     "#0284c7",
  "v3-engines":   "#059669",
  "v4-ai":        "#d97706",
  "v5-presenter": "#db2777",
  "v6-executor":  "#dc2626",
  "runtime":      "#6b7280",
  "supabase":     "#2563eb",
  "shared":       "#94a3b8",
  "documents":    "#ea580c",
  "commands":     "#7c3aed",
  "middleware":   "#0891b2",
  "agent":        "#8b5cf6",
  "scripts":      "#78716c",
  "registry":     "#10b981",
  "app":          "#f59e0b",
  "components":   "#a855f7",
};

function layerColor(layer: string): string {
  return LAYER_COLOR[layer] ?? "#8892a4";
}

// ── Dynamic import (SSR: false required for Three.js) ─────────────────────────

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  graphData: FGData;
  onNodeClick?: (node: FGNode) => void;
  // Real-Time Signal Pulse (owner, 2026-07-26 — "REVERT AND RESTORE": no new
  // globe, reuse this exact graph's real 539 nodes / real edges, just light
  // up what's actually happening on them). `pulseNodeIds` = real modules a
  // live event just touched (glow); `pulseLinkKeys` = real edges (already in
  // graphData.links — never fabricated) between two currently-pulsing nodes,
  // rendered via react-force-graph-3d's own native linkDirectionalParticles
  // (no custom Three.js beam code needed — Rule 101/103 reuse).
  pulseNodeIds?: Set<string>;
  pulseLinkKeys?: Set<string>;
}

function linkKey(source: string, target: string): string {
  return `${source}->${target}`;
}

export default function ForceGraph3DView({ graphData, onNodeClick, pulseNodeIds, pulseLinkKeys }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [dims, setDims] = useState({ w: 900, h: 680 });
  const [hoveredNode, setHoveredNode] = useState<FGNode | null>(null);
  const [activeLayers, setActiveLayers] = useState<Set<string>>(new Set());
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [highlightLinks, setHighlightLinks] = useState<Set<FGLink>>(new Set());
  const [showLabels, setShowLabels] = useState(true);

  // Layer list from data
  const allLayers = useMemo(
    () => Array.from(new Set(graphData.nodes.map((n) => n.layer))).sort(),
    [graphData.nodes]
  );

  // Toggle a layer filter
  const toggleLayer = useCallback((layer: string) => {
    setActiveLayers((prev) => {
      const s = new Set(prev);
      s.has(layer) ? s.delete(layer) : s.add(layer);
      return s;
    });
  }, []);

  // Filtered graph
  const filteredData = useMemo<FGData>(() => {
    if (activeLayers.size === 0) return graphData;
    const nodeIds = new Set(
      graphData.nodes.filter((n) => activeLayers.has(n.layer)).map((n) => n.id)
    );
    return {
      nodes: graphData.nodes.filter((n) => nodeIds.has(n.id)),
      links: graphData.links.filter((l) => {
        const src = typeof l.source === "object" ? (l.source as FGNode).id : l.source;
        const tgt = typeof l.target === "object" ? (l.target as FGNode).id : l.target;
        return nodeIds.has(src) && nodeIds.has(tgt);
      }),
    };
  }, [graphData, activeLayers]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Warm camera position after mount
  useEffect(() => {
    const t = setTimeout(() => {
      fgRef.current?.cameraPosition({ x: 0, y: 0, z: 600 }, { x: 0, y: 0, z: 0 }, 1000);
    }, 800);
    return () => clearTimeout(t);
  }, []);

  // Hover highlight
  const handleNodeHover = useCallback((node: FGNode | null) => {
    setHoveredNode(node);
    if (!node) {
      setHighlightNodes(new Set());
      setHighlightLinks(new Set());
      return;
    }
    const hLinks = new Set<FGLink>();
    const hNodes = new Set<string>([node.id]);
    for (const l of filteredData.links) {
      const src = typeof l.source === "object" ? (l.source as FGNode).id : l.source;
      const tgt = typeof l.target === "object" ? (l.target as FGNode).id : l.target;
      if (src === node.id || tgt === node.id) {
        hLinks.add(l);
        hNodes.add(src);
        hNodes.add(tgt);
      }
    }
    setHighlightNodes(hNodes);
    setHighlightLinks(hLinks);
  }, [filteredData]);

  // Node color — a real live pulse (pulseNodeIds) always wins visually, even
  // over hover-dimming, so an active node never gets grayed out mid-signal.
  const nodeColor = useCallback((node: FGNode) => {
    if (pulseNodeIds?.has(node.id)) return "#38bdf8";
    if (highlightNodes.size > 0 && !highlightNodes.has(node.id)) return "#1e2030";
    return STATUS_COLOR[node.status] ?? "#64748b";
  }, [highlightNodes, pulseNodeIds]);

  // Node size — pulsing nodes render larger, a real "it just lit up" cue.
  const nodeVal = useCallback((node: FGNode) => {
    if (pulseNodeIds?.has(node.id)) return 6;
    if (node.status === "BROKEN") return 4;
    if (node.status === "UNUSED") return 2;
    return 2.5;
  }, [pulseNodeIds]);

  // Node label (tooltip)
  const nodeLabel = useCallback((node: FGNode) => {
    const name = node.name_en.split("/").slice(-1)[0];
    const color = STATUS_COLOR[node.status] ?? "#64748b";
    return `<div style="background:rgba(10,10,26,0.92);border:1px solid ${color}40;border-radius:8px;padding:8px 12px;font-family:monospace;max-width:260px">
      <div style="color:${color};font-size:11px;font-weight:700">${name}</div>
      <div style="color:#94a3b8;font-size:10px;margin-top:2px">${node.layer} · ${node.status}</div>
      ${node.purpose_th ? `<div style="color:#cbd5e1;font-size:10px;margin-top:4px">${node.purpose_th}</div>` : ""}
      ${node.error_th ? `<div style="color:#fca5a5;font-size:10px;margin-top:4px">⚠ ${node.error_th}</div>` : ""}
    </div>`;
  }, []);

  const isPulseLink = useCallback((link: FGLink) => {
    if (!pulseLinkKeys || pulseLinkKeys.size === 0) return false;
    const src = typeof link.source === "object" ? (link.source as FGNode).id : link.source;
    const tgt = typeof link.target === "object" ? (link.target as FGNode).id : link.target;
    return pulseLinkKeys.has(linkKey(src, tgt));
  }, [pulseLinkKeys]);

  // Link color
  const linkColor = useCallback((link: FGLink) => {
    if (isPulseLink(link)) return "#38bdf8";
    if (highlightLinks.has(link)) {
      const src = typeof link.source === "object" ? (link.source as FGNode) : null;
      return src ? layerColor(src.layer) : "#c4b5fd";
    }
    return "#1e2535";
  }, [highlightLinks, isPulseLink]);

  const linkWidth = useCallback((link: FGLink) => {
    if (isPulseLink(link)) return 2.5;
    return highlightLinks.has(link) ? 1.5 : 0.5;
  }, [highlightLinks, isPulseLink]);

  // Stats
  const stats = useMemo(() => {
    const n = filteredData.nodes;
    return {
      total: n.length,
      ok:     n.filter((x) => x.status === "OK").length,
      broken: n.filter((x) => x.status === "BROKEN").length,
      unused: n.filter((x) => x.status === "UNUSED").length,
      links:  filteredData.links.length,
    };
  }, [filteredData]);

  return (
    <div className="flex flex-col h-full gap-0">
      {/* ── Top controls ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[#0a0a1a] border-b border-[#1e2535]">
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider shrink-0">Layer</span>
          {allLayers.map((l) => (
            <button
              key={l}
              onClick={() => toggleLayer(l)}
              className="text-[10px] px-2 py-0.5 rounded-full border transition"
              style={
                activeLayers.has(l)
                  ? { background: layerColor(l) + "33", borderColor: layerColor(l), color: layerColor(l) }
                  : { background: "transparent", borderColor: "#1e2535", color: "#475569" }
              }
            >
              {l}
            </button>
          ))}
          {activeLayers.size > 0 && (
            <button
              onClick={() => setActiveLayers(new Set())}
              className="text-[10px] text-slate-400 hover:text-white ml-1"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setShowLabels((v) => !v)}
            className={`text-[10px] px-2.5 py-1 rounded border transition ${
              showLabels
                ? "border-violet-500 text-violet-400 bg-violet-500/10"
                : "border-slate-700 text-slate-500"
            }`}
          >
            Labels
          </button>
          <button
            onClick={() => fgRef.current?.zoomToFit(600, 80)}
            className="text-[10px] px-2.5 py-1 rounded border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition"
          >
            Fit
          </button>
          <div className="flex items-center gap-3 border-l border-slate-800 pl-3">
            {[
              { status: "OK",     color: STATUS_COLOR.OK     },
              { status: "BROKEN", color: STATUS_COLOR.BROKEN },
              { status: "UNUSED", color: STATUS_COLOR.UNUSED },
            ].map(({ status, color }) => (
              <div key={status} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="text-[10px] text-slate-500">{status}</span>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-slate-600 border-l border-slate-800 pl-3">
            <span className="text-slate-300">{stats.total}</span> nodes ·{" "}
            <span className="text-slate-300">{stats.links}</span> edges
            {stats.broken > 0 && (
              <span className="text-red-400 ml-2">· {stats.broken} เสียหาย</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        ref={containerRef}
        className="flex-1 relative"
        style={{ background: "#050510", minHeight: 560 }}
      >
        <ForceGraph3D
          ref={fgRef}
          graphData={filteredData}
          width={dims.w}
          height={dims.h}
          backgroundColor="#050510"
          nodeId="id"
          nodeVal={nodeVal as any}
          nodeColor={nodeColor as any}
          nodeLabel={nodeLabel as any}
          nodeOpacity={0.95}
          nodeResolution={16}
          showNavInfo={false}
          linkColor={linkColor as any}
          linkWidth={linkWidth as any}
          linkOpacity={0.6}
          linkDirectionalParticles={((link: any) => (isPulseLink(link as FGLink) ? 6 : highlightLinks.has(link as FGLink) ? 3 : 0)) as any}
          linkDirectionalParticleWidth={((link: any) => (isPulseLink(link as FGLink) ? 3 : 1.5)) as any}
          linkDirectionalParticleColor={((link: any) => (isPulseLink(link as FGLink) ? "#38bdf8" : "#94a3b8")) as any}
          linkDirectionalParticleSpeed={((link: any) => (isPulseLink(link as FGLink) ? 0.02 : 0.006)) as any}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          enableNodeDrag={true}
          enableNavigationControls={true}
          onNodeHover={handleNodeHover as any}
          onNodeClick={onNodeClick as any}
          onBackgroundClick={() => {
            setHighlightNodes(new Set());
            setHighlightLinks(new Set());
          }}
          d3VelocityDecay={0.4}
          cooldownTime={3000}
        />

        {/* ── Hover tooltip overlay (canvas-level) ── */}
        {hoveredNode && (
          <div
            className="pointer-events-none absolute top-3 left-3 z-20"
            style={{ maxWidth: 220 }}
          >
            <div
              className="rounded-xl px-3 py-2.5 text-xs font-mono"
              style={{
                background: "rgba(5,5,16,0.92)",
                border: `1px solid ${STATUS_COLOR[hoveredNode.status]}40`,
              }}
            >
              <div style={{ color: STATUS_COLOR[hoveredNode.status] }} className="font-bold truncate">
                {hoveredNode.name_en.split("/").slice(-1)[0]}
              </div>
              <div className="text-slate-400 text-[10px] mt-0.5">
                {hoveredNode.layer} · {hoveredNode.status}
              </div>
              {hoveredNode.purpose_th && (
                <div className="text-slate-300 text-[10px] mt-1 leading-relaxed">
                  {hoveredNode.purpose_th}
                </div>
              )}
              {hoveredNode.error_th && (
                <div className="text-red-400 text-[10px] mt-1">⚠ {hoveredNode.error_th}</div>
              )}
            </div>
          </div>
        )}

        {/* ── Instructions (fade out after 5s) ── */}
        <Instructions />
      </div>
    </div>
  );
}

function Instructions() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      className="absolute bottom-4 right-4 text-[10px] text-slate-600 text-right pointer-events-none transition-opacity duration-1000"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div>🖱 Drag to rotate · Scroll to zoom</div>
      <div>Click node for details</div>
    </div>
  );
}
