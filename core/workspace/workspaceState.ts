import type { PanelId, DockPosition, Visibility, WorkspaceSnapshot, Listener, Unsubscribe } from "./types";

// Workspace State — the render snapshot WorkspaceShell reads. Structurally
// single-writer: this module exports only a writer handle (`__write`), never
// re-exported outside core/workspace/index.ts, so the only realistic caller
// is screenController.ts sitting right next to it. Everyone else — including
// WorkspaceShell — only ever calls getSnapshot()/subscribe().

const panels = new Map<PanelId, { position: DockPosition; visibility: Visibility }>();
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export const workspaceState = {
  getSnapshot(): WorkspaceSnapshot {
    return { panels: Object.fromEntries(panels) };
  },

  subscribe(listener: Listener): Unsubscribe {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  // Intended caller: screenController.ts exclusively.
  __write(id: PanelId, position: DockPosition, visibility: Visibility): void {
    panels.set(id, { position, visibility });
    notify();
  },

  __remove(id: PanelId): void {
    panels.delete(id);
    notify();
  },
};

export type WorkspaceState = typeof workspaceState;