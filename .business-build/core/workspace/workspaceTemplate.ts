import type { ApplicationDefinition, PresenterId } from "./application";
import type { WorkspaceLayout, Screen, CanvasNode } from "@/components/workspace/canvas/types";

// Workspace Template System (Phase 5, Step 24) —
// Workspace Template -> Application -> Board Layout -> Panels -> Saved Workspace.
//
// Generates a real Canvas Workspace (existing WorkspaceLayout/Screen/
// CanvasNode types, untouched — no redesign) whose panels are placed
// automatically from an ApplicationDefinition's own panel list. Every
// CanvasNode.moduleId used here is one of the 380 already-registered
// entries in registry/module-registry.json (Module Registry is frozen this
// phase, so this only reuses what's already there — it never invents a new
// entry). Presenters with no real backing (Phase 4C's gap list: payment,
// cashflow, vat, system-status, timeline, alerts) have no real registered
// module to point to either, so they're skipped here rather than wired to
// an unrelated file — the Application Composition page (Step 29's
// demonstration) already renders those as honest placeholders; this
// template only places the panels that are real.
const PRESENTER_MODULE_ID: Partial<Record<PresenterId, string>> = {
  debt: "services/supabase/queries.ts",
  partner: "services/supabase/queries.ts",
  invoice: "services/supabase/queries.ts",
  order: "services/supabase/queries.ts",
  document: "services/supabase/queries.ts",
  material: "services/supabase/queries.ts",
  transport: "services/supabase/queries.ts",
  workflow: "engines/transactions/state-machine.ts",
};

const GRID_COLS = 3;
const NODE_WIDTH = 260;
const NODE_HEIGHT = 200;

export function createWorkspaceFromApplication(app: ApplicationDefinition): WorkspaceLayout {
  const screenId = crypto.randomUUID();
  const nodes: CanvasNode[] = [];

  let placed = 0;
  for (const panel of app.panels) {
    const moduleId = PRESENTER_MODULE_ID[panel.presenterId];
    if (!moduleId) continue; // no real registered module for this panel — skip rather than fabricate
    nodes.push({
      instanceId: crypto.randomUUID(),
      moduleId,
      x: (placed % GRID_COLS) * NODE_WIDTH,
      y: Math.floor(placed / GRID_COLS) * NODE_HEIGHT,
    });
    placed++;
  }

  const screen: Screen = {
    id: screenId,
    name: app.name,
    nodes,
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  return {
    id: crypto.randomUUID(),
    name: `__app:${app.id}`,
    screens: [screen],
    activeScreenId: screenId,
    updatedAt: new Date().toISOString(),
  };
}