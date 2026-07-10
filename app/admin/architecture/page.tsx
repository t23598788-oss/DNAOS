"use client";

import { Suspense, useState, useMemo, Fragment } from "react";
import { useSearchParams } from "next/navigation";
import moduleRegistry from "@/registry/module-registry.json";
import arch from "@/registry/architecture.json";

type ModuleData = (typeof moduleRegistry.modules)[keyof typeof moduleRegistry.modules];
type ModuleEntry = [string, ModuleData];

/**
 * Renders a colored pill for the module status.
 */
function StatusPill({ status }: { status?: string }) {
  const statusMap: { [key: string]: string } = {
    active: "text-emerald-700 bg-emerald-100",
    stub: "text-amber-700 bg-amber-100",
    deprecated: "text-rose-700 bg-rose-100",
  };
  const style = statusMap[status || ''] || "text-stone-500 bg-stone-100";
  return <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${style}`}>{status || 'unknown'}</span>;
}

/**
 * Modal component to display the full details of a selected module.
 */
function ModuleDetailModal({ module, onClose }: { module: ModuleEntry | null; onClose: () => void }) {
  if (!module) return null;

  const [path, data] = module;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200">
          <h3 className="font-bold text-stone-800 font-mono text-sm break-all">{path}</h3>
          <button onClick={onClose} className="absolute top-4 right-4 text-stone-400 hover:text-stone-700">&times;</button>
        </div>
        <div className="p-5 overflow-y-auto">
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div className="col-span-1 font-semibold text-stone-500">Purpose</div>
            <div className="col-span-2 text-stone-800">{data.purpose_th || data.purpose}</div>

            <div className="col-span-1 font-semibold text-stone-500">Layer</div>
            <div className="col-span-2 text-stone-800">{data.layer}</div>

            <div className="col-span-1 font-semibold text-stone-500">Owner</div>
            <div className="col-span-2 text-stone-800">{data.owner}</div>

            <div className="col-span-1 font-semibold text-stone-500">Status</div>
            <div className="col-span-2"><StatusPill status={data.status} /></div>

            {(data.exports && data.exports.length > 0) && (
              <>
                <div className="col-span-1 font-semibold text-stone-500">Exports</div>
                <div className="col-span-2 flex flex-wrap gap-1.5">
                  {(data.exports as string[]).map(exp => (
                    <span key={exp} className="px-1.5 py-0.5 text-[10px] font-mono bg-stone-100 text-stone-600 rounded">{exp}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The main Registry Viewer page.
 * Provides searching, filtering, and detailed viewing of all modules in the system.
 * Deep-linkable via ?layer= (e.g. from the Landing Page's Platform Overview cards).
 */
export default function RegistryViewerPage() {
  return (
    <Suspense fallback={null}>
      <RegistryViewerContent />
    </Suspense>
  );
}

function RegistryViewerContent() {
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLayer, setSelectedLayer] = useState(() => searchParams.get("layer") || "");
  const [selectedOwner, setSelectedOwner] = useState("");
  const [selectedModule, setSelectedModule] = useState<ModuleEntry | null>(null);

  const { allModules, uniqueLayers, uniqueOwners } = useMemo(() => {
    const modules = Object.entries(moduleRegistry.modules);
    const layers = [...new Set(Object.values(moduleRegistry.modules).map(m => m.layer))].sort();
    const owners = [...new Set(Object.values(moduleRegistry.modules).map(m => m.owner))].sort();
    return { allModules: modules, uniqueLayers: layers, uniqueOwners: owners };
  }, []);

  const filteredModules = useMemo(() => {
    return allModules.filter(([path, data]) => {
      // Layer filter
      if (selectedLayer && data.layer !== selectedLayer) return false;
      // Owner filter
      if (selectedOwner && data.owner !== selectedOwner) return false;
      // Search term filter
      if (searchTerm) {
        const lowercasedFilter = searchTerm.toLowerCase();
        const purpose = data.purpose_th || data.purpose || "";
        const exports = (data.exports || []).join(" ");
        const searchText = `${path} ${data.layer} ${data.owner} ${purpose} ${exports}`.toLowerCase();
        if (!searchText.includes(lowercasedFilter)) return false;
      }
      return true;
    });
  }, [searchTerm, selectedLayer, selectedOwner, allModules]);

  return (
    <>
      <ModuleDetailModal module={selectedModule} onClose={() => setSelectedModule(null)} />
      <div className="min-h-screen bg-stone-50">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-stone-200 px-6 py-4">
          <h1 className="text-base font-bold text-stone-800">Registry Viewer</h1>
          <p className="text-[11px] text-stone-400 mt-0.5">
            เครื่องมือสำรวจ ค้นหา และกรองทุกโมดูลในระบบ
          </p>
        </div>

        {/* Search and Filters */}
        <div className="p-6 space-y-4">
          <input
            type="text"
            placeholder="ค้นหาทุกอย่างใน Registry..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <select
              value={selectedLayer}
              onChange={(e) => setSelectedLayer(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">-- กรองตาม Layer --</option>
              {uniqueLayers.map(layer => <option key={layer} value={layer}>{layer}</option>)}
            </select>
            <select
              value={selectedOwner}
              onChange={(e) => setSelectedOwner(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">-- กรองตาม Owner --</option>
              {uniqueOwners.map(owner => <option key={owner} value={owner}>{owner}</option>)}
            </select>
            <div className="flex items-center justify-end text-xs text-stone-500">
              แสดงผล {filteredModules.length} จากทั้งหมด {allModules.length} โมดูล
            </div>
          </div>
        </div>

        {/* Module List */}
        <div className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredModules.map(([path, data]) => (
            <button
              key={path}
              onClick={() => setSelectedModule([path, data])}
              className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm flex flex-col text-left hover:border-blue-400 hover:ring-2 hover:ring-blue-100 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs font-mono text-blue-600 break-all">{path}</div>
                <StatusPill status={data.status} />
              </div>
              <div className="mt-2 text-xs text-stone-500">
                <span className="font-semibold text-stone-600">Layer:</span> {data.layer} | <span className="font-semibold text-stone-600">Owner:</span> {data.owner}
              </div>
              <p className="mt-2 text-xs text-stone-800 flex-1 line-clamp-2">
                {data.purpose_th || data.purpose}
              </p>
              
              {(data.exports && data.exports.length > 0) && (
                <div className="mt-3 pt-3 border-t border-stone-100">
                  <h4 className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Exports</h4>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
                    {(data.exports as string[]).map((exp) => (
                      <span
                        key={exp}
                        className="px-1.5 py-0.5 text-[10px] font-mono bg-stone-100 text-stone-600 rounded"
                      >
                        {exp}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}