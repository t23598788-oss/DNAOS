"use client";

import { Suspense, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import moduleRegistry from "@/registry/module-registry.json";
import archBook from "@/registry/architecture-book.json";

type ModuleData = (typeof moduleRegistry.modules)[keyof typeof moduleRegistry.modules];
type ModuleEntry = [string, ModuleData];
type BookNode = (typeof archBook.nodes)[number];

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
  const [view, setView] = useState<"list" | "flow">("list");
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
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: theme.border }}>
              {(["list", "flow"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className="px-3.5 py-1.5 text-xs font-medium transition"
                  style={view === v ? { background: theme.accent, color: "#17140f" } : { background: theme.panel2, color: theme.muted }}
                >
                  {v === "list" ? "รายการ" : "ผังการไหล"}
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
        ) : (
          <FlowView
            allModules={allModules}
            flowPath={flowPath}
            setFlowPath={setFlowPath}
            onOpenDetail={openModule}
          />
        )}
      </div>
    </>
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
