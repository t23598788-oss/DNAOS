"use client";

import { useEffect, useState } from "react";
import { Canvas } from "@/components/workspace/canvas";
import { workspaceLayoutStore } from "@/core/workspace/workspaceLayout";
import type { WorkspaceLayout } from "@/components/workspace/canvas/types";

// Preview Environment entry point. Loads the most recently used Workspace
// layout from localStorage, or creates one empty Workspace on first visit.
// This is the only piece of the Visual Workspace mounted anywhere in the app
// right now — every existing Admin/Business/Partner/User route is untouched.
export function WorkspacePreviewClient() {
  const [layout, setLayout] = useState<WorkspaceLayout | null>(null);

  useEffect(() => {
    const existing = workspaceLayoutStore.list();
    setLayout(existing[0] ?? workspaceLayoutStore.createEmpty("Workspace 1"));
  }, []);

  if (!layout) {
    return <div className="h-screen flex items-center justify-center text-xs text-stone-400">กำลังโหลด Workspace…</div>;
  }

  return <Canvas initialLayout={layout} />;
}