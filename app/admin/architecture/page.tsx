"use client";

import { Suspense, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import moduleRegistry from "@/registry/module-registry.json";
import archBook from "@/registry/architecture-book.json";
import controlGraphInitial from "@/registry/system-control-graph.json";
import healthReport from "@/registry/ARCHITECTURE_HEALTH_REPORT.json";
import infrastructure from "@/registry/infrastructure.json";
import drivers from "@/registry/drivers.json";
import connectorLifecycle from "@/registry/connector-lifecycle.json";
import commandRegistry from "@/registry/command-registry.json";
import eventsRegistry from "@/registry/events.json";

type ModuleData = (typeof moduleRegistry.modules)[keyof typeof moduleRegistry.modules];
type ModuleEntry = [string, ModuleData];
type BookNode = (typeof archBook.nodes)[number];
type ControlNode = (typeof controlGraphInitial.nodes)[number];
type ControlEdge = (typeof controlGraphInitial.edges)[number];

// Real UI redesign (owner, 2026-07-31): "เฮียขอโทนสีแบบนี้เลยนะ...มันเข้าใจ
// ง่ายดี มันเห็นเส้นทางการไหล" — reusing the exact palette/typography from
// the standalone Data Flow artifact shown to the owner (dark stone ground,
// violet accent, green=deterministic/amber=AI semantic tags, monospace file
// paths) — applied here as a REAL in-app page instead of an external
// one-off artifact, per Rule 101/103 (extend the existing Registry Viewer
// page, not build a parallel one).
const theme = {
  bg: "#17140f",
  panel: "#1f1a13",
  panel2: "#262019",
  border: "#3a3226",
  text: "#ece7dc",
  muted: "#a89e8d",
  accent: "#a78bfa",
  real: "#7cb88a",
  realBg: "#1c2620",
};

function StatusTag({ status }: { status?: string }) {
  const map: Record<string, string> = {
    active: "text-emerald-400 bg-emerald-950 border-emerald-700",
    stub: "text-amber-400 bg-amber-950 border-amber-700",
    deprecated: "text-rose-400 bg-rose-950 border-rose-700",
  };
  const cls = map[status || ""] || "text-stone-400 bg-stone-800 border-stone-600";
  return (
    <span className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide rounded-full border ${cls}`}>
      {status || "unknown"}
    </span>
  );
}

function ModuleDetailModal({ module, onClose, onJumpTo }: { module: ModuleEntry | null; onClose: () => void; onJumpTo: (path: string) => void }) {
  if (!module) return null;
  const [path, data] = module;
  const bookNode = (archBook.nodes as BookNode[]).find((n) => n.id === `module:${path}`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div
        className="rounded-2xl shadow-2xl w-full max-w-2xl max-h-[82vh] flex flex-col"
        style={{ background: theme.panel, border: `1px solid ${theme.border}`, color: theme.text }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b flex items-start justify-between gap-3" style={{ borderColor: theme.border }}>
          <h3 className="font-mono text-sm break-all">{path}</h3>
          <button onClick={onClose} className="shrink-0 hover:opacity-70" style={{ color: theme.muted }}>&times;</button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          <Row label="Purpose" value={data.purpose_th || data.purpose} />
          <Row label="Layer" value={data.layer} />
          <Row label="Owner" value={data.owner} />
          <div className="grid grid-cols-3 gap-3 items-center">
            <div className="col-span-1 font-semibold" style={{ color: theme.muted }}>Status</div>
            <div className="col-span-2"><StatusTag status={data.status} /></div>
          </div>
          {(data.exports?.length ?? 0) > 0 && (
            <ChipRow label="Exports" items={data.exports as string[]} />
          )}
          {bookNode?.data_tables && Array.isArray(bookNode.data_tables) && bookNode.data_tables.length > 0 && (
            <ChipRow label="ตารางข้อมูลจริงที่แตะ" items={bookNode.data_tables as string[]} accent />
          )}
          {bookNode?.dependents && bookNode.dependents.length > 0 && (
            <div>
              <div className="font-semibold mb-1.5" style={{ color: theme.muted }}>ใครเรียกใช้ไฟล์นี้ (ต้นทาง)</div>
              <div className="flex flex-col gap-1.5">
                {bookNode.dependents.map((d) => {
                  const p = d.replace(/^module:/, "");
                  return (
                    <button key={d} onClick={() => onJumpTo(p)} className="text-left font-mono text-[11px] px-2 py-1 rounded hover:opacity-80" style={{ background: theme.panel2, color: theme.accent }}>
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {bookNode?.internal_dependencies && bookNode.internal_dependencies.length > 0 && (
            <div>
              <div className="font-semibold mb-1.5" style={{ color: theme.muted }}>ไฟล์นี้ไปเรียกใช้อะไรต่อ (ปลายทาง)</div>
              <div className="flex flex-col gap-1.5">
                {bookNode.internal_dependencies.map((d) => {
                  const p = d.replace(/^module:/, "");
                  return (
                    <button key={d} onClick={() => onJumpTo(p)} className="text-left font-mono text-[11px] px-2 py-1 rounded hover:opacity-80" style={{ background: theme.panel2, color: theme.real }}>
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="col-span-1 font-semibold" style={{ color: theme.muted }}>{label}</div>
      <div className="col-span-2">{value}</div>
    </div>
  );
}

function ChipRow({ label, items, accent }: { label: string; items: string[]; accent?: boolean }) {
  return (
    <div>
      <div className="font-semibold mb-1.5" style={{ color: theme.muted }}>{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span
            key={it}
            className="px-1.5 py-0.5 text-[10px] font-mono rounded border"
            style={accent
              ? { background: theme.realBg, color: theme.real, borderColor: theme.real }
              : { background: theme.panel2, color: theme.text, borderColor: theme.border }}
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function RegistryViewerPage() {
  return (
    <Suspense fallback={null}>
      <RegistryViewerContent />
    </Suspense>
  );
}

function RegistryViewerContent() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<"list" | "flow" | "map" | "runtime" | "health" | "infra">("list");
  const [controlGraph, setControlGraph] = useState(controlGraphInitial);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLayer, setSelectedLayer] = useState(() => searchParams.get("layer") || "");
  const [selectedOwner, setSelectedOwner] = useState("");
  const [selectedModule, setSelectedModule] = useState<ModuleEntry | null>(null);
  const [flowPath, setFlowPath] = useState<string>("");

  const { allModules, uniqueLayers, uniqueOwners } = useMemo(() => {
    const modules = Object.entries(moduleRegistry.modules);
    const layers = [...new Set(Object.values(moduleRegistry.modules).map((m) => m.layer))].sort();
    const owners = [...new Set(Object.values(moduleRegistry.modules).map((m) => m.owner))].sort();
    return { allModules: modules, uniqueLayers: layers, uniqueOwners: owners };
  }, []);

  const filteredModules = useMemo(() => {
    return allModules.filter(([path, data]) => {
      if (selectedLayer && data.layer !== selectedLayer) return false;
      if (selectedOwner && data.owner !== selectedOwner) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const purpose = data.purpose_th || data.purpose || "";
        const exports = (data.exports || []).join(" ");
        const text = `${path} ${data.layer} ${data.owner} ${purpose} ${exports}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [searchTerm, selectedLayer, selectedOwner, allModules]);

  function openModule(path: string) {
    const data = (moduleRegistry.modules as Record<string, ModuleData>)[path];
    if (data) setSelectedModule([path, data]);
  }

  return (
    <>
      <ModuleDetailModal module={selectedModule} onClose={() => setSelectedModule(null)} onJumpTo={(p) => { setFlowPath(p); setView("flow"); }} />
      <div className="min-h-screen" style={{ background: theme.bg, color: theme.text }}>
        <div className="sticky top-0 z-10 px-6 py-4" style={{ background: theme.panel, borderBottom: `1px solid ${theme.border}` }}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wide mb-1" style={{ color: theme.accent }}>DNA OS — Architecture</p>
              <h1 className="text-base font-semibold">เครื่องมือสำรวจระบบจริง</h1>
              <p className="text-[11px] mt-0.5" style={{ color: theme.muted }}>
                {view === "list" ? "ค้นหา กรอง และดูรายละเอียดทุกโมดูลในระบบ" : "เลือกโมดูลใดก็ได้ ดูว่าใครเรียกมัน มันเรียกใคร และแตะตารางข้อมูลจริงอะไรบ้าง"}
              </p>
            </div>
            <div className="flex rounded-lg overflow-hidden border flex-wrap" style={{ borderColor: theme.border }}>
              {(["list", "flow", "map", "runtime", "health", "infra"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className="px-3.5 py-1.5 text-xs font-medium transition"
                  style={view === v ? { background: theme.accent, color: "#17140f" } : { background: theme.panel2, color: theme.muted }}
                >
                  {{ list: "รายการ", flow: "ผังการไหล (โมดูล)", map: "System Map", runtime: "Runtime Flow", health: "Health & Drift", infra: "Infrastructure" }[v]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {view === "list" ? (
          <>
            <div className="p-6 space-y-4">
              <input
                type="text"
                placeholder="ค้นหาทุกอย่างใน Registry..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 text-sm rounded-lg outline-none"
                style={{ background: theme.panel, border: `1px solid ${theme.border}`, color: theme.text }}
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <select value={selectedLayer} onChange={(e) => setSelectedLayer(e.target.value)} className="w-full px-3 py-2 text-xs rounded-lg" style={{ background: theme.panel, border: `1px solid ${theme.border}`, color: theme.text }}>
                  <option value="">-- กรองตาม Layer --</option>
                  {uniqueLayers.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <select value={selectedOwner} onChange={(e) => setSelectedOwner(e.target.value)} className="w-full px-3 py-2 text-xs rounded-lg" style={{ background: theme.panel, border: `1px solid ${theme.border}`, color: theme.text }}>
                  <option value="">-- กรองตาม Owner --</option>
                  {uniqueOwners.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <div className="flex items-center justify-end text-xs" style={{ color: theme.muted }}>
                  แสดงผล {filteredModules.length} จากทั้งหมด {allModules.length} โมดูล
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredModules.map(([path, data]) => (
                <button
                  key={path}
                  onClick={() => setSelectedModule([path, data])}
                  className="p-4 rounded-xl flex flex-col text-left transition-all"
                  style={{ background: theme.panel, border: `1px solid ${theme.border}` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-mono break-all" style={{ color: theme.accent }}>{path}</div>
                    <StatusTag status={data.status} />
                  </div>
                  <div className="mt-2 text-xs" style={{ color: theme.muted }}>
                    <span style={{ color: theme.text }}>{data.layer}</span> · {data.owner}
                  </div>
                  <p className="mt-2 text-xs flex-1 line-clamp-2" style={{ color: theme.text }}>
                    {data.purpose_th || data.purpose}
                  </p>
                </button>
              ))}
            </div>
          </>
        ) : view === "flow" ? (
          <FlowView
            allModules={allModules}
            flowPath={flowPath}
            setFlowPath={setFlowPath}
            onOpenDetail={openModule}
          />
        ) : view === "map" ? (
          <SystemMapView controlGraph={controlGraph} setControlGraph={setControlGraph} />
        ) : view === "runtime" ? (
          <RuntimeFlowView controlGraph={controlGraph} />
        ) : view === "health" ? (
          <HealthDriftView controlGraph={controlGraph} />
        ) : (
          <InfrastructureView controlGraph={controlGraph} />
        )}
      </div>
    </>
  );
}

// ============================================================================
// MODE A: System Map — Owner Architecture Control Surface (owner, 2026-08-04)
// Reads registry/system-control-graph.json, generated by
// scripts/build-system-control-graph.ts, which cross-references
// architecture-book.json + command/event/capability/infrastructure/driver/
// connector registries. No graph-physics library added — a searchable/
// filterable node list + side detail panel, per the "no new heavy
// dependency" constraint, reusing the same interaction model as the
// existing flow view.
// ============================================================================
function ControlNodeDetail({ node, controlGraph, onClose, onJump }: { node: ControlNode | null; controlGraph: typeof controlGraphInitial; onClose: () => void; onJump: (id: string) => void }) {
  if (!node) return null;
  const outgoing = controlGraph.edges.filter((e) => e.source === node.id);
  const incoming = controlGraph.edges.filter((e) => e.target === node.id);
  const fields: [string, unknown][] = [
    ["id", node.id],
    ["name", node.name],
    ["type", node.type],
    ["layer", node.layer],
    ["source_file", node.source_file],
    ["status", node.status],
    ["runtime_callable", String(node.runtime_callable)],
    ["provider", node.provider],
    ["health", node.health],
    ["cost_source", node.cost_source],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" style={{ background: theme.panel, border: `1px solid ${theme.border}`, color: theme.text }} onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b flex items-start justify-between gap-3" style={{ borderColor: theme.border }}>
          <div>
            <div className="text-[10px] font-mono uppercase" style={{ color: theme.accent }}>{node.type}</div>
            <h3 className="font-mono text-sm break-all">{node.id}</h3>
          </div>
          <button onClick={onClose} className="shrink-0 hover:opacity-70" style={{ color: theme.muted }}>&times;</button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {fields.map(([k, v]) => (
            <Row key={k} label={k} value={String(v)} />
          ))}
          {(["dependencies", "dependents", "commands", "events", "capabilities"] as const).map((k) =>
            (node[k] as string[])?.length > 0 ? <ChipRow key={k} label={k} items={node[k] as string[]} /> : null
          )}
          {outgoing.length > 0 && (
            <div>
              <div className="font-semibold mb-1.5" style={{ color: theme.muted }}>Outgoing edges ({outgoing.length})</div>
              <div className="flex flex-col gap-1.5">
                {outgoing.slice(0, 30).map((e, i) => (
                  <button key={i} onClick={() => onJump(e.target)} className="text-left font-mono text-[11px] px-2 py-1 rounded hover:opacity-80" style={{ background: theme.panel2, color: theme.real }}>
                    <span style={{ color: theme.accent }}>{e.type}</span> → {e.target}
                  </button>
                ))}
              </div>
            </div>
          )}
          {incoming.length > 0 && (
            <div>
              <div className="font-semibold mb-1.5" style={{ color: theme.muted }}>Incoming edges ({incoming.length})</div>
              <div className="flex flex-col gap-1.5">
                {incoming.slice(0, 30).map((e, i) => (
                  <button key={i} onClick={() => onJump(e.source)} className="text-left font-mono text-[11px] px-2 py-1 rounded hover:opacity-80" style={{ background: theme.panel2, color: theme.accent }}>
                    {e.source} <span style={{ color: theme.real }}>{e.type}</span> →
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SystemMapView({ controlGraph, setControlGraph }: { controlGraph: typeof controlGraphInitial; setControlGraph: (g: typeof controlGraphInitial) => void }) {
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [layerFilter, setLayerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<ControlNode | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState("");

  const nodes = controlGraph.nodes as ControlNode[];
  const types = useMemo(() => [...new Set(nodes.map((n) => n.type))].sort(), [nodes]);
  const layers = useMemo(() => [...new Set(nodes.map((n) => String(n.layer)))].sort(), [nodes]);
  const statuses = useMemo(() => [...new Set(nodes.map((n) => String(n.status)))].sort(), [nodes]);

  const filtered = useMemo(() => {
    return nodes.filter((n) => {
      if (typeFilter && n.type !== typeFilter) return false;
      if (layerFilter && String(n.layer) !== layerFilter) return false;
      if (statusFilter && String(n.status) !== statusFilter) return false;
      if (q) {
        const text = `${n.id} ${n.name} ${n.source_file}`.toLowerCase();
        if (!text.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [nodes, typeFilter, layerFilter, statusFilter, q]);

  function jump(id: string) {
    const n = nodes.find((x) => x.id === id);
    if (n) setSelected(n);
  }

  async function refresh() {
    setRefreshing(true);
    setRefreshMsg("");
    try {
      const res = await fetch("/api/admin/architecture/control-graph");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setControlGraph(json);
      setRefreshMsg(`โหลดใหม่สำเร็จ — generated_at: ${json.generated_at}`);
    } catch (e) {
      setRefreshMsg(`โหลดล้มเหลว: ${(e as Error).message} — รัน npm run architecture:generate แล้วลองใหม่`);
    } finally {
      setRefreshing(false);
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ generated_at: controlGraph.generated_at, filtered_nodes: filtered }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "system-control-graph-view.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-4">
      <ControlNodeDetail node={selected} controlGraph={controlGraph} onClose={() => setSelected(null)} onJump={jump} />
      <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: theme.muted }}>
        <span>Generated: {controlGraph.generated_at}</span>
        <span>·</span>
        <span>{controlGraph.nodes.length} nodes / {controlGraph.edges.length} edges</span>
        <button onClick={refresh} disabled={refreshing} className="px-2 py-1 rounded font-mono text-[10px]" style={{ background: theme.panel2, color: theme.accent, border: `1px solid ${theme.border}` }}>
          {refreshing ? "กำลังโหลด..." : "↻ Refresh"}
        </button>
        <button onClick={exportJson} className="px-2 py-1 rounded font-mono text-[10px]" style={{ background: theme.panel2, color: theme.text, border: `1px solid ${theme.border}` }}>
          Export view JSON
        </button>
        {refreshMsg && <span>{refreshMsg}</span>}
      </div>
      <input type="text" placeholder="ค้นหา node (id / name / source_file)..." value={q} onChange={(e) => setQ(e.target.value)} className="w-full px-4 py-2 text-sm rounded-lg outline-none" style={{ background: theme.panel, border: `1px solid ${theme.border}`, color: theme.text }} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full px-3 py-2 text-xs rounded-lg" style={{ background: theme.panel, border: `1px solid ${theme.border}`, color: theme.text }}>
          <option value="">-- Type --</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={layerFilter} onChange={(e) => setLayerFilter(e.target.value)} className="w-full px-3 py-2 text-xs rounded-lg" style={{ background: theme.panel, border: `1px solid ${theme.border}`, color: theme.text }}>
          <option value="">-- Layer/Domain --</option>
          {layers.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full px-3 py-2 text-xs rounded-lg" style={{ background: theme.panel, border: `1px solid ${theme.border}`, color: theme.text }}>
          <option value="">-- Status --</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="text-xs" style={{ color: theme.muted }}>แสดง {filtered.length} จาก {nodes.length} nodes</div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.slice(0, 300).map((n) => (
          <button key={n.id} onClick={() => setSelected(n)} className="p-3 rounded-xl text-left" style={{ background: theme.panel, border: `1px solid ${theme.border}` }}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[10px] font-mono uppercase" style={{ color: theme.accent }}>{n.type}</span>
              <StatusTag status={String(n.status)} />
            </div>
            <div className="text-xs font-mono mt-1 break-all" style={{ color: theme.text }}>{n.name}</div>
            <div className="text-[10px] mt-1" style={{ color: theme.muted }}>{String(n.layer)}</div>
          </button>
        ))}
      </div>
      {filtered.length > 300 && <div className="text-[11px] text-center" style={{ color: theme.muted }}>...และอีก {filtered.length - 300} รายการ กรุณากรองเพิ่มเติม</div>}
    </div>
  );
}

// ============================================================================
// MODE B: Runtime Flow — pick a real command or event, show its real path
// (entry → owner module → what it imports/is imported by → DB tables it
// touches). UNKNOWN hops are shown explicitly, never invented.
// ============================================================================
function RuntimeFlowView({ controlGraph }: { controlGraph: typeof controlGraphInitial }) {
  const [kind, setKind] = useState<"command" | "event">("command");
  const [name, setName] = useState("");
  const nodes = controlGraph.nodes as ControlNode[];
  const bookNodes = archBook.nodes as BookNode[];

  const options = kind === "command" ? Object.keys(commandRegistry.commands) : Object.keys(eventsRegistry.events);
  const nodeId = kind === "command" ? `command:${name}` : `event:${name}`;
  const node = nodes.find((n) => n.id === nodeId);
  const ownerModulePath = node?.source_file && node.source_file !== "UNKNOWN" ? node.source_file : null;
  const ownerBookNode = ownerModulePath ? bookNodes.find((n) => n.id === `module:${ownerModulePath}`) : null;
  const tables = ownerBookNode && Array.isArray(ownerBookNode.data_tables) ? (ownerBookNode.data_tables as string[]) : [];

  const steps: { label: string; value: string; known: boolean }[] = [
    { label: "Entry (User/Workspace)", value: kind === "command" ? "Command invocation" : "Event emission", known: true },
    { label: "Gateway", value: "UNKNOWN — not derivable from command/events registry (no gateway-hop field)", known: false },
    {
      label: kind === "command" ? "Owner module (command-registry.json → owner)" : "Source layer (events.json → source)",
      value: kind === "command" ? (ownerModulePath ?? "UNKNOWN") : String(node?.layer ?? "UNKNOWN"),
      known: kind === "command" ? !!ownerModulePath : node?.layer !== "UNKNOWN",
    },
    {
      label: "Downstream (module imports, from architecture-book.json)",
      value: ownerBookNode?.internal_dependencies?.length ? ownerBookNode.internal_dependencies.join(", ") : "UNKNOWN / none derived",
      known: !!ownerBookNode?.internal_dependencies?.length,
    },
    {
      label: "Database tables touched (data_tables)",
      value: tables.length ? tables.join(", ") : "UNKNOWN",
      known: tables.length > 0,
    },
    { label: "Event/Result", value: "UNKNOWN — no result/emits linkage field exists in command-registry.json today", known: false },
  ];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex gap-2">
        {(["command", "event"] as const).map((k) => (
          <button key={k} onClick={() => { setKind(k); setName(""); }} className="px-3 py-1.5 text-xs rounded-lg" style={kind === k ? { background: theme.accent, color: "#17140f" } : { background: theme.panel2, color: theme.muted }}>
            {k === "command" ? `Command (${Object.keys(commandRegistry.commands).length})` : `Event (${Object.keys(eventsRegistry.events).length})`}
          </button>
        ))}
      </div>
      <select value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 text-xs rounded-lg" style={{ background: theme.panel, border: `1px solid ${theme.border}`, color: theme.text }}>
        <option value="">-- เลือก {kind} --</option>
        {options.sort().map((o) => <option key={o} value={o}>{o}</option>)}
      </select>

      {!name ? (
        <div className="text-center py-16 text-sm" style={{ color: theme.muted }}>เลือก command หรือ event ด้านบนเพื่อดูเส้นทางจริงของมันในระบบ</div>
      ) : (
        <div className="space-y-3">
          {steps.map((s, i) => (
            <div key={i}>
              <div className="rounded-xl p-4" style={{ background: theme.panel, border: `1px solid ${s.known ? theme.real : theme.border}` }}>
                <div className="text-[10px] font-mono uppercase mb-1" style={{ color: s.known ? theme.real : theme.muted }}>{s.label}</div>
                <div className="text-xs font-mono break-all" style={{ color: s.known ? theme.text : theme.muted }}>{s.value}</div>
              </div>
              {i < steps.length - 1 && <div className="flex justify-center py-1" style={{ color: theme.accent }}>↓</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MODE C: Health & Drift — real counts from architecture-book.json summary +
// ARCHITECTURE_HEALTH_REPORT.json (circular deps already detected by
// scripts/arch-health-report.ts, reused here per Rule 103, not recomputed).
// ============================================================================
function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="p-4 rounded-xl" style={{ background: theme.panel, border: `1px solid ${theme.border}` }}>
      <div className="text-[10px] uppercase font-mono" style={{ color: theme.muted }}>{label}</div>
      <div className="text-xl font-semibold mt-1" style={{ color: tone || theme.text }}>{value}</div>
    </div>
  );
}

function HealthDriftView({ controlGraph }: { controlGraph: typeof controlGraphInitial }) {
  const s = archBook.summary as { total: number; ok: number; broken: number; unused: number; unregistered: number };
  const hr = healthReport as unknown as {
    generated_at: string;
    registry_completeness_pct: number;
    circular_dependencies: { count: number; cycles: string[][] };
    duplicate_registrations: { count: number; entries: { basename: string; paths: string[] }[] };
    missing_metadata: Record<string, number>;
  };
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="text-[11px]" style={{ color: theme.muted }}>
        Module graph last generated: {archBook.generated_at} · Health report generated: {hr.generated_at} · Control graph generated: {controlGraph.generated_at}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total modules" value={s.total} />
        <StatCard label="OK" value={s.ok} tone={theme.real} />
        <StatCard label="Broken" value={s.broken} tone="#f87171" />
        <StatCard label="Unused" value={s.unused} tone="#fbbf24" />
        <StatCard label="Unregistered" value={s.unregistered} tone="#fbbf24" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label="Registry completeness" value={`${hr.registry_completeness_pct}%`} />
        <StatCard label="Circular dependencies" value={hr.circular_dependencies?.count ?? "UNKNOWN"} tone={hr.circular_dependencies?.count ? "#f87171" : theme.real} />
        <StatCard label="Duplicate registrations" value={hr.duplicate_registrations?.count ?? "UNKNOWN"} tone={hr.duplicate_registrations?.count ? "#fbbf24" : theme.real} />
      </div>
      {hr.circular_dependencies?.cycles?.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: theme.muted }}>Circular dependency cycles (from scripts/arch-health-report.ts)</div>
          {hr.circular_dependencies.cycles.map((cycle, i) => (
            <div key={i} className="p-3 rounded-lg font-mono text-[11px] mb-2" style={{ background: theme.panel, border: `1px solid #f87171`, color: theme.text }}>
              {cycle.join(" → ")}
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: theme.muted }}>Missing metadata (honestly UNKNOWN, not fabricated)</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Object.entries(hr.missing_metadata || {}).filter(([k]) => k !== "note").map(([k, v]) => (
            <StatCard key={k} label={k} value={String(v)} />
          ))}
        </div>
      </div>
      {hr.duplicate_registrations?.entries?.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: theme.muted }}>Duplicate registrations (same basename, multiple paths)</div>
          <div className="space-y-2">
            {hr.duplicate_registrations.entries.slice(0, 10).map((d, i) => (
              <div key={i} className="p-3 rounded-lg" style={{ background: theme.panel, border: `1px solid ${theme.border}` }}>
                <div className="font-mono text-xs" style={{ color: theme.accent }}>{d.basename}</div>
                <div className="text-[10px] mt-1" style={{ color: theme.muted }}>{d.paths.length} paths</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MODE D: Infrastructure — real services/drivers/connector stages from
// infrastructure.json / drivers.json / connector-lifecycle.json. AI Model /
// Compute Provider / Server-Pod dimensions explicitly marked NOT_IMPLEMENTED
// — confirmed by direct search: AI_REGISTRY.json is an AI-AGENT
// compatibility directory, not a runtime model/compute registry; no such
// registry exists in this repo today.
// ============================================================================
function NotImplementedBlock({ dimension, reason }: { dimension: string; reason: string }) {
  return (
    <div className="p-4 rounded-xl" style={{ background: "#2a1a1a", border: `1px dashed #f87171` }}>
      <div className="text-[10px] font-mono uppercase" style={{ color: "#f87171" }}>NOT_IMPLEMENTED — {dimension}</div>
      <div className="text-xs mt-1" style={{ color: theme.muted }}>{reason}</div>
    </div>
  );
}

function InfrastructureView({ controlGraph }: { controlGraph: typeof controlGraphInitial }) {
  const services = Object.entries(infrastructure.services as Record<string, any>);
  const driverEntries = Object.entries(drivers.drivers as Record<string, any>);
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: theme.muted }}>Compute / Infrastructure Services (registry/infrastructure.json — {services.length})</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {services.map(([key, svc]) => (
            <div key={key} className="p-3 rounded-xl" style={{ background: theme.panel, border: `1px solid ${theme.border}` }}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-xs" style={{ color: theme.accent }}>{svc.name}</span>
                <StatusTag status={svc.status} />
              </div>
              <div className="text-[10px] mt-1" style={{ color: theme.muted }}>organ: {svc.organ} · critical: {String(svc.critical)}</div>
              <div className="text-[10px] mt-1" style={{ color: theme.muted }}>cost: {svc.cost_monthly_thb} THB/mo ({svc.plan})</div>
              {svc.dependency_graph?.modules?.length > 0 && (
                <div className="text-[10px] mt-1" style={{ color: theme.real }}>{svc.dependency_graph.modules.length} module(s) depend on this</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: theme.muted }}>Drivers (registry/drivers.json — {driverEntries.length})</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {driverEntries.map(([key, d]) => (
            <div key={key} className="p-3 rounded-xl" style={{ background: theme.panel, border: `1px solid ${theme.border}` }}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-xs" style={{ color: theme.accent }}>{key}</span>
                <StatusTag status={d.status} />
              </div>
              <div className="text-[10px] mt-1 font-mono break-all" style={{ color: theme.muted }}>{d.module}</div>
              <div className="text-[10px] mt-1" style={{ color: theme.muted }}>platform: {d.platform}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: theme.muted }}>Connector Lifecycle (registry/connector-lifecycle.json)</div>
        <div className="flex gap-2 flex-wrap">
          {(connectorLifecycle.stages as string[]).map((stg, i) => (
            <div key={stg} className="flex items-center gap-2">
              <span className="px-3 py-1.5 rounded-full text-[11px] font-mono" style={{ background: theme.realBg, color: theme.real, border: `1px solid ${theme.real}` }}>{stg}</span>
              {i < (connectorLifecycle.stages as string[]).length - 1 && <span style={{ color: theme.accent }}>→</span>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: theme.muted }}>Dimensions not tracked by any registry today</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <NotImplementedBlock dimension="AI Model Registry" reason="No runtime AI-model registry exists. registry/AI_REGISTRY.json is an AI-agent compatibility directory (which coding-AI agents are compatible with this repo), not a record of which LLM/model each runtime call uses." />
          <NotImplementedBlock dimension="Compute Provider Registry" reason="No structured record of which compute provider (e.g. RunPod, Vercel functions, local) backs each runtime call — only registry/infrastructure.json's service-level entries (Supabase, etc.) exist." />
          <NotImplementedBlock dimension="Server / Pod Registry" reason="No registry tracks individual server/pod instances, their health, or their cost independent of the top-level infrastructure.json service entry." />
        </div>
      </div>
    </div>
  );
}

// Flow View (owner, 2026-07-31): "เห็นเส้นทางการไหลว่าอันนี้ไปหา Chat LINE
// นะ...อันนี้เป็นโมดูลรับ GPS...ข้อมูลวิ่งมาตรงตารางไหน" — real, not curated
// fake examples: picks ANY of the 548 real modules and shows its REAL
// upstream (who imports it) and downstream (what it imports) from
// registry/architecture-book.json's own dependency graph, plus the real DB
// tables it touches (data_tables) — the same data the 3D graph
// (app/admin/graph) already computes, just presented as readable flow
// cards instead of a 3D node cloud, per the owner's explicit preference.
function FlowView({
  allModules,
  flowPath,
  setFlowPath,
  onOpenDetail,
}: {
  allModules: ModuleEntry[];
  flowPath: string;
  setFlowPath: (p: string) => void;
  onOpenDetail: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const bookNodes = archBook.nodes as BookNode[];

  const suggestions = useMemo(() => {
    if (!query) return [];
    const q = query.toLowerCase();
    return allModules
      .filter(([path, data]) => path.toLowerCase().includes(q) || (data.purpose_th || "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, allModules]);

  const current = bookNodes.find((n) => n.id === `module:${flowPath}`);
  const upstream = current?.dependents ?? [];
  const downstream = current?.internal_dependencies ?? [];
  const tables = Array.isArray(current?.data_tables) ? (current!.data_tables as string[]) : [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="relative mb-8">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="พิมพ์ชื่อไฟล์หรือคำอธิบาย เช่น 'เอกสาร', 'GPS', 'LINE', 'สลิป'..."
          className="w-full px-4 py-2.5 text-sm rounded-lg outline-none"
          style={{ background: theme.panel, border: `1px solid ${theme.border}`, color: theme.text }}
        />
        {suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg overflow-hidden" style={{ background: theme.panel, border: `1px solid ${theme.border}` }}>
            {suggestions.map(([path, data]) => (
              <button
                key={path}
                onClick={() => { setFlowPath(path); setQuery(""); }}
                className="w-full text-left px-3 py-2 text-xs hover:opacity-80 border-b last:border-b-0"
                style={{ borderColor: theme.border }}
              >
                <div className="font-mono" style={{ color: theme.accent }}>{path}</div>
                <div style={{ color: theme.muted }} className="line-clamp-1 mt-0.5">{data.purpose_th || data.purpose}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {!current ? (
        <div className="text-center py-20 text-sm" style={{ color: theme.muted }}>
          ค้นหาไฟล์ที่จะดูผังการไหลด้านบนครับ — เช่นไฟล์ที่เกี่ยวกับปัญหาที่กำลังเช็คอยู่
        </div>
      ) : (
        <div className="space-y-4">
          {upstream.length > 0 && (
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wide mb-2" style={{ color: theme.muted }}>ต้นทาง — ใครเรียกไฟล์นี้ ({upstream.length})</div>
              <div className="flex flex-col gap-2">
                {upstream.map((d) => <FlowCard key={d} id={d} onClick={onOpenDetail} onTrace={setFlowPath} />)}
              </div>
            </div>
          )}

          <div className="flex justify-center py-1" style={{ color: theme.accent }}>↓</div>

          <div className="rounded-xl p-5" style={{ background: theme.panel, border: `2px solid ${theme.accent}` }}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-mono text-sm" style={{ color: theme.accent }}>{flowPath}</div>
              <button onClick={() => onOpenDetail(flowPath)} className="text-[11px] shrink-0 hover:opacity-70" style={{ color: theme.muted }}>รายละเอียด →</button>
            </div>
            <p className="text-xs mt-2">{current.purpose_th}</p>
            {tables.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tables.map((t) => (
                  <span key={t} className="px-1.5 py-0.5 text-[10px] font-mono rounded border" style={{ background: theme.realBg, color: theme.real, borderColor: theme.real }}>
                    ตาราง: {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-center py-1" style={{ color: theme.accent }}>↓</div>

          {downstream.length > 0 && (
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wide mb-2" style={{ color: theme.muted }}>ปลายทาง — ไฟล์นี้ไปเรียกอะไรต่อ ({downstream.length})</div>
              <div className="flex flex-col gap-2">
                {downstream.map((d) => <FlowCard key={d} id={d} onClick={onOpenDetail} onTrace={setFlowPath} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FlowCard({ id, onClick, onTrace }: { id: string; onClick: (p: string) => void; onTrace: (p: string) => void }) {
  const path = id.replace(/^module:/, "");
  const node = (archBook.nodes as BookNode[]).find((n) => n.id === id);
  return (
    <div className="rounded-lg p-3 flex items-start justify-between gap-3" style={{ background: theme.panel, border: `1px solid ${theme.border}` }}>
      <div className="min-w-0">
        <div className="font-mono text-xs truncate" style={{ color: theme.text }}>{path}</div>
        {node?.purpose_th && <div className="text-[11px] mt-1 line-clamp-2" style={{ color: theme.muted }}>{node.purpose_th}</div>}
      </div>
      <div className="flex gap-1.5 shrink-0">
        <button onClick={() => onTrace(path)} className="text-[10px] px-2 py-1 rounded font-mono" style={{ background: theme.panel2, color: theme.accent }}>ตามไป →</button>
        <button onClick={() => onClick(path)} className="text-[10px] px-2 py-1 rounded font-mono" style={{ background: theme.panel2, color: theme.muted }}>ดู</button>
      </div>
    </div>
  );
}
