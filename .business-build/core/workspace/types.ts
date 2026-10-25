// DNA OS Runtime / Presentation Separation — Phase 0 (architecture foundation).
// Shared contracts for every piece in core/workspace/. Nothing in this directory
// is imported by any existing page, layout, or WorkspaceShell yet — creating
// this layer must not change how anything currently renders or runs.
//
// Layer order (owner spec, 2026-07-14):
// Business Engine -> Runtime Registry -> Screen Controller -> Presenter (ViewModel)
// -> WorkspaceShell -> Header/Sidebar/Dock/Status/Content Slot -> Pages

export type RuntimeId = string;
export type PanelId = string;

export type RuntimeStatus = "idle" | "starting" | "running" | "stopping" | "stopped" | "error";

// A running system (business engine, background job, live subscription, etc.)
// registered once and never created/destroyed by page navigation. Visibility
// must never affect whether this keeps running.
export interface RuntimeHandle {
  id: RuntimeId;
  label: string;
  status: RuntimeStatus;
  start(): void;
  stop(): void;
}

export type Visibility = "hidden" | "visible";

export type DockPosition =
  | "floating"
  | "dock-left"
  | "dock-right"
  | "dock-bottom"
  | "fullscreen"
  | "minimized";

// Whether a runtime is attached to the workspace at all — separate from
// whether it's visible, and separate from whether it's running.
export interface AttachmentEntry {
  runtimeId: RuntimeId;
  attached: boolean;
  visibility: Visibility;
  position: DockPosition;
}

// A panel is the content-side unit Screen Controller attaches/positions.
// A panel MAY wrap a runtime (runtimeId set) or be pure static content
// (runtimeId omitted) — Screen Controller doesn't care which.
export interface PanelDefinition {
  id: PanelId;
  runtimeId?: RuntimeId;
  title: string;
  render: () => unknown; // React.ReactNode — kept as unknown here so this file has no React dependency
  defaultPosition: DockPosition;
}

// The current, read-only render state WorkspaceShell consumes. Written
// exclusively by screenController.ts (see workspaceState.ts).
export interface WorkspaceSnapshot {
  panels: Record<PanelId, { position: DockPosition; visibility: Visibility }>;
}

// Separated Presentation (Martin Fowler): converts raw runtime data into
// UI-ready view-model data. Business Engines must never know about UI;
// UI must never call Business directly — this is the only bridge.
export interface Presenter<TRuntimeData = unknown, TViewModel = unknown> {
  toViewModel(data: TRuntimeData): TViewModel;
}

export type Unsubscribe = () => void;
export type Listener = () => void;