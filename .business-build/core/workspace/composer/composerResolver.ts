import { capabilityComposer } from "./capabilityComposer";
import type { CompositionPlan } from "./types";

// Composer Resolver (Phase 7.5) — Application Definition -> CompositionPlan.
// The named entry point from the architecture diagram; delegates entirely
// to capabilityComposer (no duplicated resolution logic). Distinct from
// core/workspace/application.ts's ApplicationDefinition (Phase 5, PresenterId-
// based, already live) — this one is CapabilityId-based and not wired to
// anything real yet.
export interface ComposerApplicationDefinition {
  applicationId: string;
  workspaceId: string;
  name: string;
  capabilityIds: string[];
}

export const composerResolver = {
  resolve(appDef: ComposerApplicationDefinition): CompositionPlan {
    return capabilityComposer.resolve({
      applicationId: appDef.applicationId,
      workspaceId: appDef.workspaceId,
      requestedCapabilityIds: appDef.capabilityIds,
    });
  },
};