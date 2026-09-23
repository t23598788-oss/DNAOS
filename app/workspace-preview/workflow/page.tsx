import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { createPresentationGateway } from "@/core/workspace/gateway/presentationGateway";
import { toRenderModel } from "@/core/workspace/presenters/workflowPresenter";
import { DashboardBoard } from "@/presentation/shell/workspace/DashboardBoard";
import { presentationGatewayDeps } from "../presentationGatewayDeps";

export default async function WorkflowWidgetPage() {
  await requireAuthPage("/workspace-preview/workflow", ADMIN_TIER);
  const dto = await createPresentationGateway(presentationGatewayDeps).getWorkflowSummary();
  return <div className="min-h-screen bg-white"><DashboardBoard model={toRenderModel(dto)} /></div>;
}
