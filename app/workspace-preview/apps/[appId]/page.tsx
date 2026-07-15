import { notFound } from "next/navigation";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ANY_AUTHENTICATED } from "@/core/auth/session";
import { resolveApplication } from "@/core/workspace/applicationRouter";
import { resolvePanelRenderModel } from "@/core/workspace/gateway/presenterMap";
import { DashboardBoard } from "@/components/workspace/boards/DashboardBoard";
import { OpenInCanvasButton } from "./OpenInCanvasButton";
import { presentationGatewayDeps } from "../../presentationGatewayDeps";

// Application Composition demonstration (Phase 5): Application Registry ->
// Application Router (permission-checked) -> real panels resolved through
// the existing Presentation Gateway/Presenter pipeline (Phase 4B/4C) ->
// rendered through the existing generic Board (Phase 4). Nothing new is
// executed here — this page only composes pieces that already exist.
export default async function ApplicationPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const user = await requireAuthPage(`/workspace-preview/apps/${appId}`, ANY_AUTHENTICATED);

  const app = resolveApplication(appId, user.role);
  if (!app) notFound();

  const panels = await Promise.all(
    app.panels.map(async (p) => ({ title: p.title, model: await resolvePanelRenderModel(p.presenterId, presentationGatewayDeps) }))
  );

  return (
    <div className="min-h-screen bg-stone-50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-stone-900">{app.name} Application</h1>
          <p className="text-xs text-stone-400">{app.panels.length} panels · board: {app.boardType}</p>
        </div>
        <OpenInCanvasButton app={app} />
      </div>
      {panels.map((p, i) => (
        <div key={i} className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          {p.model ? (
            <DashboardBoard model={p.model} />
          ) : (
            <div className="p-4 text-xs text-stone-400">{p.title} — ยังไม่มี Presenter จริง (placeholder, no real data source yet)</div>
          )}
        </div>
      ))}
    </div>
  );
}