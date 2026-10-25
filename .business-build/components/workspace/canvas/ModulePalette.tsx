"use client";

import { useMemo, useState } from "react";
import { moduleRegistry } from "@/core/workspace";

// Module Palette — lists every Node the Module Registry generated. Nothing
// here is manually defined (requirement 3/4): the list is exactly
// moduleRegistry.list(), grouped by the category the registry already
// assigned. Dragging an entry onto the Canvas is the only way a Node gets
// added — the palette itself has no business logic, no DB call, no runtime.
export function ModulePalette({ onAddNode }: { onAddNode: (moduleId: string) => void }) {
  const [query, setQuery] = useState("");
  const nodes = moduleRegistry.list();

  const grouped = useMemo(() => {
    const filtered = query
      ? nodes.filter((n) => n.name.toLowerCase().includes(query.toLowerCase()) || n.id.toLowerCase().includes(query.toLowerCase()))
      : nodes;
    const groups = new Map<string, typeof nodes>();
    for (const n of filtered) {
      const list = groups.get(n.category) ?? [];
      list.push(n);
      groups.set(n.category, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [nodes, query]);

  return (
    <div className="w-64 shrink-0 h-full border-r border-stone-200 bg-white overflow-y-auto">
      <div className="p-3 border-b border-stone-100">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหา module…"
          className="w-full text-xs border border-stone-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-stone-400"
        />
      </div>
      {grouped.map(([category, items]) => (
        <div key={category} className="border-b border-stone-100">
          <div className="px-3 py-1.5 text-[10px] font-semibold text-stone-400 uppercase tracking-wide">
            {category} · {items.length}
          </div>
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/dnaos-module-id", n.id)}
              onClick={() => onAddNode(n.id)}
              title={n.metadata.filePath}
              className="w-full text-left px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 truncate block"
            >
              {n.name}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}