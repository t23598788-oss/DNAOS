import { moduleRegistry } from "./moduleRegistry";
import { presenterRegistry } from "./presenterRegistry";
import { EMPTY_RENDER_MODEL, type RenderModel } from "./renderModel";

// Presenter Foundation (Phase 4, Step 1) — the only bridge between a placed
// Workspace panel and a Board. This is the composition point for the
// pipeline named in the architecture spec:
//
//   Workspace JSON (CanvasNode.moduleId) -> Presenter -> RenderModel -> Board
//
// A Board never calls this directly for its own module — the Canvas/Panel
// layer does, then hands the resulting RenderModel down. This function
// itself never imports @/engines, @/services, @/gateway, or @/cognitive —
// it only reads moduleRegistry (metadata) and presenterRegistry (Phase 0),
// which is where an actual Business-Engine-facing Presenter would be
// registered from — registering one is a separate, later step, not this one.
export function presentModuleInstance(moduleId: string): RenderModel {
  const module = moduleRegistry.get(moduleId);
  if (!module) return EMPTY_RENDER_MODEL;

  // A real Presenter for this module hasn't been registered yet (Phase 4
  // only builds the pipeline, not any specific module's translation) — fall
  // back to an honest, content-free model naming the module, never
  // fabricated business figures.
  const viewModel = presenterRegistry.getViewModel(moduleId);
  if (viewModel && isRenderModel(viewModel)) return viewModel;

  return { ...EMPTY_RENDER_MODEL, title: module.name, subtitle: module.category };
}

function isRenderModel(value: unknown): value is RenderModel {
  return typeof value === "object" && value !== null && "title" in value && "widgets" in value;
}