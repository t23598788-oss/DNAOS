// DNA OS Runtime / Presentation Separation — Phase 0 barrel export.
// Nothing outside this directory imports from here yet (see components/workspace/WorkspaceContext.tsx
// for the one exception, which is itself unmounted/unused — Phase 0, infrastructure only).

export * from "./types";
export { runtimeRegistry } from "./runtimeRegistry";
export type { RuntimeRegistry } from "./runtimeRegistry";
export { attachmentRegistry } from "./attachmentRegistry";
export type { AttachmentRegistry } from "./attachmentRegistry";
export { panelRegistry } from "./panelRegistry";
export type { PanelRegistry } from "./panelRegistry";
export { presenterRegistry } from "./presenterRegistry";
export type { PresenterRegistry } from "./presenterRegistry";
export type { DockManager } from "./dockManager";
export { workspaceState } from "./workspaceState";
export type { WorkspaceState } from "./workspaceState";
export { screenController } from "./screenController";
export type { ScreenController } from "./screenController";
export { moduleRegistry, generateModuleNodes } from "./moduleRegistry";
export type { ModuleRegistry, ModuleNode } from "./moduleRegistry";
export type { RenderModel, WidgetModel, TableModel, CardModel, ChartModel, PanelModel, ActionModel } from "./renderModel";
export { EMPTY_RENDER_MODEL } from "./renderModel";
export type { Board, BoardType } from "./board";
export { presentModuleInstance } from "./presenter";
export { resolveBoard } from "./boardRouter";
// Application-layer exports (application.ts, applicationRegistry.ts,
// permissionComposer.ts, applicationRouter.ts, applicationWorkspace.ts)
// deliberately NOT re-exported here. applicationRegistry.ts imports
// ADMIN_TIER/ANY_AUTHENTICATED from core/auth/session.ts, which pulls in
// services/supabase/server.ts (next/headers, server-only) — barreling that
// through this file broke Canvas.tsx's client bundle, since Canvas already
// imports from this barrel for screenController/moduleRegistry. Import the
// application-layer files directly instead (see
// app/workspace-preview/apps/[appId]/page.tsx for the working pattern).