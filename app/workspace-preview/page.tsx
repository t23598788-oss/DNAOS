import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { WorkspacePreviewClient } from "./WorkspacePreviewClient";

// Preview Environment for validating the Visual Workspace architecture
// (Phase 2). Gated the same as /admin — this exposes internal module
// metadata (file paths, layers, exports) that shouldn't be public. Does not
// replace or link from any existing route; nothing else in the app points
// here yet.
export default async function WorkspacePreviewPage() {
  await requireAuthPage("/workspace-preview", ADMIN_TIER);

  return (
    <div className="h-screen w-screen overflow-hidden">
      <WorkspacePreviewClient />
    </div>
  );
}