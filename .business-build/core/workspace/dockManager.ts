import type { PanelId } from "./types";

// Dock Manager — contract only (owner spec: "Dock Manager interfaces").
// A Dock is an attachment/position manager, not a widget: it decides where
// (or whether) an already-running, already-attached panel is drawn. It never
// starts, stops, creates, or destroys anything — that's Runtime Registry's
// job, untouched by any of these calls.
//
// Implemented by screenController.ts (Phase 0) — no separate concrete class
// yet, since Screen Controller is the single authority allowed to mutate
// placement and re-implementing the same contract twice would just invite
// two writers to disagree.
export interface DockManager {
  float(id: PanelId): void;
  dockLeft(id: PanelId): void;
  dockRight(id: PanelId): void;
  dockBottom(id: PanelId): void;
  fullscreen(id: PanelId): void;
  minimize(id: PanelId): void;
  hide(id: PanelId): void;
  show(id: PanelId): void;
}