"use client";

import { useCallback, useMemo, useState } from "react";
import { screenController, moduleRegistry } from "@/core/workspace";
import type { DockPosition, Visibility } from "@/core/workspace";
import { workspaceLayoutStore } from "@/core/workspace/workspaceLayout";
import type { CanvasNode, CanvasConnection, Viewport, Screen, WorkspaceLayout } from "./types";

// Canvas state — placement/selection/viewport for ONE open Workspace, which
// may contain multiple Screens (Phase 3A). Screen switching only changes
// which Screen's nodes/connections/viewport are being edited/displayed —
// it never touches runtime state. What DOES need to survive navigation is
// the underlying module's runtime — that's handled by runtimeRegistry,
// untouched by anything in this file.
//
// Placing a node (a Panel) on a Screen calls screenController.attach() —
// requirement 9 from Phase 0 ("ScreenController renders Nodes from the
// Registry"): the Canvas never decides attachment itself, it delegates to
// Screen Controller, then just reflects position/connections locally.

export function useCanvasState(initial: WorkspaceLayout) {
  const [workspaceId, setWorkspaceId] = useState(initial.id);
  const [workspaceName, setWorkspaceName] = useState(initial.name);
  const [screens, setScreens] = useState<Screen[]>(initial.screens);
  const [activeScreenId, setActiveScreenId] = useState(initial.activeScreenId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const activeScreen = useMemo(
    () => screens.find((s) => s.id === activeScreenId) ?? screens[0],
    [screens, activeScreenId]
  );

  const updateActiveScreen = useCallback((updater: (screen: Screen) => Screen) => {
    setScreens((prev) => prev.map((s) => (s.id === activeScreenId ? updater(s) : s)));
  }, [activeScreenId]);

  const addNode = useCallback((moduleId: string, x: number, y: number) => {
    const module = moduleRegistry.get(moduleId);
    if (!module) return;
    const instanceId = crypto.randomUUID();
    screenController.attach(instanceId);
    screenController.show(instanceId);
    updateActiveScreen((s) => ({ ...s, nodes: [...s.nodes, { instanceId, moduleId, x, y }] }));
  }, [updateActiveScreen]);

  const removeNode = useCallback((instanceId: string) => {
    screenController.detach(instanceId);
    updateActiveScreen((s) => ({
      ...s,
      nodes: s.nodes.filter((n) => n.instanceId !== instanceId),
      connections: s.connections.filter((c) => c.fromInstanceId !== instanceId && c.toInstanceId !== instanceId),
    }));
  }, [updateActiveScreen]);

  const moveNode = useCallback((instanceId: string, x: number, y: number) => {
    updateActiveScreen((s) => ({ ...s, nodes: s.nodes.map((n) => (n.instanceId === instanceId ? { ...n, x, y } : n)) }));
  }, [updateActiveScreen]);

  // Connecting nodes only records a relationship — it never calls, imports,
  // or executes either module (Phase 3A req 4/6: Workspace JSON only).
  const connect = useCallback((fromInstanceId: string, fromPort: string, toInstanceId: string, toPort: string) => {
    if (fromInstanceId === toInstanceId) return;
    updateActiveScreen((s) => ({
      ...s,
      connections: [...s.connections, { id: crypto.randomUUID(), fromInstanceId, fromPort, toInstanceId, toPort }],
    }));
  }, [updateActiveScreen]);

  const disconnect = useCallback((connectionId: string) => {
    updateActiveScreen((s) => ({ ...s, connections: s.connections.filter((c) => c.id !== connectionId) }));
  }, [updateActiveScreen]);

  const select = useCallback((instanceId: string, additive: boolean) => {
    setSelectedIds((prev) => {
      const next = additive ? new Set(prev) : new Set<string>();
      if (next.has(instanceId) && additive) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const groupSelected = useCallback(() => {
    const groupId = crypto.randomUUID();
    updateActiveScreen((s) => ({
      ...s,
      nodes: s.nodes.map((n) => (selectedIds.has(n.instanceId) ? { ...n, groupId } : n)),
    }));
  }, [selectedIds, updateActiveScreen]);

  const zoom = useCallback((delta: number) => {
    updateActiveScreen((s) => ({ ...s, viewport: { ...s.viewport, zoom: Math.min(2, Math.max(0.25, s.viewport.zoom - delta * 0.001)) } }));
  }, [updateActiveScreen]);

  const pan = useCallback((dx: number, dy: number) => {
    updateActiveScreen((s) => ({ ...s, viewport: { ...s.viewport, x: dx, y: dy } }));
  }, [updateActiveScreen]);

  // Multi-Screen Workspace — a Screen is just another arrangement of the
  // same registered modules; adding one never touches Runtime or Business
  // Engine, only the local screens[] array.
  const addScreen = useCallback((name: string) => {
    const id = crypto.randomUUID();
    setScreens((prev) => [...prev, { id, name, nodes: [], connections: [], viewport: { x: 0, y: 0, zoom: 1 } }]);
    setActiveScreenId(id);
    setSelectedIds(new Set());
  }, []);

  const removeScreen = useCallback((id: string) => {
    setScreens((prev) => {
      const screen = prev.find((s) => s.id === id);
      screen?.nodes.forEach((n) => screenController.detach(n.instanceId));
      const next = prev.filter((s) => s.id !== id);
      return next.length > 0 ? next : [{ id: crypto.randomUUID(), name: "Screen 1", nodes: [], connections: [], viewport: { x: 0, y: 0, zoom: 1 } }];
    });
    setActiveScreenId((prevActive) => (prevActive === id ? screens[0]?.id ?? prevActive : prevActive));
  }, [screens]);

  const renameScreen = useCallback((id: string, name: string) => {
    setScreens((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  }, []);

  const switchScreen = useCallback((id: string) => {
    setActiveScreenId(id);
    setSelectedIds(new Set());
  }, []);

  // Cross-screen move (Phase 3C) — relocates the exact existing node object
  // (same instanceId/moduleId/x/y/width/height/color/visibility/dockPosition)
  // from whichever screen currently holds it into targetScreenId, and moves
  // any connections touching it along with it as complete objects. Nothing
  // is regenerated or duplicated: total node count and total connection
  // count across the whole Workspace are invariant before/after. Dock
  // state and visibility need no explicit handling here at all — they live
  // in screenController's registries keyed only by instanceId, never by
  // Screen, so they're already correct on the far side without a single
  // screenController call.
  const moveNodeToScreen = useCallback((instanceId: string, targetScreenId: string) => {
    setScreens((prev) => {
      const sourceScreen = prev.find((s) => s.nodes.some((n) => n.instanceId === instanceId));
      if (!sourceScreen || sourceScreen.id === targetScreenId) return prev;
      const node = sourceScreen.nodes.find((n) => n.instanceId === instanceId);
      if (!node) return prev;
      const movingConnections = sourceScreen.connections.filter(
        (c) => c.fromInstanceId === instanceId || c.toInstanceId === instanceId
      );
      const movingConnectionIds = new Set(movingConnections.map((c) => c.id));

      return prev.map((s) => {
        if (s.id === sourceScreen.id) {
          return {
            ...s,
            nodes: s.nodes.filter((n) => n.instanceId !== instanceId),
            connections: s.connections.filter((c) => !movingConnectionIds.has(c.id)),
          };
        }
        if (s.id === targetScreenId) {
          return { ...s, nodes: [...s.nodes, node], connections: [...s.connections, ...movingConnections] };
        }
        return s;
      });
    });
  }, []);

  const reorderScreens = useCallback((fromIndex: number, toIndex: number) => {
    setScreens((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const resizeNode = useCallback((instanceId: string, width: number, height: number) => {
    updateActiveScreen((s) => ({ ...s, nodes: s.nodes.map((n) => (n.instanceId === instanceId ? { ...n, width, height } : n)) }));
  }, [updateActiveScreen]);

  const recolorNode = useCallback((instanceId: string, color: string) => {
    updateActiveScreen((s) => ({ ...s, nodes: s.nodes.map((n) => (n.instanceId === instanceId ? { ...n, color } : n)) }));
  }, [updateActiveScreen]);

  // Dock position / visibility are Screen Controller's job (Phase 0), never
  // decided by the UI directly — the Property Inspector calls this, which
  // calls screenController, which is the single authority that mutates
  // attachment/placement state; the local node field is just the persisted
  // reflection of whatever Screen Controller last set.
  const setDockPosition = useCallback((instanceId: string, position: DockPosition) => {
    switch (position) {
      case "dock-left": screenController.dockLeft(instanceId); break;
      case "dock-right": screenController.dockRight(instanceId); break;
      case "dock-bottom": screenController.dockBottom(instanceId); break;
      case "fullscreen": screenController.fullscreen(instanceId); break;
      case "minimized": screenController.minimize(instanceId); break;
      case "floating": screenController.float(instanceId); break;
    }
    updateActiveScreen((s) => ({ ...s, nodes: s.nodes.map((n) => (n.instanceId === instanceId ? { ...n, dockPosition: position } : n)) }));
  }, [updateActiveScreen]);

  const setVisibility = useCallback((instanceId: string, visibility: Visibility) => {
    if (visibility === "visible") screenController.show(instanceId);
    else screenController.hide(instanceId);
    updateActiveScreen((s) => ({ ...s, nodes: s.nodes.map((n) => (n.instanceId === instanceId ? { ...n, visibility } : n)) }));
  }, [updateActiveScreen]);

  const save = useCallback(() => {
    const layout: WorkspaceLayout = {
      id: workspaceId,
      name: workspaceName,
      screens,
      activeScreenId,
      updatedAt: new Date().toISOString(),
    };
    workspaceLayoutStore.save(layout);
    return layout;
  }, [workspaceId, workspaceName, screens, activeScreenId]);

  const loadWorkspace = useCallback((layout: WorkspaceLayout) => {
    // Detach whatever was previously attached across all screens before
    // loading a different layout — Screen Controller stays the source of
    // truth for what's attached, the Canvas just tells it what changed.
    screens.forEach((s) => s.nodes.forEach((n) => screenController.detach(n.instanceId)));
    setWorkspaceId(layout.id);
    setWorkspaceName(layout.name);
    setScreens(layout.screens);
    setActiveScreenId(layout.activeScreenId);
    setSelectedIds(new Set());
    layout.screens.forEach((s) => s.nodes.forEach((n) => {
      screenController.attach(n.instanceId);
      screenController.show(n.instanceId);
    }));
  }, [screens]);

  return {
    workspaceId,
    workspaceName,
    setWorkspaceName,
    screens,
    activeScreenId,
    nodes: activeScreen?.nodes ?? ([] as CanvasNode[]),
    connections: activeScreen?.connections ?? ([] as CanvasConnection[]),
    viewport: activeScreen?.viewport ?? ({ x: 0, y: 0, zoom: 1 } as Viewport),
    selectedIds,
    addNode,
    removeNode,
    moveNode,
    connect,
    disconnect,
    select,
    clearSelection,
    groupSelected,
    zoom,
    pan,
    addScreen,
    removeScreen,
    renameScreen,
    switchScreen,
    reorderScreens,
    moveNodeToScreen,
    resizeNode,
    recolorNode,
    setDockPosition,
    setVisibility,
    save,
    loadWorkspace,
  };
}