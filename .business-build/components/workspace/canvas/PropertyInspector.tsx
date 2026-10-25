"use client";

import type { DockPosition, Visibility } from "@/core/workspace";
import type { CanvasNode } from "./types";

const DOCK_POSITIONS: DockPosition[] = ["floating", "dock-left", "dock-right", "dock-bottom", "fullscreen", "minimized"];

// Property Inspector — the only place a Panel's presentation properties are
// edited. Every change here goes through useCanvasState's setters, which
// for dockPosition/visibility delegate to screenController (Phase 0's single
// authority over attachment/placement) — this component never mutates
// attachment state directly.
export function PropertyInspector({
  node,
  onMove,
  onResize,
  onRecolor,
  onSetDockPosition,
  onSetVisibility,
}: {
  node: CanvasNode;
  onMove: (instanceId: string, x: number, y: number) => void;
  onResize: (instanceId: string, width: number, height: number) => void;
  onRecolor: (instanceId: string, color: string) => void;
  onSetDockPosition: (instanceId: string, position: DockPosition) => void;
  onSetVisibility: (instanceId: string, visibility: Visibility) => void;
}) {
  const visibility: Visibility = node.visibility ?? "visible";
  const dockPosition: DockPosition = node.dockPosition ?? "floating";

  return (
    <div className="p-3 text-xs space-y-3 border-t border-stone-100">
      <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Property Inspector</div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={node.x} onChange={(v) => onMove(node.instanceId, v, node.y)} />
        <NumberField label="Y" value={node.y} onChange={(v) => onMove(node.instanceId, node.x, v)} />
        <NumberField label="Width" value={node.width ?? 224} onChange={(v) => onResize(node.instanceId, v, node.height ?? 120)} />
        <NumberField label="Height" value={node.height ?? 120} onChange={(v) => onResize(node.instanceId, node.width ?? 224, v)} />
      </div>

      <div>
        <div className="text-stone-400 mb-1">Color</div>
        <input
          type="color"
          value={node.color ?? "#ffffff"}
          onChange={(e) => onRecolor(node.instanceId, e.target.value)}
          className="w-full h-7 rounded border border-stone-200"
        />
      </div>

      <div>
        <div className="text-stone-400 mb-1">Visibility</div>
        <div className="flex gap-1">
          {(["visible", "hidden"] as Visibility[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onSetVisibility(node.instanceId, v)}
              className={
                "flex-1 rounded-md px-2 py-1 border text-[11px] " +
                (visibility === v ? "bg-stone-900 text-white border-stone-900" : "border-stone-200 text-stone-500")
              }
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-stone-400 mb-1">Dock Position</div>
        <select
          value={dockPosition}
          onChange={(e) => onSetDockPosition(node.instanceId, e.target.value as DockPosition)}
          className="w-full text-[11px] border border-stone-200 rounded-md px-2 py-1"
        >
          {DOCK_POSITIONS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="text-stone-400 mb-0.5">{label}</div>
      <input
        type="number"
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full text-[11px] border border-stone-200 rounded-md px-1.5 py-1"
      />
    </label>
  );
}