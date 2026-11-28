"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types (mirrors lib/runtime/trace.ts) ───────────────────────────

interface DataSource {
  table: string;
  operation: "read" | "write";
  columns?: string[];
}

interface TraceStep {
  seq: number;
  layer: string;
  module: string;
  action: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  duration_ms: number;
  timestamp: string;
  rules_applied?: string[];
  data_sources?: DataSource[];
  error?: string;
}

interface RequestTrace {
  trace_id: string;
  started_at: string;
  completed_at?: string;
  total_duration_ms?: number;
  user_input: string;
  intent?: string;
  status: "in_progress" | "completed" | "failed";
  steps: TraceStep[];
}

interface TraceDetail {
  trace: RequestTrace;
  lineage: { tables: string[]; flow: string[] };
  replay: string[];
}

// ── Constants ──────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { badge: string; dot: string }> = {
  completed:   { badge: "bg-green-100 text-green-700",  dot: "bg-green-400" },
  failed:      { badge: "bg-red-100 text-red-700",      dot: "bg-red-400" },
  in_progress: { badge: "bg-blue-100 text-blue-700",    dot: "bg-blue-400 animate-pulse" },
};

const LAYER_COLOR: Record<string, string> = {
  "cognitive":   "#7c3aed",
  "v2-rules":    "#0284c7",
  "v3-engines":  "#059669",
  "v4-ai":       "#d97706",
  "v5-presenter":"#db2777",
  "v6-executor": "#dc2626",
  "runtime":     "#6b7280",
  "supabase":    "#2563eb",
};

// ── Step Row ───────────────────────────────────────────────────────

