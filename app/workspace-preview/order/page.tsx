import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { createPresentationGateway } from "@/core/workspace/gateway/presentationGateway";
import { toRenderModel } from "@/core/workspace/presenters/orderPresenter";
import { DashboardBoard } from "@/components/workspace/boards/DashboardBoard";
import { presentationGatewayDeps } from "../presentationGatewayDeps";

export default async function OrderWidgetPage() {
  await requireAuthPage("/workspace-preview/order", ADMIN_TIER);
  const dto = await createPresentationGateway(presentationGatewayDeps).getOrderSummary();
  return <div className="min-h-screen bg-white"><DashboardBoard model={toRenderModel(dto)} /></div>;
}
