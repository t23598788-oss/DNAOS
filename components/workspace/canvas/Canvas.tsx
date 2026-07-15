"use client";

import { useMemo, useRef, useState } from "react";
import { moduleRegistry } from "@/core/workspace";
import { workspaceLayoutStore } from "@/core/workspace/workspaceLayout";
import { useCanvasState } from "./useCanvasState";
import { NodeRenderer } from "./NodeRenderer";
import { ConnectionLayer } from "./ConnectionLayer";
import { ModulePalette } from "./ModulePalette";
import { ModuleInspector } from "./ModuleInspector";
import { PropertyInspector } from "./PropertyInspector";
import type { WorkspaceLayout, CanvasNode } from "./types";

// Visual Canvas — Visual Operating Layer (Phase 3B). Composes Module
// Palette, the pan/zoom floating surface, the Dock System (left/right/
// bottom/fullscreen/minimized), the Module + Property Inspectors, and
// Workspace/Screen management. It never imports a business module, an
// engine, a service, or a database call — everything it draws comes from
// Module Registry (metadata only) and the layout JSON in
// core/workspace/workspaceLayout.ts. Dock/visibility changes always go
// through useCanvasState's setDockPosition/setVisibility, which delegate to
// screenController — this file never mutates attachment state itself.
export function Canvas({ initialLayout }: { initialLayout: WorkspaceLayout }) {
  const state = useCanvasState(initialLayout);
  const panOrigin = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  const dragScreenIndex = useRef<number | null>(null);
  const screenTabRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [pendingConnection, setPendingConnection] = useState<{ instanceId: string; port: string } | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceLayout[]>(() => workspaceLayoutStore.list());

  // Cross-screen move (Phase 3C): a node's pointer-drag ended at this point —
  // check whether it landed on a Screen tab other than the one it came from.
  function handleNodeDragEnd(instanceId: string, clientX: number, clientY: number) {
    for (const [screenId, el] of screenTabRefs.current) {
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        if (screenId !== state.activeScreenId) state.moveNodeToScreen(instanceId, screenId);
        return;
      }
    }
  }

  const visible = state.nodes.filter((n) => (n.visibility ?? "visible") === "visible");
  const fullscreenNode = visible.find((n) => n.dockPosition === "fullscreen");
  const floating = visible.filter((n) => !n.dockPosition || n.dockPosition === "floating");
  const dockLeft = visible.filter((n) => n.dockPosition === "dock-left");
  const dockRight = visible.filter((n) => n.dockPosition === "dock-right");
  const dockBottom = visible.filter((n) => n.dockPosition === "dock-bottom");
  const minimized = visible.filter((n) => n.dockPosition === "minimized");

  const floatingIds = useMemo(() => new Set(floating.map((n) => n.instanceId)), [floating]);
  const floatingConnections = state.connections.filter((c) => floatingIds.has(c.fromInstanceId) && floatingIds.has(c.toInstanceId));

  const selectedNode: CanvasNode | undefined =
    state.selectedIds.size === 1 ? state.nodes.find((n) => state.selectedIds.has(n.instanceId)) : undefined;

  function handleCanvasPointerDown(e: React.PointerEvent) {
    if (e.target !== e.currentTarget) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    panOrigin.current = { px: e.clientX, py: e.clientY, vx: state.viewport.x, vy: state.viewport.y };
    state.clearSelection();
  }

  function handleCanvasPointerMove(e: React.PointerEvent) {
    if (!panOrigin.current) return;
    const { px, py, vx, vy } = panOrigin.current;
    state.pan(vx + (e.clientX - px), vy + (e.clientY - py));
  }

  function handleCanvasPointerUp() {
    panOrigin.current = null;
    setPendingConnection(null);
  }

  function handleWheel(e: React.WheelEvent) {
    state.zoom(e.deltaY);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const moduleId = e.dataTransfer.getData("text/dnaos-module-id");
    if (!moduleId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    state.addNode(moduleId, e.clientX - rect.left - state.viewport.x, e.clientY - rect.top - state.viewport.y);
  }

  function handleAddFromPalette(moduleId: string) {
    state.addNode(moduleId, 40 - state.viewport.x, 40 - state.viewport.y);
  }

  function handleSave() {
    state.save();
    setWorkspaces(workspaceLayoutStore.list());
  }

  function handleNewWorkspace() {
    const layout = workspaceLayoutStore.createEmpty(`Workspace ${workspaces.length + 1}`);
    state.loadWorkspace(layout);
    setWorkspaces(workspaceLayoutStore.list());
  }

  function handleRenameWorkspace() {
    const name = window.prompt("Rename workspace", state.workspaceName);
    if (name) {
      state.setWorkspaceName(name);
      handleSave();
    }
  }

  function handleDuplicateWorkspace() {
    state.save();
    const cloned = workspaceLayoutStore.clone(state.workspaceId, `${state.workspaceName} copy`);
    if (cloned) {
      state.loadWorkspace(cloned);
      setWorkspaces(workspaceLayoutStore.list());
    }
  }

  function handleDeleteWorkspace() {
    if (workspaces.length <= 1) return;
    if (!window.confirm(`Delete workspace "${state.workspaceName}"?`)) return;
    workspaceLayoutStore.remove(state.workspaceId);
    const remaining = workspaceLayoutStore.list();
    setWorkspaces(remaining);
    if (remaining[0]) state.loadWorkspace(remaining[0]);
  }

  function renderDockNode(n: CanvasNode) {
    return (
      <NodeRenderer
        key={n.instanceId}
        node={n}
        docked
        selected={state.selectedIds.has(n.instanceId)}
        onMove={state.moveNode}
        onSelect={state.select}
        onRemove={state.removeNode}
        onPortDragStart={(instanceId, port) => setPendingConnection({ instanceId, port })}
        onPortDrop={(instanceId, port) => {
          if (pendingConnection) {
            state.connect(pendingConnection.instanceId, pendingConnection.port, instanceId, port);
            setPendingConnection(null);
          }
        }}
      />
    );
  }

  return (
    <div className="flex w-full h-full overflow-hidden">
      <ModulePalette onAddNode={handleAddFromPalette} />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-10 shrink-0 border-b border-stone-200 flex items-center gap-2 px-3 bg-white">
          <select
            value={state.workspaceId}
            onChange={(e) => {
              const layout = workspaceLayoutStore.load(e.target.value);
              if (layout) state.loadWorkspace(layout);
            }}
            className="text-xs border border-stone-200 rounded-md px-2 py-1"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <button type="button" onClick={handleNewWorkspace} className="text-xs text-stone-500 hover:text-stone-800">+ New</button>
          <button type="button" onClick={handleDuplicateWorkspace} className="text-xs text-stone-500 hover:text-stone-800">Duplicate</button>
          <button type="button" onClick={handleRenameWorkspace} className="text-xs text-stone-500 hover:text-stone-800">Rename</button>
          <button type="button" onClick={handleDeleteWorkspace} className="text-xs text-stone-500 hover:text-red-600">Delete</button>
          <button type="button" onClick={() => state.groupSelected()} className="text-xs text-stone-500 hover:text-stone-800">Group selected</button>
          <div className="flex-1" />
          <span className="text-[10px] text-stone-400">{Math.round(state.viewport.zoom * 100)}%</span>
          <button type="button" onClick={handleSave} className="text-xs bg-stone-900 text-white rounded-md px-2.5 py-1">Save</button>
        </div>

        <div className="h-8 shrink-0 border-b border-stone-200 flex items-center gap-1 px-3 bg-stone-50">
          {state.screens.map((screen, index) => (
            <button
              key={screen.id}
              ref={(el) => { if (el) screenTabRefs.current.set(screen.id, el); else screenTabRefs.current.delete(screen.id); }}
              type="button"
              draggable
              onDragStart={() => { dragScreenIndex.current = index; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragScreenIndex.current !== null && dragScreenIndex.current !== index) {
                  state.reorderScreens(dragScreenIndex.current, index);
                }
                dragScreenIndex.current = null;
              }}
              onClick={() => state.switchScreen(screen.id)}
              onDoubleClick={() => {
                const name = window.prompt("Rename screen", screen.name);
                if (name) state.renameScreen(screen.id, name);
              }}
              className={
                "group flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border cursor-grab " +
                (screen.id === state.activeScreenId
                  ? "bg-white border-stone-300 text-stone-800"
                  : "border-transparent text-stone-400 hover:text-stone-600")
              }
            >
              {screen.name}
              {state.screens.length > 1 && (
                <span
                  onClick={(e) => { e.stopPropagation(); state.removeScreen(screen.id); }}
                  className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500"
                >
                  ×
                </span>
              )}
            </button>
          ))}
          <button type="button" onClick={() => state.addScreen(`Screen ${state.screens.length + 1}`)} className="text-xs text-stone-400 hover:text-stone-700 px-2">
            + Screen
          </button>
        </div>

        {fullscreenNode ? (
          <div className="flex-1 relative overflow-hidden bg-white p-4">
            <button
              type="button"
              onClick={() => state.setDockPosition(fullscreenNode.instanceId, "floating")}
              className="absolute top-3 right-3 z-10 text-xs bg-stone-900 text-white rounded-md px-2.5 py-1"
            >
              Exit fullscreen
            </button>
            <div className="w-full h-full flex items-center justify-center">
              {renderDockNode(fullscreenNode)}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0">
            {dockLeft.length > 0 && (
              <div className="w-64 shrink-0 border-r border-stone-200 bg-white overflow-y-auto p-2">
                {dockLeft.map(renderDockNode)}
              </div>
            )}

            <div className="flex-1 flex flex-col min-w-0">
              <div
                className="flex-1 relative overflow-hidden bg-stone-50"
                style={{ backgroundImage: "radial-gradient(#e7e5e4 1px, transparent 1px)", backgroundSize: "16px 16px" }}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onWheel={handleWheel}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <div
                  className="absolute inset-0 origin-top-left"
                  style={{ transform: `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.zoom})` }}
                >
                  <ConnectionLayer
                    nodes={floating}
                    connections={floatingConnections}
                    nodeInputPorts={(id) => moduleRegistry.get(floating.find((n) => n.instanceId === id)?.moduleId ?? "")?.inputPorts ?? []}
                    nodeOutputPorts={(id) => moduleRegistry.get(floating.find((n) => n.instanceId === id)?.moduleId ?? "")?.outputPorts ?? []}
                    onRemoveConnection={state.disconnect}
                  />
                  {floating.map((n) => (
                    <NodeRenderer
                      key={n.instanceId}
                      node={n}
                      selected={state.selectedIds.has(n.instanceId)}
                      onMove={state.moveNode}
                      onSelect={state.select}
                      onRemove={state.removeNode}
                      onPortDragStart={(instanceId, port) => setPendingConnection({ instanceId, port })}
                      onPortDrop={(instanceId, port) => {
                        if (pendingConnection) {
                          state.connect(pendingConnection.instanceId, pendingConnection.port, instanceId, port);
                          setPendingConnection(null);
                        }
                      }}
                      onDragEnd={handleNodeDragEnd}
                    />
                  ))}
                </div>
              </div>

              {minimized.length > 0 && (
                <div className="h-8 shrink-0 border-t border-stone-200 bg-white flex items-center gap-1.5 px-2 overflow-x-auto">
                  {minimized.map((n) => {
                    const module = moduleRegistry.get(n.moduleId);
                    return (
                      <button
                        key={n.instanceId}
                        type="button"
                        onClick={() => state.setDockPosition(n.instanceId, "floating")}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 hover:bg-stone-200 shrink-0"
                      >
                        {module?.name ?? n.instanceId}
                      </button>
                    );
                  })}
                </div>
              )}

              {dockBottom.length > 0 && (
                <div className="h-40 shrink-0 border-t border-stone-200 bg-white overflow-x-auto flex gap-2 p-2">
                  {dockBottom.map((n) => <div key={n.instanceId} className="w-64 shrink-0">{renderDockNode(n)}</div>)}
                </div>
              )}
            </div>

            {dockRight.length > 0 && (
              <div className="w-64 shrink-0 border-l border-stone-200 bg-white overflow-y-auto p-2">
                {dockRight.map(renderDockNode)}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedNode && (
        <div className="w-64 shrink-0 border-l border-stone-200 bg-white overflow-y-auto">
          <ModuleInspector node={selectedNode} nodes={state.nodes} connections={state.connections} />
          <PropertyInspector
            node={selectedNode}
            onMove={state.moveNode}
            onResize={state.resizeNode}
            onRecolor={state.recolorNode}
            onSetDockPosition={state.setDockPosition}
            onSetVisibility={state.setVisibility}
          />
        </div>
      )}
    </div>
  );
}