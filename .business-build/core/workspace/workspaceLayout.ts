import type { WorkspaceLayout } from "@/components/workspace/canvas/types";

// Workspace JSON — save/load/list/clone for multiple Workspaces. Stored in
// localStorage, not the database: this phase explicitly forbids a Database
// schema change ("ห้ามแก้ Database Schema" / "Existing ... Database ...
// remain untouched"), and a Workspace layout is pure presentation state, not
// business data, so it belongs client-side. Cross-device Share is out of
// scope until a real backend table is explicitly authorized — that would be
// a Database change, not a Presentation one.

// v2 — Workspace JSON now nests Screens (Multi-Screen Workspace, Phase 3A)
// instead of a single flat nodes/connections/viewport. Bumped rather than
// migrated: this is still preview/test data only, nothing real depends on
// v1's shape yet, and silently reading v1 data through v2's types would
// crash on the missing `screens` field.
const STORAGE_KEY = "dnaos.workspace.layouts.v2";

function readAll(): Record<string, WorkspaceLayout> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, WorkspaceLayout>) : {};
  } catch {
    return {};
  }
}

function writeAll(layouts: Record<string, WorkspaceLayout>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
}

export const workspaceLayoutStore = {
  list(): WorkspaceLayout[] {
    return Object.values(readAll()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  load(id: string): WorkspaceLayout | undefined {
    return readAll()[id];
  },

  save(layout: WorkspaceLayout): void {
    const layouts = readAll();
    layouts[layout.id] = { ...layout, updatedAt: new Date().toISOString() };
    writeAll(layouts);
  },

  remove(id: string): void {
    const layouts = readAll();
    delete layouts[id];
    writeAll(layouts);
  },

  clone(id: string, newName: string): WorkspaceLayout | undefined {
    const source = readAll()[id];
    if (!source) return undefined;
    const cloned: WorkspaceLayout = {
      ...source,
      id: crypto.randomUUID(),
      name: newName,
      updatedAt: new Date().toISOString(),
    };
    this.save(cloned);
    return cloned;
  },

  createEmpty(name: string): WorkspaceLayout {
    const screenId = crypto.randomUUID();
    const layout: WorkspaceLayout = {
      id: crypto.randomUUID(),
      name,
      screens: [{ id: screenId, name: "Screen 1", nodes: [], connections: [], viewport: { x: 0, y: 0, zoom: 1 } }],
      activeScreenId: screenId,
      updatedAt: new Date().toISOString(),
    };
    this.save(layout);
    return layout;
  },
};

export type WorkspaceLayoutStore = typeof workspaceLayoutStore;