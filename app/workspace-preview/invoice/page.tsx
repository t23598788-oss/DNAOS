import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { createPresentationGateway } from "@/core/workspace/gateway/presentationGateway";
import { toRenderModel } from "@/core/workspace/presenters/invoicePresenter";
import { DashboardBoard } from "@/components/workspace/boards/DashboardBoard";
import { presentationGatewayDeps } from "../presentationGatewayDeps";

export default async function InvoiceWidgetPage() {
  await requireAuthPage("/workspace-preview/invoice", ADMIN_TIER);
  const dto = await createPresentationGateway(presentationGatewayDeps).getInvoiceSummary();
  return <div className="min-h-screen bg-white"><DashboardBoard model={toRenderModel(dto)} /></div>;
}
