"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import GraphPage from "../graph/GraphView";
import { useAiTaskPulse } from "@/components/admin/useAiTaskPulse";

// Unified Build + Architecture Graph + Realtime Pulse screen (owner
// directive, 2026-08-04): merges app/admin/build, app/admin/graph and
// app/admin/telemetry into one screen instead of three. All three now
// redirect here. Real data only — /api/build and /api/governance,
// unchanged. The graph itself is the exact same GraphPage/ForceGraph3DView
// used before (no second graph implementation); the pulse overlay is the
// exact same ai_tasks Realtime subscription, moved into
// components/admin/useAiTaskPulse.ts so it isn't duplicated here and in a
// standalone telemetry page. Clicking a Violation row sets focusNodeId,
// which drives GraphPage's own existing node inspector (same
// /api/governance?node= fetch, same imports/importedBy/impact sidebar) —
// one Inspector for the whole page, not a second copy in this file.

interface BuildStatus {
  status: "clean" | "has_issues" | "not_built";
  status_th: string;
  generated_at: string | null;
  health: number;
  summary: {
    total: number; ok: number; broken: number; unused: number; unregistered: number;
  } | null;
}

interface ArchNode {
  id: string;
  type: string;
  layer: string;
  name_en: string;
  purpose_th: string;
  status: "OK" | "BROKEN" | "UNUSED" | "UNREGISTERED";
  error_th?: string;
}

interface ArchEdge { source: string; target: string; label: string; }

interface GovernanceBook {
  generated_at: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  summary: { total: number; ok: number; broken: number; unused: number; unregistered: number };
  violations: ArchNode[];
  health: number;
}

interface LayerDetail { layer: string; nodes: ArchNode[]; edges: ArchEdge[]; }

function HealthRing({ pct }: { pct: number }) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const fill = circ * (pct / 100);
  const color = pct >= 70 ? "#16a34a" : pct >= 40 ? "#ca8a04" : "#dc2626";
  return (
    <svg width={72} height={72} viewBox="0 0 72 72">
      <circle cx={36} cy={36} r={r} fill="none" stroke="#e5e7eb" strokeWidth={7} />
      <circle cx={36} cy={36} r={r} fill="none" stroke={color} strokeWidth={7}
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 36 36)" />
      <text x={36} y={41} textAnchor="middle" fontSize={14} fontWeight="bold" fill={color}>
        {pct}%
      </text>
    </svg>
  );
}

function healthColorClass(pct: number) {
  if (pct >= 70) return "text-green-600";
  if (pct >= 40) return "text-yellow-600";
  return "text-red-600";
}

function statusColorClass(status: string) {
  switch (status) {
    case "OK": return "text-green-600";
    case "BROKEN": return "text-red-600";
    case "UNUSED": return "text-yellow-600";
    case "UNREGISTERED": return "text-slate-500";
    default: return "text-stone-400";
  }
}

type ViolationTab = "ALL" | "BROKEN" | "UNUSED" | "UNREGISTERED";

