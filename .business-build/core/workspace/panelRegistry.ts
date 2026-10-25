import type { PanelDefinition, PanelId, Listener, Unsubscribe } from "./types";

// Panel Registry — the set of content units Screen Controller is allowed to
// attach/position. A panel is metadata + a render function, not a page; a
// page becomes a thin route that looks up and renders a panel via this
// registry (later phase — nothing does this yet).

const panels = new Map<PanelId, PanelDefinition>();
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export const panelRegistry = {
  registerPanel(def: PanelDefinition): void {
    panels.set(def.id, def);
    notify();
  },

  unregisterPanel(id: PanelId): void {
    panels.delete(id);
    notify();
  },

  getPanel(id: PanelId): PanelDefinition | undefined {
    return panels.get(id);
  },

  list(): PanelDefinition[] {
    return Array.from(panels.values());
  },

  subscribe(listener: Listener): Unsubscribe {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export type PanelRegistry = typeof panelRegistry;