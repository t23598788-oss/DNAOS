import type { PanelId, DockPosition, WorkspaceSnapshot, Listener, Unsubscribe } from "./types";
import type { DockManager } from "./dockManager";
import { attachmentRegistry } from "./attachmentRegistry";
import { panelRegistry } from "./panelRegistry";
import { workspaceState } from "./workspaceState";

// Screen Controller — the ONLY layer allowed to decide what's attached to
// the workspace and where it's drawn. It reads Panel Registry (what CAN be
// shown) and writes Attachment Registry + Workspace State (what IS shown,
// and how). It never calls a RuntimeHandle's start()/stop() — attaching or
// hiding a panel must never affect whether its underlying runtime (if any)
// keeps executing. That guarantee lives structurally here: this file has no
// import of runtimeRegistry's mutating methods, only ever reads via
// panelRegistry -> PanelDefinition.runtimeId when a caller needs to know
// which runtime a panel wraps.

function panelRuntimeId(id: PanelId): string {
  return panelRegistry.getPanel(id)?.runtimeId ?? id;
}

function reposition(id: PanelId, position: DockPosition): void {
  attachmentRegistry.setPosition(panelRuntimeId(id), position);
  const current = workspaceState.getSnapshot().panels[id];
  workspaceState.__write(id, position, current?.visibility ?? "visible");
}

function attach(id: PanelId): void {
  const panel = panelRegistry.getPanel(id);
  if (!panel) return;
  attachmentRegistry.attach(panelRuntimeId(id));
  workspaceState.__write(id, panel.defaultPosition, "hidden");
}

function detach(id: PanelId): void {
  attachmentRegistry.detach(panelRuntimeId(id));
  workspaceState.__remove(id);
}

function show(id: PanelId): void {
  attachmentRegistry.setVisibility(panelRuntimeId(id), "visible");
  const current = workspaceState.getSnapshot().panels[id];
  workspaceState.__write(id, current?.position ?? "floating", "visible");
}

function hide(id: PanelId): void {
  attachmentRegistry.setVisibility(panelRuntimeId(id), "hidden");
  const current = workspaceState.getSnapshot().panels[id];
  workspaceState.__write(id, current?.position ?? "floating", "hidden");
}

export const screenController: DockManager & {
  attach(id: PanelId): void;
  detach(id: PanelId): void;
  getSnapshot(): WorkspaceSnapshot;
  subscribe(listener: Listener): Unsubscribe;
} = {
  attach,
  detach,
  show,
  hide,
  float: (id) => reposition(id, "floating"),
  dockLeft: (id) => reposition(id, "dock-left"),
  dockRight: (id) => reposition(id, "dock-right"),
  dockBottom: (id) => reposition(id, "dock-bottom"),
  fullscreen: (id) => reposition(id, "fullscreen"),
  minimize: (id) => reposition(id, "minimized"),
  getSnapshot: () => workspaceState.getSnapshot(),
  subscribe: (listener) => workspaceState.subscribe(listener),
};

export type ScreenController = typeof screenController;