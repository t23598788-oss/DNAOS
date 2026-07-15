import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { createPresentationGateway } from "@/core/workspace/gateway/presentationGateway";
import { toRenderModel } from "@/core/workspace/presenters/documentPresenter";
import { DashboardBoard } from "@/components/workspace/boards/DashboardBoard";
import { presentationGatewayDeps } from "../presentationGatewayDeps";
import { DocumentEngineRuntimeRegistration } from "./DocumentEngineRuntimeRegistration";

export default async function DocumentWidgetPage() {
  await requireAuthPage("/workspace-preview/document", ADMIN_TIER);
  const dto = await createPresentationGateway(presentationGatewayDeps).getDocumentSummary();
  return (
    <div className="min-h-screen bg-white">
      <DashboardBoard model={toRenderModel(dto)} />
      <DocumentEngineRuntimeRegistration />
    </div>
  );
}
