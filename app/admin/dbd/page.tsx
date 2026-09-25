"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────────────

interface DBDData {
  generated_at: string;
  runtime: {
    status: string;
    health_pct: number;
    summary: { total: number; ok: number; broken: number; unused: number; unregistered: number } | null;
    generated_at: string | null;
  };
  ai: {
    capabilities: { name: string; status: string; interfaces: string[]; used_by: string[]; gap: string | null }[];
    environment: { current: string; supported: string[]; planned: string[] };
    goals: { key: string; label: string; workflows: string[]; metrics: string[] }[];
  };
  apis: { routes: { method: string; path: string; source: string }[]; total: number };
  modules: {
    total: number;
    layers: Record<string, { id: string; name_en: string; purpose_th: string; status: string; error_th?: string; exports: string[] }[]>;
  };
  workflows: {
    commands_total: number;
    by_layer: Record<string, { name: string; description: string; layer: string; input: string | null; output: string | null; available: boolean }[]>;
    gaps: { action: string; effort: string; impact: string }[];
  };
  database: {
    domains: {
      name: string; name_th: string | null; purpose_th: string | null;
      tables: { name: string; description: string; columns: string[]; softDelete: boolean }[];
      commands: string[]; used_by: any[]; relations: any[];
    }[];
    total_tables: number;
  };
  arch: { nodes: any[]; edges: any[]; summary: any; generated_at: string };
  deploy: {
    git: { hash: string; branch: string; message: string; author: string; date: string } | null;
    environment: string; platform: string; node_version: string;
  };
  traces: { recent: any[]; total: number };
  events: {
    registered: { name: string; source: string; data: string[] }[];
    recent: { event: string; layer: string; trace_id: string; timestamp: string }[];
  };
  governance: {
    policy: string;
    overall_pct: number;
    domains: {
      key: string; label: string; total: number; codified: number; coverage_pct: number;
      rules: { decision: string; codified_in: string | null; source: string | null }[];
    }[];
  };
  runtime_events: {
    id: string; type: string; source: string; timestamp: string; traceId: string; data?: unknown;
  }[];
}

// ── Palette ────────────────────────────────────────────────────────────────

const METHOD_BADGE: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30", POST: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
  PUT: "bg-amber-500/20 text-amber-300 border border-amber-500/30", PATCH: "bg-orange-500/15 text-orange-300 border border-orange-500/30",
  DELETE: "bg-red-500/20 text-red-400 border border-red-500/30", HEAD: "bg-slate-500/15 text-slate-300 border border-slate-500/30",
};

const STATUS_DOT: Record<string, string> = {
  OK: "bg-green-400", BROKEN: "bg-red-400", UNUSED: "bg-yellow-400", UNREGISTERED: "bg-slate-400",
};

const CAP_STATUS: Record<string, { dot: string; text: string }> = {
  available:     { dot: "bg-green-400",  text: "text-green-400"  },
  partial:       { dot: "bg-amber-400",  text: "text-amber-300"  },
  not_available: { dot: "bg-red-400",    text: "text-red-400"    },
};

const LAYER_COLOR: Record<string, string> = {
  "cognitive": "#7c3aed", "v2-rules": "#0284c7", "v3-engines": "#059669",
  "v4-ai": "#d97706", "v5-presenter": "#db2777", "v6-executor": "#dc2626",
  "runtime": "#6b7280", "supabase": "#2563eb", "shared": "#94a3b8",
};

// ── Shared components ──────────────────────────────────────────────────────

