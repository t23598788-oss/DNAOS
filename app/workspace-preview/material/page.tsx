import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { createPresentationGateway } from "@/core/workspace/gateway/presentationGateway";
import { toRenderModel } from "@/core/workspace/presenters/materialPresenter";
import { DashboardBoard } from "@/presentation/shell/workspace/DashboardBoard";
import { presentationGatewayDeps } from "../presentationGatewayDeps";

export default async function MaterialWidgetPage() {
  await requireAuthPage("/workspace-preview/material", ADMIN_TIER);
  const dto = await createPresentationGateway(presentationGatewayDeps).getMaterialSummary();
  return <div className="min-h-screen bg-white"><DashboardBoard model={toRenderModel(dto)} /></div>;
}
