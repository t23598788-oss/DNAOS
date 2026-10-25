import type { AppRole } from "@/core/auth/session";
import { APPLICATIONS } from "./applicationRegistry";
import { isApplicationVisible } from "./permissionComposer";
import type { ApplicationDefinition } from "./application";

// Application Router (Phase 5, Step 29) — Application Registry -> Loader ->
// Workspace -> Board Composition. This file only looks up data and checks
// visibility; it never calls a Business Engine, a Gateway function, or a
// Presenter — resolving what a panel actually renders is the caller's job
// (see app/workspace-preview/apps/[appId]/page.tsx), same separation Board
// Router already keeps in core/workspace/boardRouter.ts.
export function resolveApplication(id: string, role: AppRole): ApplicationDefinition | null {
  const app = APPLICATIONS.find((a) => a.id === id);
  if (!app || !isApplicationVisible(app, role)) return null;
  return app;
}

export function listVisibleApplications(role: AppRole): ApplicationDefinition[] {
  return APPLICATIONS.filter((a) => isApplicationVisible(a, role));
}