function StepRow({ step }: { step: TraceStep }) {
  const [expanded, setExpanded] = useState(false);
  const color = LAYER_COLOR[step.layer] ?? "#9ca3af";
  const hasIO = Object.keys(step.input).length > 0 || step.output;

  return (
    <div className="border-b border-stone-800 last:border-0">
      <button
        onClick={() => hasIO && setExpanded((v) => !v)}
        className={`w-full flex items-center gap-3 px-4 py-2 text-left ${hasIO ? "hover:bg-stone-800/50" : ""} transition`}
      >
        <span className="text-[10px] text-stone-500 tabular-nums w-5 shrink-0">
          {step.seq}
        </span>
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
          style={{ background: color + "22", color }}
        >
          {step.layer}
        </span>
        <span className="text-[11px] font-mono text-stone-300 truncate flex-1">
          {step.module.split("/").slice(-1)[0]}
          <span className="text-stone-500 ml-1">→ {step.action}</span>
        </span>
        {step.error && (
          <span className="text-[10px] text-red-400 shrink-0">⚠ error</span>
        )}
        <span className="text-[10px] text-stone-500 tabular-nums shrink-0">
          {step.duration_ms}ms
        </span>
        {hasIO && (
          <span className="text-[10px] text-stone-600 shrink-0">
            {expanded ? "▲" : "▼"}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {step.error && (
            <p className="text-xs text-red-400 font-mono">{step.error}</p>
          )}
          {step.rules_applied && step.rules_applied.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {step.rules_applied.map((r) => (
                <span key={r} className="text-[10px] bg-sky-900/50 text-sky-300 px-1.5 py-0.5 rounded">
                  {r}
                </span>
              ))}
            </div>
          )}
          {step.data_sources && step.data_sources.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {step.data_sources.map((ds, i) => (
                <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${ds.operation === "write" ? "bg-amber-900/50 text-amber-300" : "bg-emerald-900/50 text-emerald-300"}`}>
                  {ds.operation} {ds.table}
                </span>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <div>
              <div className="text-stone-500 mb-1">input</div>
              <pre className="text-stone-400 overflow-auto max-h-24 bg-stone-800 p-2 rounded text-[9px]">
                {JSON.stringify(step.input, null, 2)}
              </pre>
            </div>
            {step.output && (
              <div>
                <div className="text-stone-500 mb-1">output</div>
                <pre className="text-stone-400 overflow-auto max-h-24 bg-stone-800 p-2 rounded text-[9px]">
                  {JSON.stringify(step.output, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Trace Card ─────────────────────────────────────────────────────

function TraceCard({ trace, onSelect, selected }: {
  trace: RequestTrace;
  onSelect: () => void;
  selected: boolean;
}) {
  const s = STATUS_STYLE[trace.status] ?? STATUS_STYLE.completed;
  const dur = trace.total_duration_ms != null
    ? `${trace.total_duration_ms}ms`
    : trace.completed_at
      ? `${new Date(trace.completed_at).getTime() - new Date(trace.started_at).getTime()}ms`
      : "…";

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 border-b border-stone-100 hover:bg-stone-50 transition ${selected ? "bg-violet-50 border-l-2 border-l-violet-500" : ""}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${s.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
          {trace.status}
        </span>
        <span className="text-[10px] text-stone-400 tabular-nums ml-auto">{dur}</span>
      </div>
      <div className="text-xs text-stone-700 truncate">{trace.user_input}</div>
      {trace.intent && (
        <div className="text-[10px] text-violet-600 mt-0.5 truncate">{trace.intent}</div>
      )}
      <div className="text-[10px] text-stone-400 mt-1">
        {new Date(trace.started_at).toLocaleString("th-TH")} · {trace.steps.length} steps
      </div>
    </button>
  );
}

// ── Page ───────────────────────────────────────────────────────────

export default function TracesPage() {
  const [traces, setTraces] = useState<RequestTrace[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/traces");
    const data = await res.json();
    setTraces(data.traces ?? []);
    setNote(data.note_th ?? null);
    setLoading(false);
  }, []);

  async function selectTrace(id: string) {
    if (selectedId === id) { setSelectedId(null); setDetail(null); return; }
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    const res = await fetch(`/api/traces?id=${encodeURIComponent(id)}`);
    setDetail(await res.json());
    setDetailLoading(false);
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 5_000);
    return () => clearInterval(iv);
  }, [load]);

  const selected = traces.find((t) => t.trace_id === selectedId) ?? null;

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-base font-bold text-stone-800">Traces</h1>
          <p className="text-[11px] text-stone-400">
            {loading ? "กำลังโหลด…" : `${traces.length} traces · อัปเดตทุก 5 วินาที`}
          </p>
        </div>
        <button onClick={load} className="text-[11px] text-violet-600 hover:text-violet-800">
          ↺ Refresh
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Trace list */}
        <div className="w-80 shrink-0 bg-white border-r border-stone-200 overflow-y-auto">
          {loading && (
            <div className="text-center py-8 text-stone-400 text-sm">กำลังโหลด…</div>
          )}
          {!loading && traces.length === 0 && (
            <div className="p-4 text-center">
              <p className="text-sm text-stone-400">ยังไม่มี Workflow Trace</p>
              {note && <p className="text-[11px] text-stone-400 mt-2">{note}</p>}
              <div className="mt-4 bg-stone-50 border border-stone-200 rounded-xl p-3 text-left">
                <p className="text-[10px] font-semibold text-stone-500 mb-1">Trace จะเกิดขึ้นเมื่อ:</p>
                <ul className="text-[10px] text-stone-400 space-y-0.5">
                  <li>· เรียก POST /api/chat</li>
                  <li>· เรียก POST /api/command</li>
                  <li>· ระบบประมวลผล workflow ใดๆ</li>
                </ul>
              </div>
            </div>
          )}
          {traces.map((t) => (
            <TraceCard
              key={t.trace_id}
              trace={t}
              selected={selectedId === t.trace_id}
              onSelect={() => selectTrace(t.trace_id)}
            />
          ))}
        </div>

        {/* Detail panel */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {!selectedId && (
            <div className="flex items-center justify-center h-full text-stone-400 text-sm">
              เลือก Trace จากรายการเพื่อดูรายละเอียด
            </div>
          )}
          {detailLoading && (
            <div className="flex items-center justify-center h-full text-stone-400 text-sm">
              กำลังโหลด…
            </div>
          )}
          {detail && !detailLoading && (
            <div className="p-6 space-y-4">
              {/* Header */}
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[detail.trace.status]?.badge ?? ""}`}>
                    {detail.trace.status}
                  </span>
                  {detail.trace.total_duration_ms != null && (
                    <span className="text-xs text-stone-500">
                      {detail.trace.total_duration_ms}ms รวม
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-stone-700">{detail.trace.user_input}</p>
                {detail.trace.intent && (
                  <p className="text-xs text-violet-600 mt-1">Intent: {detail.trace.intent}</p>
                )}
                <p className="text-[11px] text-stone-400 mt-1">
                  {new Date(detail.trace.started_at).toLocaleString("th-TH")}
                  {detail.trace.completed_at && ` → ${new Date(detail.trace.completed_at).toLocaleString("th-TH")}`}
                </p>
              </div>

              {/* Steps */}
              <div className="bg-stone-900 rounded-xl overflow-hidden">
                <div className="px-4 py-2 border-b border-stone-700 flex items-center justify-between">
                  <span className="text-[11px] text-stone-400 uppercase tracking-wider">
                    Steps ({detail.trace.steps.length})
                  </span>
                  <span className="text-[10px] text-stone-500">คลิกดู Input/Output</span>
                </div>
                {detail.trace.steps.length > 0 ? (
                  detail.trace.steps.map((step) => (
                    <StepRow key={step.seq} step={step} />
                  ))
                ) : (
                  <div className="px-4 py-4 text-[11px] text-stone-500">ไม่มี steps</div>
                )}
              </div>

              {/* Lineage */}
              {(detail.lineage.tables.length > 0 || detail.lineage.flow.length > 0) && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white border border-stone-200 rounded-xl p-4">
                    <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">
                      Tables ({detail.lineage.tables.length})
                    </div>
                    {detail.lineage.tables.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {detail.lineage.tables.map((t) => (
                          <span key={t} className="text-[10px] font-mono bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded">
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-stone-400">ไม่มีการเข้าถึง database</span>
                    )}
                  </div>
                  <div className="bg-white border border-stone-200 rounded-xl p-4">
                    <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-2">
                      Flow
                    </div>
                    {detail.lineage.flow.length > 0 ? (
                      <div className="space-y-0.5">
                        {detail.lineage.flow.map((f, i) => (
                          <div key={i} className="text-[10px] font-mono text-stone-600">
                            {i > 0 && <span className="text-stone-400 mr-1">→</span>}
                            {f}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-stone-400">ไม่มีข้อมูล flow</span>
                    )}
                  </div>
                </div>
              )}

              {/* Replay */}
              {detail.replay.length > 0 && (
                <div className="bg-stone-900 rounded-xl overflow-hidden">
                  <div className="px-4 py-2 border-b border-stone-700">
                    <span className="text-[11px] text-stone-400 uppercase tracking-wider">
                      Replay ({detail.replay.length} events)
                    </span>
                  </div>
                  <div className="p-4 space-y-1">
                    {detail.replay.map((event, i) => (
                      <div key={i} className="text-[11px] font-mono text-stone-400">
                        <span className="text-stone-600 mr-2">{i + 1}.</span>
                        {event}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
