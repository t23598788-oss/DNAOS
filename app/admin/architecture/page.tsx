"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────

type NodeStatus = "OK" | "BROKEN" | "UNUSED" | "UNREGISTERED";

interface ArchNode {
  id: string;
  type: string;
  layer: string;
  name_en: string;
  purpose_th: string;
  exports: string[];
  status: NodeStatus;
  error_th?: string;
}

interface ImpactNode {
  id: string;
  name_en: string;
  status: NodeStatus;
}

interface GovernanceData {
  generated_at: string;
  nodes: ArchNode[];
  summary: {
    total: number;
    ok: number;
    broken: number;
    unused: number;
    unregistered: number;
  };
  health: number;
  error_th?: string;
}

// ── Status Config ──────────────────────────────────────────────────

const STATUS_CONFIG: Record<NodeStatus, { label: string; badge: string; dot: string }> = {
  OK:           { label: "ปกติ",              badge: "bg-green-100 text-green-800",   dot: "bg-green-400" },
  BROKEN:       { label: "เสียหาย",           badge: "bg-red-100 text-red-700",       dot: "bg-red-500" },
  UNUSED:       { label: "ไม่ได้ใช้งาน",     badge: "bg-yellow-100 text-yellow-800", dot: "bg-yellow-400" },
  UNREGISTERED: { label: "ยังไม่ลงทะเบียน", badge: "bg-slate-100 text-slate-600",   dot: "bg-slate-400" },
};

// ── Components ─────────────────────────────────────────────────────

