"use client";

import { useState, useMemo } from "react";
import moduleRegistry from "@/registry/module-registry.json";

type ModuleData = (typeof moduleRegistry.modules)[keyof typeof moduleRegistry.modules];

/**
 * Renders a colored pill for the module status.
 */
function StatusPill({ status }: { status?: string }) {
  switch (status) {
    case "active":
      return <span className="px-2 py-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-100 rounded-full">{status}</span>;
    case "stub":
      return <span className="px-2 py-0.5 text-[10px] font-semibold text-amber-700 bg-amber-100 rounded-full">{status}</span>;
    case "deprecated":
      return <span className="px-2 py-0.5 text-[10px] font-semibold text-rose-700 bg-rose-100 rounded-full">{status}</span>;
    default:
      return <span className="px-2 py-0.5 text-[10px] font-semibold text-stone-500 bg-stone-100 rounded-full">unknown</span>;
  }
}

/**
 * Engine Explorer Page
 * This page reads `module-registry.json`, filters for modules in the 'engines' layer,
 * and provides a searchable interface to explore them.
 */
export default function EngineExplorerPage() {
  const [searchTerm, setSearchTerm] = useState("");

  // Filter the module registry to get only modules in the 'engines' layer.
  const allEngines = useMemo(() =>
    Object.entries(moduleRegistry.modules).filter(
      ([, data]) => data.layer === 'engines'
    ),
  []);

  // Filter engines based on the search term.
  const filteredEngines = useMemo(() => {
    if (!searchTerm) {
      return allEngines;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    return allEngines.filter(([path, data]) => {
      const purpose = data.purpose_th || data.purpose || "";
      const exports = (data.exports || []).join(" ");
      const searchText = `${path} ${data.owner} ${purpose} ${exports}`.toLowerCase();
      return searchText.includes(lowercasedFilter);
    });
  }, [searchTerm, allEngines]);

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-stone-200 px-6 py-4">
        <h1 className="text-base font-bold text-stone-800">Engine Explorer</h1>
        <p className="text-[11px] text-stone-400 mt-0.5">
          สำรวจ Business Logic, Workflows, และส่วนคำนวณทั้งหมด (Layer: engines)
        </p>
      </div>

      {/* Search and Summary */}
      <div className="p-6">
        <input
          type="text"
          placeholder="ค้นหาตามชื่อไฟล์, owner, purpose, exports..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 text-sm border border-stone-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
        />
        <p className="text-xs text-stone-500 mt-2">
          แสดงผล {filteredEngines.length} จากทั้งหมด {allEngines.length} โมดูล
        </p>
      </div>

      {/* Engine List */}
      <div className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredEngines.map(([path, data]) => (
          <div key={path} className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-mono text-blue-600 break-all">{path}</div>
              <StatusPill status={data.status} />
            </div>
            <div className="mt-2 text-xs text-stone-500">
              <span className="font-semibold text-stone-600">Owner:</span> {data.owner}
            </div>
            <p className="mt-2 text-xs text-stone-800 flex-1">
              {data.purpose_th || data.purpose}
            </p>
            
            {(data.exports && data.exports.length > 0) && (
              <div className="mt-3 pt-3 border-t border-stone-100">
                <h4 className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Exports / Workflows</h4>
                <div className="mt-1.5 flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
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
          </div>
        ))}
      </div>
    </div>
  );
}