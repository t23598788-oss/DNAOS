"use client";

import { useRef } from "react";
import {
  Server, LayoutGrid, Cpu, Calculator, DoorOpen, Brain, MonitorSmartphone,
  Plug, Puzzle, Database, Component, PaintBucket, Settings, Terminal, Shield, Box,
} from "lucide-react";
import { moduleRegistry } from "@/core/workspace";
import type { CanvasNode } from "./types";

const ICONS: Record<string, React.ElementType> = {
  Server, LayoutGrid, Cpu, Calculator, DoorOpen, Brain, MonitorSmartphone,
  Plug, Puzzle, Database, Component, PaintBucket, Settings, Terminal, Shield, Box,
};

// Renders one placed module. Purely presentational — reads the module's
// name/icon/category/ports/status from Module Registry (never the module's
// own code) and reports drag/select gestures upward. It has no idea what
// the module actually does at runtime.
export function NodeRenderer({
  node,
  selected,
  docked = false,
  onMove,
  onSelect,
  onRemove,
  onPortDragStart,
  onPortDrop,
  onDragEnd,
}: {
  node: CanvasNode;
  selected: boolean;
  // Docked mode (Dock System, Phase 3B): rendered as a static block inside
  // a fixed Left/Right/Bottom dock slot, not absolutely positioned or
  // draggable — position there is "which dock slot", not x/y.
  docked?: boolean;
  onMove: (instanceId: string, x: number, y: number) => void;
  onSelect: (instanceId: string, additive: boolean) => void;
  onRemove: (instanceId: string) => void;
  onPortDragStart: (instanceId: string, port: string) => void;
  onPortDrop: (instanceId: string, port: string) => void;
  // Cross-screen move (Phase 3C) — reports the release point so Canvas can
  // check whether it landed on a Screen tab. Reuses the same pointer-drag
  // gesture as in-canvas repositioning rather than a second (native HTML5)
  // drag mechanism, which would conflict with it.
  onDragEnd?: (instanceId: string, clientX: number, clientY: number) => void;
}) {
  const module = moduleRegistry.get(node.moduleId);
  const dragOrigin = useRef<{ px: number; py: number; nx: number; ny: number } | null>(null);

  if (!module) return null;
  const Icon = ICONS[module.icon] ?? Box;

  function handlePointerDown(e: React.PointerEvent) {
    if (docked) return onSelect(node.instanceId, e.shiftKey);
    if ((e.target as HTMLElement).dataset.port) return; // let port handles own their own drag
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragOrigin.current = { px: e.clientX, py: e.clientY, nx: node.x, ny: node.y };
    onSelect(node.instanceId, e.shiftKey);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (docked || !dragOrigin.current) return;
    const { px, py, nx, ny } = dragOrigin.current;
    onMove(node.instanceId, nx + (e.clientX - px), ny + (e.clientY - py));
  }

  function handlePointerUp(e: React.PointerEvent) {
    const wasDragging = dragOrigin.current !== null;
    dragOrigin.current = null;
    if (wasDragging) onDragEnd?.(node.instanceId, e.clientX, e.clientY);
  }

  return (
    <div
      className={
        (docked ? "relative w-full mb-2" : "absolute cursor-grab active:cursor-grabbing") +
        " rounded-xl border shadow-sm select-none " +
        (selected ? "border-blue-500 ring-2 ring-blue-200" : "border-stone-200")
      }
      style={
        docked
          ? { backgroundColor: node.color ?? "#ffffff" }
          : { left: node.x, top: node.y, width: node.width ?? 224, height: node.height ?? "auto", backgroundColor: node.color ?? "#ffffff" }
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-100">
        <Icon size={14} className="text-stone-500 shrink-0" />
        <span className="text-xs font-semibold text-stone-800 truncate flex-1">{module.name}</span>
        <span
          className={
            "w-1.5 h-1.5 rounded-full shrink-0 " +
            (module.status === "active" ? "bg-emerald-500" : "bg-stone-300")
          }
          title={module.status}
        />
        <button
          type="button"
          onClick={() => onRemove(node.instanceId)}
          className="text-stone-300 hover:text-red-500 text-xs leading-none px-1"
        >
          ×
        </button>
      </div>
      <div className="px-3 py-1.5 text-[10px] text-stone-400 uppercase tracking-wide">{module.category}</div>

      <div className="flex justify-between px-2 pb-2">
        <div className="flex flex-col gap-1">
          {module.inputPorts.slice(0, 3).map((port) => (
            <div key={port} className="flex items-center gap-1 text-[10px] text-stone-500">
              <span
                data-port={port}
                onPointerUp={() => onPortDrop(node.instanceId, port)}
                className="w-2 h-2 rounded-full bg-stone-300 hover:bg-blue-400 cursor-crosshair"
              />
              {port}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1 items-end">
          {module.outputPorts.slice(0, 3).map((port) => (
            <div key={port} className="flex items-center gap-1 text-[10px] text-stone-500">
              {port}
              <span
                data-port={port}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onPortDragStart(node.instanceId, port);
                }}
                className="w-2 h-2 rounded-full bg-stone-300 hover:bg-blue-400 cursor-crosshair"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}