function StatusBadge({ status }: { status: NodeStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function SummaryBar({ summary, health, generatedAt }: {
  summary: GovernanceData["summary"];
  health: number;
  generatedAt: string;
}) {
  return (
    <div className="bg-white border-b border-stone-200 px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-base font-bold text-stone-800">สถาปัตยกรรมระบบ</h1>
          <p className="text-[11px] text-stone-400 mt-0.5">
            อัปเดตล่าสุด: {new Date(generatedAt).toLocaleString("th-TH")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-stone-500">สุขภาพระบบ</span>
          <span className={`text-lg font-bold ${health >= 70 ? "text-green-600" : health >= 40 ? "text-yellow-600" : "text-red-600"}`}>
            {health}%
          </span>
        </div>
      </div>
      <div className="flex gap-4 text-xs">
        <span className="text-stone-500">ทั้งหมด <strong className="text-stone-800">{summary.total}</strong></span>
        <span className="text-green-700">ปกติ <strong>{summary.ok}</strong></span>
        <span className="text-red-700">เสียหาย <strong>{summary.broken}</strong></span>
        <span className="text-yellow-700">ไม่ได้ใช้ <strong>{summary.unused}</strong></span>
        <span className="text-slate-500">ยังไม่ลงทะเบียน <strong>{summary.unregistered}</strong></span>
      </div>
    </div>
  );
}

// ── ModuleRow — with click-to-reader + impact panel ──

function ModuleRow({ node }: { node: ArchNode }) {
  const [impact, setImpact] = useState<ImpactNode[] | null>(null);
  const [showImpact, setShowImpact] = useState(false);
  const isError = node.status !== "OK";
  const readerPath = encodeURIComponent(node.name_en);

  async function loadImpact() {
    if (impact !== null) { setShowImpact((v) => !v); return; }
    const res = await fetch(`/api/governance?node=${encodeURIComponent(node.id)}`);
    const data = await res.json();
    setImpact(data.impact ?? []);
    setShowImpact(true);
  }

  return (
    <div className={`px-4 py-2.5 border-b border-stone-100 last:border-0 ${isError ? "bg-red-50/30" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {/* ── ชื่อ module คลิกได้ → เปิดใน Reader ── */}
            <Link
              href={`/admin/reader?path=${readerPath}`}
              className="text-[11px] font-mono text-stone-600 hover:text-violet-700 hover:underline underline-offset-2 truncate"
            >
              {node.name_en}
            </Link>
            <StatusBadge status={node.status} />
          </div>
          {node.purpose_th && !node.purpose_th.startsWith("[Auto") && (
            <p className="text-[11px] text-stone-500 mt-0.5">{node.purpose_th}</p>
          )}
          {/* ── Error ภาษาไทยสีแดง ── */}
          {isError && node.error_th && (
            <p className="text-[11px] text-red-600 mt-1 leading-relaxed">⚠ {node.error_th}</p>
          )}
          {/* ── Impact panel ── */}
          {showImpact && impact && impact.length > 0 && (
            <div className="mt-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <p className="text-[10px] text-red-600 font-semibold mb-1">
                ผลกระทบ — {impact.length} module ที่ import module นี้:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {impact.map((n) => (
                  <Link
                    key={n.id}
                    href={`/admin/reader?path=${encodeURIComponent(n.name_en)}`}
                    className="text-[10px] font-mono text-red-700 bg-red-100 hover:bg-red-200 px-1.5 py-0.5 rounded transition"
                  >
                    {n.name_en.split("/").slice(-1)[0]}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {showImpact && impact?.length === 0 && (
            <p className="text-[10px] text-stone-400 mt-1">ไม่มี module ที่ได้รับผลกระทบ</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {node.exports?.length > 0 && (
            <span className="text-[10px] text-stone-400 tabular-nums">{node.exports.length} exports</span>
          )}
          {/* ปุ่มดู impact เฉพาะ module ที่ไม่ OK */}
          {isError && (
            <button
              onClick={loadImpact}
              className="text-[10px] text-red-500 hover:text-red-700 border border-red-200 px-1.5 py-0.5 rounded transition"
            >
              {showImpact ? "ซ่อน" : "ผลกระทบ"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LayerCard({ layerId, nodes }: { layerId: string; nodes: ArchNode[] }) {
  const [expanded, setExpanded] = useState(true);
  const hasError = nodes.some((n) => n.status !== "OK");
  const broken = nodes.filter((n) => n.status === "BROKEN").length;
  const unused = nodes.filter((n) => n.status === "UNUSED").length;

  return (
    <div className={`rounded-xl border ${hasError ? "border-red-200" : "border-stone-200"} bg-white overflow-hidden`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition"
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${hasError ? "bg-red-400" : "bg-green-400"}`} />
          <span className="text-sm font-semibold text-stone-700">{layerId}</span>
          <span className="text-[10px] text-stone-400">{nodes.length} modules</span>
        </div>
        <div className="flex items-center gap-2">
          {broken > 0 && <span className="text-[10px] text-red-600">{broken} เสียหาย</span>}
          {unused > 0 && <span className="text-[10px] text-yellow-600">{unused} ไม่ได้ใช้</span>}
          <span className="text-stone-400 text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-stone-100 divide-y divide-stone-50">
          {nodes.map((node) => (
            <ModuleRow key={node.id} node={node} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────

export default function ArchitecturePage() {
  const [data, setData] = useState<GovernanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/governance");
      if (!res.ok) {
        const body = await res.json();
        setError(body.error_th ?? body.error ?? "ไม่สามารถโหลดข้อมูลได้");
        return;
      }
      const json = await res.json();
      setData(json);
      setError(null);
      setLastFetch(new Date());
    } catch {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อ API");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64 text-stone-400 text-sm">
        กำลังโหลดข้อมูลสถาปัตยกรรม…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-700">ข้อผิดพลาด</p>
          <p className="text-sm text-red-600 mt-1">{error}</p>
          <p className="text-[11px] text-red-400 mt-2">
            แก้ไข: รัน <code className="font-mono bg-red-100 px-1 rounded">npm run sync</code> แล้วรีสตาร์ท server
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const moduleNodes = data.nodes.filter((n) => n.type === "Module");
  const layerGroups: Record<string, ArchNode[]> = {};
  for (const node of moduleNodes) {
    const layer = node.layer || "unknown";
    if (!layerGroups[layer]) layerGroups[layer] = [];
    layerGroups[layer].push(node);
  }

  const sortedLayers = Object.entries(layerGroups).sort(([, a], [, b]) => {
    const aErr = a.filter((n) => n.status !== "OK").length;
    const bErr = b.filter((n) => n.status !== "OK").length;
    return bErr - aErr;
  });

  return (
    <div className="min-h-screen bg-stone-50">
      <SummaryBar summary={data.summary} health={data.health} generatedAt={data.generated_at} />

      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between text-[11px] text-stone-400">
          <span>อัปเดตอัตโนมัติทุก 10 วินาที — คลิกชื่อ module เพื่อเปิด Source</span>
          {lastFetch && <span>Fetch ล่าสุด: {lastFetch.toLocaleTimeString("th-TH")}</span>}
        </div>

        {sortedLayers.map(([layerId, nodes]) => (
          <LayerCard key={layerId} layerId={layerId} nodes={nodes} />
        ))}
      </div>
    </div>
  );
}
