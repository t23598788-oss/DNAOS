import type { DockPosition, Visibility } from "@/core/workspace";

// Visual Canvas — types. A CanvasNode is a placed instance of a ModuleNode
// (core/workspace/moduleRegistry.ts) at a position on one Workspace; the
// Canvas never stores or knows the module's actual business logic, only
// this placement + connection data.
//
// dockPosition/visibility mirror what Screen Controller's live attachment
// state holds (core/workspace/attachmentRegistry.ts) — they're persisted
// here as the serialized snapshot of the last state Screen Controller set,
// so reloading a Workspace can re-request the same arrangement. Screen
// Controller remains the only thing that ever actually mutates them at
// runtime; the Property Inspector calls screenController, which is what
// updates this value, never the other way around.
export interface CanvasNode {
  instanceId: string; // unique per placement — the same module can be placed more than once
  moduleId: string; // ModuleNode.id (== module-registry.json file path)
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: string;
  visibility?: Visibility;
  dockPosition?: DockPosition;
  groupId?: string;
}

export interface CanvasConnection {
  id: string;
  fromInstanceId: string;
  fromPort: string;
  toInstanceId: string;
  toPort: string;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

// A Screen is one visual layout inside a Workspace — its own set of placed
// module instances (Panels), their connections, and its own viewport. A
// Workspace holding multiple Screens lets the same set of registered
// modules be arranged differently for different purposes without touching
// the modules or duplicating any code — a Panel always just references a
// module via CanvasNode.moduleId.
export interface Screen {
  id: string;
  name: string;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  viewport: Viewport;
}

// The only thing a Workspace persists — pure layout, no business logic,
// no runtime state. Restoring this JSON never re-executes anything; it only
// re-attaches nodes to the screen via screenController.
export interface WorkspaceLayout {
  id: string;
  name: string;
  screens: Screen[];
  activeScreenId: string;
  updatedAt: string;
}