"use client";

import { moduleRegistry } from "@/core/workspace";
import type { CanvasNode, CanvasConnection } from "./types";

// Module Inspector — read-only view of the selected Panel's Module Registry
// metadata plus which other Panels it's connected to on this Screen. Never
// reads anything from the module's own code, only registry data and the
// Screen's own CanvasConnection[] list.
export function ModuleInspector({
  node,
  nodes,
  connections,
}: {
  node: CanvasNode;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
}) {
  const module = moduleRegistry.get(node.moduleId);
  if (!module) return null;

  const byId = new Map(nodes.map((n) => [n.instanceId, n]));
  const connected = connections
    .filter((c) => c.fromInstanceId === node.instanceId || c.toInstanceId === node.instanceId)
    .map((c) => {
      const otherId = c.fromInstanceId === node.instanceId ? c.toInstanceId : c.fromInstanceId;
      const otherNode = byId.get(otherId);
      const otherModule = otherNode ? moduleRegistry.get(otherNode.moduleId) : undefined;
      const direction = c.fromInstanceId === node.instanceId ? "out" : "in";
      return { connectionId: c.id, name: otherModule?.name ?? otherId, direction };
    });

  return (
    <div className="p-3 text-xs space-y-3">
      <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Module Inspector</div>

      <Field label="Name" value={module.name} />
      <Field label="Icon" value={module.icon} />
      <Field label="Category" value={module.category} />
      <Field label="Status" value={module.status} />

      <div>
        <div className="text-stone-400 mb-1">Inputs</div>
        <div className="flex flex-wrap gap-1">
          {module.inputPorts.length === 0 && <span className="text-stone-300">—</span>}
          {module.inputPorts.map((p) => (
            <span key={p} className="px-1.5 py-0.5 bg-stone-100 rounded text-stone-600">{p}</span>
          ))}
        </div>
      </div>

      <div>
        <div className="text-stone-400 mb-1">Outputs</div>
        <div className="flex flex-wrap gap-1">
          {module.outputPorts.length === 0 && <span className="text-stone-300">—</span>}
          {module.outputPorts.map((p) => (
            <span key={p} className="px-1.5 py-0.5 bg-stone-100 rounded text-stone-600">{p}</span>
          ))}
        </div>
      </div>

      <div>
        <div className="text-stone-400 mb-1">Connected Modules</div>
        {connected.length === 0 && <span className="text-stone-300">—</span>}
        <ul className="space-y-1">
          {connected.map((c) => (
            <li key={c.connectionId} className="flex items-center gap-1.5 text-stone-600">
              <span className={c.direction === "out" ? "text-blue-500" : "text-emerald-600"}>
                {c.direction === "out" ? "→" : "←"}
              </span>
              {c.name}
            </li>
          ))}
        </ul>
      </div>

      <Field label="File" value={module.metadata.filePath} mono />
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-stone-400">{label}</div>
      <div className={"text-stone-700 break-all " + (mono ? "font-mono text-[10px]" : "")}>{value}</div>
    </div>
  );
}