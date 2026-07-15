import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { createPresentationGateway } from "@/core/workspace/gateway/presentationGateway";
import { toRenderModel } from "@/core/workspace/presenters/partnerPresenter";
import { DashboardBoard } from "@/components/workspace/boards/DashboardBoard";
import { presentationGatewayDeps } from "../presentationGatewayDeps";

export default async function PartnerWidgetPage() {
  await requireAuthPage("/workspace-preview/partner", ADMIN_TIER);
  const dto = await createPresentationGateway(presentationGatewayDeps).getPartnerSummary();
  return <div className="min-h-screen bg-white"><DashboardBoard model={toRenderModel(dto)} /></div>;
}
