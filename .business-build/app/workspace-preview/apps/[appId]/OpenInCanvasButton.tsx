"use client";

import { loadOrCreateApplicationWorkspace } from "@/core/workspace/applicationWorkspace";
import type { ApplicationDefinition } from "@/core/workspace/application";

// Closes the Step 24 loop: generates (or reuses) this Application's real
// Workspace Template via workspaceTemplate.ts, saves it through the
// existing workspaceLayoutStore, then hands off to the existing Canvas
// editor at /workspace-preview — where it already appears in the ordinary
// Workspace switcher, since it was saved through the same store every other
// Workspace uses. No change to Canvas.tsx itself.
export function OpenInCanvasButton({ app }: { app: ApplicationDefinition }) {
  return (
    <button
      type="button"
      onClick={() => {
        loadOrCreateApplicationWorkspace(app);
        window.location.href = "/workspace-preview";
      }}
      className="text-xs bg-stone-900 text-white rounded-md px-3 py-1.5"
    >
      เปิดใน Canvas Editor
    </button>
  );
}