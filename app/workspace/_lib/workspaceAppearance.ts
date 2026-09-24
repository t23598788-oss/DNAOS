/** Owner-editable presentation only. Keep bindings and authority out of here.
 * Reorder keys or move the rail without changing tool actions or data sources.
 * Individual tool icons/labels remain in businessTools.ts.
 */
export interface WorkspaceAppearance {
  railSide: "left" | "right";
  toolOrder: readonly string[];
  panelWidth: number;
  panelInitiallyClosed: boolean;
  settingsColumns: 1 | 2 | 3;
}

export const WORKSPACE_APPEARANCE: WorkspaceAppearance = {
  railSide: "left",
  toolOrder: ["chat", "documents", "people", "jobs", "finance", "connections"],
  panelWidth: 300,
  panelInitiallyClosed: true,
  settingsColumns: 3,
};
