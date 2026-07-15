// UIKit — barrel export
// import { Inspector, MapView, ... } from "@/components/ui-kit";
//
// Presentation Architecture Audit (Phase 2, 2026-07-11): removed the unused
// floating-window OS scaffold (WorkspaceCanvas/WindowLayer/Dock/CommandPalette/
// Drawer/DataTable/ChatPanel/PartnerCard + the generic ui-kit Timeline) — zero
// JSX mounts anywhere in the app, fully superseded by AppShell +
// app/admin/line-customers/workspace-state.tsx's WorkspaceProvider (a
// same-named but unrelated reducer) as the one live presentation runtime.
// See engines/presentation/template-resolver.ts for the single
// template-resolution path every source item now goes through.
//
// Phase 3 (2026-07-11): removed DocumentViewer — a document's one
// presentation source is the Timeline Card; opening it now reuses the
// already-real HTML (engines/documents/template.ts's output) in a new
// browser tab (see openHtmlDocument() in line-customers/page.tsx) instead
// of a permanent side panel that duplicated the same document.

export { default as Window } from "./Window";
export { default as EmptyState } from "./EmptyState";
export { default as Inspector } from "./Inspector";
export type { InspectorField } from "./Inspector";
export { default as MapView } from "./MapView";
export type { MapMarker } from "./MapView";
export { default as IconRail } from "./IconRail";
export type { IconRailItem } from "./IconRail";
export { default as ListColumn } from "./ListColumn";
export type { ListColumnItem } from "./ListColumn";
export { default as AppShell } from "./AppShell";
export { default as ActionBar } from "./ActionBar";
export type { ActionBarItem } from "./ActionBar";
export { default as FlexPreview } from "./FlexPreview";