export default function SystemOperationsPage() {
  const [data, setData] = useState<BuildStatus | null>(null);
  const [book, setBook] = useState<GovernanceBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);
  const [layerDetail, setLayerDetail] = useState<LayerDetail | null>(null);
  const [layerLoading, setLayerLoading] = useState(false);

  const [violationTab, setViolationTab] = useState<ViolationTab>("ALL");
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  const { pulseNodeIds, pulseLinkKeys } = useAiTaskPulse();

  async function loadGovernance() {
    try {
      const res = await fetch("/api/governance");
      if (!res.ok) return;
      setBook(await res.json());
    } catch {}
  }

  async function load() {
    setLoading(true);
    const res = await fetch("/api/build");
    setData(await res.json());
    setLoading(false);
    loadGovernance();
  }

  async function triggerSync() {
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch("/api/build", { method: "POST" });
    const json = await res.json();
    setSyncResult(json.status_th ?? json.error_th ?? "เสร็จแล้ว");
    setSyncing(false);
    load();
  }

  async function openLayer(layer: string) {
    if (expandedLayer === layer) {
      setExpandedLayer(null);
      setLayerDetail(null);
      return;
    }
    setExpandedLayer(layer);
    setLayerDetail(null);
    setLayerLoading(true);
    try {
      const res = await fetch(`/api/governance?layer=${encodeURIComponent(layer)}`);
      if (res.ok) setLayerDetail(await res.json());
    } finally {
      setLayerLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const moduleNodes = useMemo(() => (book?.nodes ?? []).filter((n) => n.type === "Module"), [book]);

  const layerStats = useMemo(() => {
    const order: string[] = [];
    const map: Record<string, ArchNode[]> = {};
    for (const n of moduleNodes) {
      if (!map[n.layer]) { map[n.layer] = []; order.push(n.layer); }
      map[n.layer].push(n);
    }
    return order.map((layer) => {
      const list = map[layer];
      const total = list.length;
      const ok = list.filter((n) => n.status === "OK").length;
      const broken = list.filter((n) => n.status === "BROKEN").length;
      const unused = list.filter((n) => n.status === "UNUSED").length;
      const unregistered = list.filter((n) => n.status === "UNREGISTERED").length;
      const health = total > 0 ? Math.round((ok / total) * 100) : 0;
      return { layer, total, ok, broken, unused, unregistered, health };
    });
  }, [moduleNodes]);

  const violations = book?.violations ?? [];
  const filteredViolations = useMemo(() => {
    if (violationTab === "ALL") return violations;
    return violations.filter((v) => v.status === violationTab);
  }, [violations, violationTab]);

  const violationTabs: { key: ViolationTab; label: string }[] = [
    { key: "ALL", label: "ทั้งหมด" },
    { key: "BROKEN", label: "BROKEN" },
    { key: "UNUSED", label: "UNUSED" },
    { key: "UNREGISTERED", label: "UNREGISTERED" },
  ];

  return (
    <div className="h-full flex flex-col bg-stone-50">
      {/* ── Header ── */}
      <div className="bg-white border-b border-stone-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-base font-bold text-stone-800">Build, Architecture & Realtime Pulse</h1>
          <p className="text-[11px] text-stone-400">สถานะ Registry Sync, Architecture Graph และ Realtime ai_tasks</p>
        </div>
        <div className="flex items-center gap-3">
          {data?.generated_at && (
            <span className="text-[11px] text-stone-400">
              ซิงก์ล่าสุด: {new Date(data.generated_at).toLocaleString("th-TH")}
            </span>
          )}
          <button
            onClick={triggerSync}
            disabled={syncing}
            className="px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition"
          >
            {syncing ? "กำลัง Sync…" : "↺ Sync Now"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-stone-400 text-sm text-center py-8">กำลังโหลด…</div>
      ) : data ? (
        <div className="flex-1 flex min-h-0">
          {/* ── Left column: Health / Summary / Layer table / Violations ── */}
          <div className="w-[380px] shrink-0 border-r border-stone-200 overflow-y-auto p-3 space-y-3">
            <div className="bg-white border border-stone-200 rounded-xl p-3 flex items-center gap-3">
              <HealthRing pct={data.health} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-stone-800 truncate">{data.status_th}</div>
                {data.generated_at ? (
                  <div className="text-[10px] text-stone-400 mt-0.5">
                    {new Date(data.generated_at).toLocaleString("th-TH")}
                  </div>
                ) : (
                  <div className="text-[10px] text-red-500 mt-0.5">ยังไม่มี architecture-book.json</div>
                )}
              </div>
            </div>

            {data.summary && (
              <div className="bg-white border border-stone-200 rounded-xl p-3 grid grid-cols-5 gap-1">
                {[
                  { label: "ทั้งหมด", value: data.summary.total, color: "text-stone-700" },
                  { label: "ปกติ", value: data.summary.ok, color: "text-green-600" },
                  { label: "เสียหาย", value: data.summary.broken, color: "text-red-600" },
                  { label: "ไม่ได้ใช้", value: data.summary.unused, color: "text-yellow-600" },
                  { label: "ยังไม่ลงทะเบียน", value: data.summary.unregistered, color: "text-slate-500" },
                ].map((s) => (
                  <div key={s.label} className="text-center">
                    <div className={`text-base font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-[9px] text-stone-400 mt-0.5 leading-tight">{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {syncResult && (
              <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 text-[11px] text-violet-700">
                {syncResult}
              </div>
            )}

            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-stone-100">
                <span className="text-xs font-semibold text-stone-800">สถานะแต่ละ Layer</span>
              </div>
              {layerStats.length === 0 ? (
                <div className="text-stone-400 text-xs text-center py-4">ยังไม่มีข้อมูล</div>
              ) : (
                <table className="w-full text-[11px]">
                  <thead className="bg-stone-50 text-stone-400">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium">Layer</th>
                      <th className="text-right px-1 py-1.5 font-medium">Total</th>
                      <th className="text-right px-2 py-1.5 font-medium">Health</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {layerStats.map((l) => (
                      <>
                        <tr
                          key={l.layer}
                          onClick={() => openLayer(l.layer)}
                          className="cursor-pointer hover:bg-stone-50 transition"
                        >
                          <td className="px-3 py-1.5 font-mono text-stone-700">{l.layer}</td>
                          <td className="text-right px-1 py-1.5 text-stone-600">{l.total}</td>
                          <td className={`text-right px-2 py-1.5 font-semibold ${healthColorClass(l.health)}`}>
                            {l.health}%
                          </td>
                        </tr>
                        {expandedLayer === l.layer && (
                          <tr key={`${l.layer}-detail`}>
                            <td colSpan={3} className="bg-stone-50 px-3 py-2">
                              {layerLoading ? (
                                <div className="text-stone-400 text-[10px]">กำลังโหลด…</div>
                              ) : layerDetail ? (
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                  <div className="text-[9px] text-stone-400 mb-1">
                                    {layerDetail.nodes.length} nodes · {layerDetail.edges.length} edges
                                  </div>
                                  {layerDetail.nodes.map((n) => (
                                    <div
                                      key={n.id}
                                      onClick={() => setFocusNodeId(n.id)}
                                      className="flex items-center justify-between gap-2 text-[10px] cursor-pointer hover:text-violet-700"
                                    >
                                      <span className="font-mono text-stone-700 truncate">{n.name_en}</span>
                                      <span className={`font-bold shrink-0 ${statusColorClass(n.status)}`}>{n.status}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-stone-400 text-[10px]">ยังไม่มีข้อมูล</div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden flex flex-col">
              <div className="px-3 py-2 border-b border-stone-100 flex items-center gap-1">
                {violationTabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setViolationTab(t.key)}
                    className={`px-2 py-0.5 text-[10px] rounded-lg transition ${
                      violationTab === t.key ? "bg-violet-600 text-white" : "text-stone-500 hover:bg-stone-100"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="overflow-y-auto max-h-64 divide-y divide-stone-100">
                {filteredViolations.length === 0 ? (
                  <div className="text-stone-400 text-xs text-center py-4">ไม่พบปัญหาจาก Architecture Book ล่าสุด</div>
                ) : (
                  filteredViolations.map((v) => (
                    <div
                      key={v.id}
                      onClick={() => setFocusNodeId(v.id)}
                      className={`flex items-start justify-between gap-2 px-3 py-1.5 hover:bg-stone-50 cursor-pointer transition ${
                        focusNodeId === v.id ? "bg-violet-50" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-[10px] font-mono text-stone-700 truncate">{v.name_en}</div>
                        <div className="text-[9px] text-stone-400">{v.layer}</div>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <span className={`text-[9px] font-bold ${statusColorClass(v.status)}`}>{v.status}</span>
                        <Link
                          href={`/admin/reader?path=${encodeURIComponent(v.name_en)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-[9px] text-violet-600 hover:underline"
                        >
                          เปิด Source
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ── Right: real graph + realtime pulse overlay + single Inspector ── */}
          <div className="flex-1 min-w-0">
            <GraphPage
              embedded
              showHeader={false}
              pulseNodeIds={pulseNodeIds}
              pulseLinkKeys={pulseLinkKeys}
              focusNodeId={focusNodeId}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
