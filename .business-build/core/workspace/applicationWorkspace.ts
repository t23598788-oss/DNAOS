"use client";

import { workspaceLayoutStore } from "./workspaceLayout";
import { createWorkspaceFromApplication } from "./workspaceTemplate";
import type { ApplicationDefinition } from "./application";
import type { WorkspaceLayout } from "@/components/workspace/canvas/types";

// Workspace Persistence for Applications (Phase 5, Step 31) — reuses
// workspaceLayoutStore exactly as built in Phase 1/3A (no redesign, per
// owner constraint #2). An Application's Workspace Layout, Dock Layout,
// Screen Layout, and Window State are ALL already inside WorkspaceLayout's
// existing shape (screens[].nodes[].dockPosition, viewport, etc.) — the
// only new thing here is a naming convention so a saved Workspace can be
// found again by which Application it belongs to. "User Preferences" from
// the spec has no existing home in WorkspaceLayout and isn't invented here.
//
// On first load for an Application, the Workspace is generated from that
// Application's own panel list via workspaceTemplate.ts (Step 24) — not an
// empty canvas — so opening an Application's Workspace immediately shows
// its real composition, not a blank screen the user has to build by hand.
function nameFor(applicationId: string): string {
  return `__app:${applicationId}`;
}

export function loadOrCreateApplicationWorkspace(app: ApplicationDefinition): WorkspaceLayout {
  const existing = workspaceLayoutStore.list().find((w) => w.name === nameFor(app.id));
  if (existing) return existing;

  const generated = createWorkspaceFromApplication(app);
  workspaceLayoutStore.save(generated);
  return generated;
}