function Ring({ pct, size = 52 }: { pct: number; size?: number }) {
  const r = size / 2 - 6;
  const circ = 2 * Math.PI * r;
  const fill = circ * (Math.min(100, pct) / 100);
  const color = pct >= 70 ? "#22d3ee" : pct >= 40 ? "#fbbf24" : "#f87171";
  return (
    <svg width={size} height={size} className="shrink-0" style={{ filter: `drop-shadow(0 0 4px ${color}80)` }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fontSize={11} fontWeight="bold" fill={color}>
        {pct}%
      </text>
    </svg>
  );
}

function Bar({ pct }: { pct: number }) {
  const color = pct >= 70 ? "bg-green-400" : pct >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="h-1.5 rounded-full bg-cyan-500/10 overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${color}`}>{text}</span>;
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-mono bg-slate-800/60 text-slate-300 px-1.5 py-0.5 rounded">{children}</span>;
}

function Section({ title, count, children, action, actionLabel, onAction }: {
  title: string; count?: number; children: React.ReactNode;
  action?: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">{title}</h2>
          {count !== undefined && (
            <span className="text-[10px] bg-slate-800/60 text-slate-400 px-1.5 py-0.5 rounded-full">{count}</span>
          )}
        </div>
        {actionLabel && onAction && (
          <button onClick={onAction}
            className="text-[11px] text-cyan-500 hover:text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/10 px-2.5 py-1 rounded-lg transition">
            {actionLabel} →
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────

function RuntimeSection({ d, onNavigate }: { d: DBDData; onNavigate: (path: string) => void }) {
  const s = d.runtime.summary;
  return (
    <div className="space-y-4">
      <Section title="Runtime Status">
        <div className="grid grid-cols-5 gap-3">
          {s ? [
            { l: "ทั้งหมด",          v: s.total,        c: "text-slate-100" },
            { l: "ปกติ",              v: s.ok,           c: "text-green-400" },
            { l: "เสียหาย",           v: s.broken,       c: "text-red-400" },
            { l: "ไม่ได้ใช้",         v: s.unused,       c: "text-yellow-400" },
            { l: "ยังไม่ลงทะเบียน",  v: s.unregistered, c: "text-slate-500" },
          ].map((x) => (
            <div key={x.l} className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] p-3 text-center">
              <div className={`text-2xl font-bold ${x.c}`}>{x.v}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{x.l}</div>
            </div>
          )) : (
            <div className="col-span-5 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-300">
              ยังไม่มีข้อมูล — รัน <code className="font-mono bg-amber-500/20 px-1 rounded">npm run sync</code> ก่อน
            </div>
          )}
        </div>
        {d.runtime.generated_at && (
          <p className="text-[11px] text-slate-500">
            Sync ล่าสุด: {new Date(d.runtime.generated_at).toLocaleString("th-TH")}
          </p>
        )}
      </Section>
    </div>
  );
}

function AISection({ d, onNavigate }: { d: DBDData; onNavigate: (path: string) => void }) {
  const avail = d.ai.capabilities.filter((c) => c.status === "available").length;
  const missing = d.ai.capabilities.filter((c) => c.status === "not_available").length;
  return (
    <div className="space-y-4">
      <Section title="AI / Capabilities" count={d.ai.capabilities.length}
        actionLabel="เปิด DNA" onAction={() => onNavigate("/admin/dna")}>
        <div className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-800/60 flex items-center gap-4 text-xs">
            <span>Environment: <strong>{d.ai.environment.current}</strong></span>
            <span className="text-green-400">{avail} available</span>
            <span className="text-red-400">{missing} missing</span>
          </div>
          <div className="divide-y divide-slate-800/40">
            {d.ai.capabilities.map((c) => {
              const cs = CAP_STATUS[c.status] ?? { dot: "bg-slate-600", text: "text-slate-500" };
              return (
                <div key={c.name} className="flex items-start gap-3 px-4 py-2.5">
                  <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${cs.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold text-slate-200">{c.name}</span>
                      <span className={`text-[10px] ${cs.text}`}>{c.status}</span>
                    </div>
                    {c.gap && <p className="text-[11px] text-red-400 mt-0.5">{c.gap}</p>}
                    {c.interfaces.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {c.interfaces.slice(0, 3).map((i) => <Tag key={i}>{i}</Tag>)}
                      </div>
                    )}
                  </div>
                  {c.used_by.length > 0 && (
                    <span className="text-[10px] text-slate-500 shrink-0">{c.used_by.length} users</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      <Section title="Business Goals" count={d.ai.goals.length}>
        <div className="grid grid-cols-2 gap-3">
          {d.ai.goals.map((g) => (
            <div key={g.key} className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] p-3">
              <div className="text-xs font-semibold text-slate-200 mb-1.5">{g.label}</div>
              <div className="flex flex-wrap gap-1 mb-2">
                {g.workflows.map((w) => (
                  <span key={w} className="text-[10px] font-mono bg-cyan-500/10 text-cyan-500 border border-cyan-500/20 px-1.5 py-0.5 rounded">{w}</span>
                ))}
              </div>
              <div className="text-[10px] text-slate-500">metrics: {g.metrics.join(", ")}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function APISection({ d, onNavigate }: { d: DBDData; onNavigate: (path: string) => void }) {
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("ALL");
  const methods = useMemo(() => ["ALL", ...Array.from(new Set(d.apis.routes.map((r) => r.method))).sort()], [d.apis.routes]);
  const filtered = d.apis.routes.filter((r) =>
    (methodFilter === "ALL" || r.method === methodFilter) &&
    r.path.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <Section title="API Registry" count={d.apis.total}
      actionLabel="เปิด API Explorer" onAction={() => onNavigate("/admin/api-explorer")}>
      <div className="flex gap-2 mb-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหา path…"
          className="flex-1 px-3 py-1.5 text-xs border border-cyan-500/10 rounded-lg outline-none focus:border-cyan-400 bg-slate-900/60 text-slate-200 placeholder:text-slate-500" />
        <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}
          className="text-xs border border-cyan-500/10 rounded-lg px-2 bg-slate-900/60 text-slate-200">
          {methods.map((m) => <option key={m}>{m}</option>)}
        </select>
      </div>
      <div className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] overflow-hidden divide-y divide-slate-800/40 max-h-80 overflow-y-auto">
        {filtered.map((r) => (
          <div key={`${r.method}:${r.path}`} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-800/40 group transition">
            <Badge text={r.method} color={METHOD_BADGE[r.method] ?? "bg-slate-800/60 text-slate-300"} />
            <span className="text-xs font-mono text-slate-200 flex-1 truncate">{r.path}</span>
            <button onClick={() => onNavigate(`/admin/reader?path=${encodeURIComponent(r.source)}`)}
              className="text-[10px] text-slate-500 hover:text-cyan-500 opacity-0 group-hover:opacity-100 transition">
              &lt;/&gt;
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="px-4 py-4 text-center text-slate-500 text-xs">ไม่พบ route</div>
        )}
      </div>
    </Section>
  );
}

function ModuleSection({ d, onNavigate }: { d: DBDData; onNavigate: (path: string) => void }) {
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const layers = Object.entries(d.modules.layers);
  const activeLayer = selectedLayer ?? layers[0]?.[0] ?? null;
  const activeNodes = activeLayer ? (d.modules.layers[activeLayer] ?? []) : [];

  return (
    <div className="space-y-3">
      <Section title="Module Registry" count={d.modules.total}>
        {/* Layer tabs */}
        <div className="flex flex-wrap gap-1.5">
          {layers.map(([layer, nodes]) => {
            const broken = nodes.filter((n) => n.status === "BROKEN").length;
            const pct = nodes.length > 0 ? Math.round((nodes.filter((n) => n.status === "OK").length / nodes.length) * 100) : 100;
            return (
              <button key={layer} onClick={() => setSelectedLayer(layer)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg border transition ${
                  activeLayer === layer
                    ? "bg-cyan-500 text-white border-cyan-500"
                    : broken > 0
                      ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
                      : "bg-slate-900/60 border-cyan-500/10 text-slate-300 hover:border-cyan-400/40"
                }`}>
                {broken > 0 && <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
                {layer}
                <span className="text-[9px] opacity-70">{pct}%</span>
              </button>
            );
          })}
        </div>

        {/* Module list for selected layer */}
        {activeLayer && (
          <div className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] overflow-hidden divide-y divide-slate-800/40 max-h-72 overflow-y-auto">
            {activeNodes.map((n) => (
              <button key={n.id} onClick={() => onNavigate(`/admin/reader?path=${encodeURIComponent(n.name_en)}`)}
                className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-slate-800/40 text-left group transition">
                <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${STATUS_DOT[n.status] ?? "bg-slate-600"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-slate-200 group-hover:text-cyan-300 truncate">
                    {n.name_en.split("/").slice(-1)[0]}
                  </div>
                  {n.purpose_th && !n.purpose_th.startsWith("[Auto") && (
                    <div className="text-[10px] text-slate-500 truncate">{n.purpose_th}</div>
                  )}
                  {n.status === "BROKEN" && n.error_th && (
                    <div className="text-[10px] text-red-400">{n.error_th}</div>
                  )}
                </div>
                <span className="text-[10px] text-slate-600 shrink-0">{n.exports?.length ?? 0} exp</span>
              </button>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function WorkflowSection({ d, onNavigate }: { d: DBDData; onNavigate: (path: string) => void }) {
  const [search, setSearch] = useState("");
  const [layerFilter, setLayerFilter] = useState("ALL");
  const allLayers = Object.keys(d.workflows.by_layer).sort();
  const allCommands = useMemo(() => {
    const flat = Object.values(d.workflows.by_layer).flat();
    return layerFilter === "ALL" ? flat : (d.workflows.by_layer[layerFilter] ?? []);
  }, [d.workflows.by_layer, layerFilter]);
  const filtered = allCommands.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.description.includes(search)
  );

  return (
    <div className="space-y-4">
      <Section title="Command Registry" count={d.workflows.commands_total}>
        <div className="flex gap-2 mb-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหา command…"
            className="flex-1 px-3 py-1.5 text-xs border border-cyan-500/10 rounded-lg outline-none focus:border-cyan-400 bg-slate-900/60 text-slate-200 placeholder:text-slate-500" />
          <select value={layerFilter} onChange={(e) => setLayerFilter(e.target.value)}
            className="text-xs border border-cyan-500/10 rounded-lg px-2 bg-slate-900/60 text-slate-200">
            <option value="ALL">ALL</option>
            {allLayers.map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
        <div className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] overflow-hidden divide-y divide-slate-800/40 max-h-80 overflow-y-auto">
          {filtered.map((c) => {
            const lc = LAYER_COLOR[c.layer] ?? "#94a3b8";
            return (
              <div key={c.name} className="flex items-start gap-3 px-4 py-2.5">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${c.available ? "bg-green-400" : "bg-red-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-semibold text-slate-200">{c.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: lc + "18", color: lc }}>
                      {c.layer || "—"}
                    </span>
                  </div>
                  {c.description && <div className="text-[11px] text-slate-500 truncate mt-0.5">{c.description}</div>}
                  {c.output && <div className="text-[10px] text-cyan-400 mt-0.5 font-mono">→ {c.output}</div>}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-4 py-4 text-center text-slate-500 text-xs">ไม่พบ command</div>
          )}
        </div>
      </Section>

      {d.workflows.gaps.length > 0 && (
        <Section title="Evolution Needed" count={d.workflows.gaps.length}>
          <div className="space-y-2">
            {d.workflows.gaps.map((g, i) => (
              <div key={i} className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-slate-200">{g.action}</div>
                  {g.effort && (
                    <span className="text-[10px] bg-slate-800/60 border border-amber-500/30 text-amber-400 px-1.5 py-0.5 rounded shrink-0">
                      {g.effort}
                    </span>
                  )}
                </div>
                {g.impact && <div className="text-[11px] text-amber-300 mt-0.5">{g.impact}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function DatabaseSection({ d }: { d: DBDData }) {
  const [selected, setSelected] = useState<string | null>(d.database.domains[0]?.name ?? null);
  const domain = d.database.domains.find((x) => x.name === selected) ?? null;

  return (
    <div className="space-y-3">
      <Section title="Database Registry"
        count={d.database.domains.length}>
        <p className="text-[11px] text-slate-500">{d.database.total_tables} tables รวมทุก domain</p>

        {/* Domain tabs */}
        <div className="flex flex-wrap gap-1.5">
          {d.database.domains.map((dom) => (
            <button key={dom.name} onClick={() => setSelected(dom.name)}
              className={`px-2.5 py-1 text-[11px] rounded-lg border transition ${
                selected === dom.name
                  ? "bg-sky-500 text-white border-sky-500"
                  : "bg-slate-900/60 border-cyan-500/10 text-slate-300 hover:border-sky-400/40"
              }`}>
              {dom.name_th ?? dom.name}
              <span className="ml-1 opacity-60 text-[9px]">{dom.tables.length}t</span>
            </button>
          ))}
        </div>

        {/* Domain detail */}
        {domain && (
          <div className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] overflow-hidden">
            {domain.purpose_th && (
              <div className="px-4 py-2.5 border-b border-slate-800/60 text-[11px] text-slate-400">
                {domain.purpose_th}
              </div>
            )}
            {domain.tables.length > 0 ? (
              <div className="divide-y divide-slate-800/40">
                {domain.tables.map((t) => (
                  <div key={t.name} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono font-semibold text-sky-300">{t.name}</span>
                      {t.softDelete && (
                        <span className="text-[9px] bg-slate-800/60 text-slate-400 px-1 rounded">soft-delete</span>
                      )}
                    </div>
                    {t.description && (
                      <div className="text-[11px] text-slate-400 mb-1.5">{t.description}</div>
                    )}
                    {t.columns.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {t.columns.slice(0, 8).map((col) => (
                          <span key={col} className="text-[10px] font-mono bg-sky-500/10 text-sky-500 border border-sky-500/20 px-1.5 py-0.5 rounded">
                            {col}
                          </span>
                        ))}
                        {t.columns.length > 8 && (
                          <span className="text-[10px] text-slate-500">+{t.columns.length - 8}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-4 text-center text-[11px] text-slate-500">
                ไม่มีข้อมูล table structure ใน registry นี้
              </div>
            )}
            {domain.commands.length > 0 && (
              <div className="px-4 py-2.5 border-t border-slate-800/60 bg-slate-800/40">
                <div className="text-[10px] text-slate-500 mb-1.5">Commands ({domain.commands.length})</div>
                <div className="flex flex-wrap gap-1">
                  {domain.commands.map((c) => <Tag key={c}>{c}</Tag>)}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

function GraphSection({ d, onNavigate }: { d: DBDData; onNavigate: (path: string) => void }) {
  const layerMap: Record<string, { ok: number; broken: number; unused: number; total: number }> = {};
  for (const n of d.arch.nodes) {
    if (n.type !== "Module") continue;
    const l = n.layer || "unknown";
    if (!layerMap[l]) layerMap[l] = { ok: 0, broken: 0, unused: 0, total: 0 };
    layerMap[l].total++;
    if (n.status === "OK") layerMap[l].ok++;
    else if (n.status === "BROKEN") layerMap[l].broken++;
    else if (n.status === "UNUSED") layerMap[l].unused++;
  }
  const layers = Object.entries(layerMap).sort(([, a], [, b]) => b.broken - a.broken);

  const BOX_W = 130; const BOX_H = 32; const GAP_X = 8; const GAP_Y = 6;
  const COLS = 5;
  const rows = Math.ceil(layers.length / COLS);
  const SVG_W = COLS * BOX_W + (COLS - 1) * GAP_X + 4;
  const SVG_H = rows * BOX_H + (rows - 1) * GAP_Y + 4;

  return (
    <Section title="Architecture Graph"
      count={d.arch.nodes.filter((n: any) => n.type === "Module").length}>
      {d.arch.summary && (
        <div className="flex gap-4 text-xs mb-3">
          <span className="text-slate-400">nodes: <b>{d.arch.nodes.length}</b></span>
          <span className="text-slate-400">edges: <b>{d.arch.edges.length}</b></span>
          <span className="text-green-400">OK: <b>{d.arch.summary.ok}</b></span>
          <span className="text-red-400">broken: <b>{d.arch.summary.broken}</b></span>
          <span className="text-yellow-400">unused: <b>{d.arch.summary.unused}</b></span>
        </div>
      )}
      <div className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] p-3 overflow-auto">
        <svg width={SVG_W} height={SVG_H} className="block">
          {layers.map(([layer, s], i) => {
            const col = i % COLS;
            const row = Math.floor(i / COLS);
            const x = 2 + col * (BOX_W + GAP_X);
            const y = 2 + row * (BOX_H + GAP_Y);
            const pct = s.total > 0 ? s.ok / s.total : 1;
            const fill = s.broken > 0 ? "#450a0a33" : "#05966918";
            const stroke = s.broken > 0 ? "#f8717166" : "#22d3ee4d";
            return (
              <g key={layer}>
                <rect x={x} y={y} width={BOX_W} height={BOX_H} rx={6} fill={fill} stroke={stroke} strokeWidth={1} />
                <text x={x + 6} y={y + 13} fontSize={9} fontWeight="600" fill="#e2e8f0">
                  {layer.length > 16 ? layer.slice(0, 16) + "…" : layer}
                </text>
                <text x={x + 6} y={y + 24} fontSize={8} fill={s.broken > 0 ? "#f87171" : "#64748b"}>
                  {s.total} modules · {Math.round(pct * 100)}%
                </text>
                <rect x={x + BOX_W - 34} y={y + 18} width={28} height={3} rx={1.5} fill="#1e293b" />
                <rect x={x + BOX_W - 34} y={y + 18} width={28 * pct} height={3} rx={1.5}
                  fill={pct >= 0.7 ? "#22d3ee" : pct >= 0.4 ? "#fbbf24" : "#f87171"} />
              </g>
            );
          })}
        </svg>
      </div>
    </Section>
  );
}

function BuildDeploySection({ d, onNavigate }: { d: DBDData; onNavigate: (path: string) => void }) {
  return (
    <div className="space-y-4">
      <Section title="Build Status">
        <div className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] p-4 flex items-center gap-4">
          <Ring pct={d.runtime.health_pct} size={60} />
          <div>
            <div className="text-sm font-semibold text-slate-200">
              {d.runtime.status === "clean" ? "ระบบสะอาด" : d.runtime.status === "has_issues" ? "มีปัญหา" : "ยังไม่ sync"}
            </div>
            {d.runtime.generated_at && (
              <div className="text-[11px] text-slate-500 mt-1">
                Sync: {new Date(d.runtime.generated_at).toLocaleString("th-TH")}
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="Deploy Status" actionLabel="เปิด Deploy" onAction={() => onNavigate("/admin/deploy")}>
        <div className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
              d.deploy.environment === "production"
                ? "bg-green-500/20 text-green-400"
                : "bg-amber-500/20 text-amber-300"
            }`}>{d.deploy.environment}</span>
            <span className="text-[11px] text-slate-500">
              Node {d.deploy.node_version} · {d.deploy.platform}
            </span>
          </div>
          {d.deploy.git ? (
            <div className="space-y-1.5 text-xs">
              {[
                ["Branch", d.deploy.git.branch],
                ["Commit", d.deploy.git.hash],
                ["Message", d.deploy.git.message],
                ["Author", d.deploy.git.author],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <span className="text-slate-500 w-16 shrink-0">{k}</span>
                  <span className="font-mono text-slate-200 truncate">{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-amber-400">ไม่ได้อยู่ใน Git Repository</p>
          )}
        </div>
      </Section>
    </div>
  );
}

function TraceSection({ d, onNavigate }: { d: DBDData; onNavigate: (path: string) => void }) {
  return (
    <Section title="Trace" count={d.traces.total}
      actionLabel="เปิด Traces" onAction={() => onNavigate("/admin/traces")}>
      {d.traces.total === 0 ? (
        <div className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] p-6 text-center text-slate-500 text-sm">
          ยังไม่มี Trace — จะปรากฏหลังระบบประมวลผล Workflow
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] overflow-hidden divide-y divide-slate-800/40">
          {d.traces.recent.map((t: any) => (
            <button key={t.trace_id} onClick={() => onNavigate("/admin/traces")}
              className="w-full text-left px-4 py-2.5 hover:bg-slate-800/40 transition">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  t.status === "completed" ? "bg-green-400"
                    : t.status === "failed" ? "bg-red-400"
                    : "bg-blue-400 animate-pulse"
                }`} />
                <span className="text-xs text-slate-200 flex-1 truncate">{t.user_input}</span>
                <span className="text-[10px] text-slate-500 shrink-0">{t.steps?.length ?? 0} steps</span>
                {t.total_duration_ms != null && (
                  <span className="text-[10px] text-slate-500 shrink-0">{t.total_duration_ms}ms</span>
                )}
              </div>
              {t.intent && <div className="text-[10px] text-cyan-500 mt-0.5 ml-4">{t.intent}</div>}
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

const EVENT_FILTERS = ["ALL", "line", "command", "rule", "error"] as const;
type EventFilter = typeof EVENT_FILTERS[number];

const EVENT_TYPE_COLOR: Record<string, string> = {
  "line":    "#16a34a",
  "command": "#7c3aed",
  "rule":    "#0284c7",
  "error":   "#dc2626",
  "engine":  "#d97706",
  "trace":   "#6b7280",
};

function eventTypeColor(type: string): string {
  const prefix = type.split(".")[0];
  return EVENT_TYPE_COLOR[prefix] ?? "#9ca3af";
}

function EventSection({ d }: { d: DBDData }) {
  const [filter, setFilter] = useState<EventFilter>("ALL");

  const filtered = useMemo(() => {
    if (filter === "ALL") return d.runtime_events;
    return d.runtime_events.filter((e) => e.type.startsWith(filter + ".") || e.type === filter);
  }, [d.runtime_events, filter]);

  const lineCount    = d.runtime_events.filter((e) => e.type.startsWith("line.")).length;
  const commandCount = d.runtime_events.filter((e) => e.type.startsWith("command.")).length;

  return (
    <div className="space-y-4">
      {/* ── Live Runtime Events ── */}
      <Section title="Runtime Events (Live)" count={d.runtime_events.length}>
        {/* Filter pills */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {EVENT_FILTERS.map((f) => {
            const badge = f === "line" ? lineCount : f === "command" ? commandCount : undefined;
            return (
              <button key={f} onClick={() => setFilter(f)}
                className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg border transition ${
                  filter === f
                    ? "bg-slate-700 text-white border-cyan-400/40"
                    : "bg-slate-900/60 border-cyan-500/10 text-slate-300 hover:border-slate-500/60"
                }`}>
                {f !== "ALL" && (
                  <span className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: EVENT_TYPE_COLOR[f] ?? "#9ca3af" }} />
                )}
                {f === "ALL" ? "ทั้งหมด" : f}
                {badge != null && badge > 0 && (
                  <span className="text-[9px] opacity-70 ml-0.5">{badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <div className="bg-black/40 rounded-xl p-6 text-center text-slate-400 text-sm">
            {d.runtime_events.length === 0
              ? "ยังไม่มี Runtime Event — จะปรากฏหลังมีการใช้งาน Workflow"
              : `ไม่มี event ประเภท "${filter}"`}
          </div>
        ) : (
          <div className="bg-black/40 rounded-xl overflow-hidden divide-y divide-slate-800 max-h-80 overflow-y-auto">
            {filtered.map((e) => {
              const color = eventTypeColor(e.type);
              return (
                <div key={e.id} className="flex items-start gap-3 px-4 py-2 hover:bg-slate-800/40 transition">
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                    style={{ background: color }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] font-mono" style={{ color }}>{e.type}</span>
                    {e.source && (
                      <span className="text-[10px] text-slate-400 ml-2">{e.source}</span>
                    )}
                    {e.data != null && (
                      <div className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
                        {JSON.stringify(e.data).slice(0, 80)}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-300 tabular-nums shrink-0 mt-0.5">
                    {new Date(e.timestamp).toLocaleTimeString("th-TH")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Registered Event Types ── */}
      <Section title="Registered Event Types" count={d.events.registered.length}>
        <div className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] overflow-hidden divide-y divide-slate-800/40 max-h-56 overflow-y-auto">
          {d.events.registered.map((ev) => (
            <div key={ev.name} className="flex items-center gap-3 px-4 py-2">
              <span className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: eventTypeColor(ev.name) }} />
              <span className="text-xs font-mono text-slate-200 flex-1">{ev.name}</span>
              {ev.source && (
                <span className="text-[10px] shrink-0"
                  style={{ color: LAYER_COLOR[ev.source] ?? "#9ca3af" }}>
                  {ev.source}
                </span>
              )}
              {ev.data.length > 0 && (
                <span className="text-[10px] text-slate-500 shrink-0">{ev.data.length} fields</span>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ── Governance Section ────────────────────────────────────────────────────

function GovernanceSection({ d }: { d: DBDData }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const g = d.governance;

  return (
    <div className="space-y-4">
      <Section title="Governance Decisions">
        <p className="text-[11px] text-slate-500 mb-3">{g.policy}</p>

        {/* Overall ring */}
        <div className="flex items-center gap-4 bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] p-4 mb-3">
          <Ring pct={g.overall_pct} size={56} />
          <div>
            <div className="text-sm font-semibold text-slate-200">
              การตัดสินใจเป็น Code แล้ว {g.overall_pct}%
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {g.domains.filter((d) => d.coverage_pct === 100).length} จาก {g.domains.length} domains ครบ 100%
            </div>
            <div className="text-[11px] text-amber-400 mt-0.5">
              {g.domains.reduce((s, d) => s + (d.total - d.codified), 0)} จุดตัดสินใจยังต้องใช้คน
            </div>
          </div>
        </div>

        {/* Domain list */}
        <div className="space-y-2">
          {g.domains.map((dom) => {
            const uncoded = dom.rules.filter((r) => !r.codified_in);
            const isOpen = expanded === dom.key;
            return (
              <div key={dom.key} className="bg-slate-900/60 border border-cyan-500/10 rounded-xl backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : dom.key)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/40 transition text-left">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-200">{dom.label}</span>
                      {uncoded.length > 0 && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">
                          {uncoded.length} ยังต้องใช้คน
                        </span>
                      )}
                      {dom.coverage_pct === 100 && (
                        <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">ครบ</span>
                      )}
                    </div>
                    <div className="mt-1.5">
                      <Bar pct={dom.coverage_pct} />
                    </div>
                  </div>
                  <span className={`text-sm font-bold shrink-0 ${
                    dom.coverage_pct === 100 ? "text-green-400" : dom.coverage_pct >= 70 ? "text-amber-400" : "text-red-400"
                  }`}>{dom.coverage_pct}%</span>
                  <span className="text-[10px] text-slate-500 shrink-0">{isOpen ? "▲" : "▼"}</span>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-800/60 divide-y divide-slate-800/40">
                    {dom.rules.map((r, i) => (
                      <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                        <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${
                          r.codified_in ? "bg-green-400" : "bg-amber-400"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-slate-200">{r.decision}</div>
                          {r.codified_in ? (
                            <div className="text-[10px] font-mono text-green-400 mt-0.5 truncate">
                              {r.codified_in}
                            </div>
                          ) : (
                            <div className="text-[10px] text-amber-400 mt-0.5">
                              ยังไม่มีในระบบ — ต้องให้คนตัดสินใจ
                            </div>
                          )}
                          {r.source && (
                            <div className="text-[10px] text-slate-500 mt-0.5 font-mono">{r.source}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

type SectionId = "runtime" | "ai" | "api" | "modules" | "workflow" | "database" | "graph" | "build" | "traces" | "events" | "governance";

const TABS: { id: SectionId; label: string; sublabel: string }[] = [
  { id: "runtime",    label: "Runtime",    sublabel: "System Health"   },
  { id: "ai",         label: "AI",         sublabel: "Capabilities"    },
  { id: "api",        label: "API",         sublabel: "Routes"          },
  { id: "modules",    label: "Modules",    sublabel: "Registry"        },
  { id: "workflow",   label: "Workflow",   sublabel: "Commands"        },
  { id: "database",   label: "Database",   sublabel: "Schema"          },
  { id: "graph",      label: "Graph",      sublabel: "Architecture"    },
  { id: "build",      label: "Build",      sublabel: "Deploy"          },
  { id: "traces",     label: "Traces",     sublabel: "Execution"       },
  { id: "events",     label: "Events",     sublabel: "Live Stream"     },
  { id: "governance", label: "Governance", sublabel: "Decisions"       },
];

export default function DBDPage() {
  const router = useRouter();
  const [data, setData] = useState<DBDData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<SectionId>("runtime");
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dbd");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setLastFetch(new Date());
      setError(null);
    } catch (e: any) {
      setError("โหลดไม่ได้: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, [load]);

  const nav = useCallback((path: string) => router.push(path), [router]);

  // Tab badge (error count)
  const tabBadge = useMemo<Partial<Record<SectionId, number>>>(() => {
    if (!data) return {};
    const broken = data.runtime.summary?.broken ?? 0;
    const uncodedDecisions = data.governance.domains.reduce(
      (s, d) => s + (d.total - d.codified), 0
    );
    const lineEvents = data.runtime_events.filter((e) => e.type.startsWith("line.")).length;
    return {
      runtime:    broken > 0 ? broken : undefined,
      modules:    broken > 0 ? broken : undefined,
      graph:      broken > 0 ? broken : undefined,
      traces:     data.traces.total > 0 ? data.traces.total : undefined,
      governance: uncodedDecisions > 0 ? uncodedDecisions : undefined,
      events:     lineEvents > 0 ? lineEvents : undefined,
    };
  }, [data]);

  return (
    <div className="min-h-screen bg-[#050b14] text-slate-300 flex flex-col relative overflow-hidden">
      {/* ── Ambient hologram backdrop ── */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(34,211,238,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.6) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }} />
        <div className="absolute -top-40 -left-40 w-[36rem] h-[36rem] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 w-[36rem] h-[36rem] rounded-full bg-blue-600/10 blur-[120px]" />
      </div>

      {/* ── Top bar ── */}
      <header className="relative z-10 bg-slate-900/70 backdrop-blur-md border-b border-cyan-500/20 shadow-[0_0_25px_-8px_rgba(34,211,238,0.35)] px-5 py-3 flex items-center gap-4 shrink-0">
        <div className="flex-1">
          <h1 className="text-sm font-bold tracking-[0.15em] text-cyan-300 uppercase"
            style={{ textShadow: "0 0 12px rgba(34,211,238,0.55)" }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 mr-2 align-middle animate-pulse"
              style={{ boxShadow: "0 0 8px 2px rgba(34,211,238,0.8)" }} />
            DBD Control Center
          </h1>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {loading ? "กำลังอ่าน Registry…" : error ? error : lastFetch ? `อัปเดต ${lastFetch.toLocaleTimeString("th-TH")} · ทุก 15 วิ` : ""}
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-3">
            {/* Quick stats */}
            {data.runtime.summary && (
              <div className="hidden sm:flex items-center gap-4 text-xs">
                <span className="text-green-400 font-medium">{data.runtime.summary.ok} OK</span>
                {data.runtime.summary.broken > 0 && (
                  <span className="text-red-400 font-medium">{data.runtime.summary.broken} broken</span>
                )}
                <span className="text-slate-500">{data.apis.total} APIs</span>
                <span className="text-slate-500">{data.workflows.commands_total} commands</span>
              </div>
            )}
            <Ring pct={data.runtime.health_pct} size={44} />
            <button onClick={load}
              className="text-[11px] text-cyan-400 hover:text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/10 px-2.5 py-1 rounded-lg transition">
              ↺
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="relative z-10 bg-red-500/10 border-b border-red-500/30 px-5 py-2 text-xs text-red-400">{error}</div>
      )}

      <div className="relative z-10 flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left nav — enterprise column style ── */}
        <nav className="w-44 shrink-0 bg-slate-950 border-r border-slate-800 overflow-y-auto">
          {TABS.map((tab) => {
            const badge = tabBadge[tab.id];
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`group w-full text-left px-4 py-3 border-b border-slate-800/60 transition-all duration-150 ${
                  isActive
                    ? "bg-slate-800 border-l-2 border-l-cyan-400 pl-3.5"
                    : "border-l-2 border-l-transparent hover:bg-slate-800/70 hover:border-l-slate-500"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={`text-xs font-semibold tracking-wide transition-colors duration-150 ${
                    isActive
                      ? "text-cyan-300"
                      : "text-slate-400 group-hover:text-slate-100"
                  }`}>
                    {tab.label}
                  </span>
                  {badge != null && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono tabular-nums ${
                      isActive ? "bg-cyan-500/20 text-cyan-400" : "bg-slate-700 text-slate-400 group-hover:bg-slate-600 group-hover:text-slate-200"
                    }`}>{badge}</span>
                  )}
                </div>
                <div className={`text-[10px] mt-0.5 transition-colors duration-150 ${
                  isActive ? "text-slate-400" : "text-slate-600 group-hover:text-slate-500"
                }`}>
                  {tab.sublabel}
                </div>
              </button>
            );
          })}
        </nav>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && !data && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-slate-500">
                <div className="w-6 h-6 mb-3 mx-auto rounded-full border-2 border-slate-600 border-t-cyan-400 animate-spin" />
                <p className="text-sm">กำลังอ่าน Registry ทั้งหมด…</p>
              </div>
            </div>
          )}

          {data && (
            <>
              {active === "runtime"    && <RuntimeSection     d={data} onNavigate={nav} />}
              {active === "ai"         && <AISection          d={data} onNavigate={nav} />}
              {active === "api"        && <APISection         d={data} onNavigate={nav} />}
              {active === "modules"    && <ModuleSection      d={data} onNavigate={nav} />}
              {active === "workflow"   && <WorkflowSection    d={data} onNavigate={nav} />}
              {active === "database"   && <DatabaseSection    d={data} />}
              {active === "graph"      && <GraphSection       d={data} onNavigate={nav} />}
              {active === "build"      && <BuildDeploySection d={data} onNavigate={nav} />}
              {active === "traces"     && <TraceSection       d={data} onNavigate={nav} />}
              {active === "events"     && <EventSection       d={data} />}
              {active === "governance" && <GovernanceSection  d={data} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
