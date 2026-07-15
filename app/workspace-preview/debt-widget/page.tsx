import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { createPresentationGateway } from "@/core/workspace/gateway/presentationGateway";
import { toRenderModel } from "@/core/workspace/presenters/debtPresenter";
import { DashboardBoard } from "@/components/workspace/boards/DashboardBoard";
import { presentationGatewayDeps } from "../presentationGatewayDeps";

// Debt Widget — the first real vertical slice (Phase 4B):
// Business Engine (services/supabase/queries.ts's getOpenDebts, backed by
// real invoices) -> Presentation Gateway (auth + the only Supabase call) ->
// Debt Presenter (pure transform) -> RenderModel -> Dashboard Board.
//
// This is a Server Component — it runs entirely on the server, awaits the
// Gateway call directly (no API route needed, no client-side fetch), and
// only ever passes the plain, serializable RenderModel down to
// DashboardBoard, a Client Component. That boundary is what keeps
// getDebtSummary/getOpenDebts/supabaseAdmin out of the browser bundle.
export default async function DebtWidgetPage() {
  await requireAuthPage("/workspace-preview/debt-widget", ADMIN_TIER);

  const dto = await createPresentationGateway(presentationGatewayDeps).getDebtSummary();
  const model = toRenderModel(dto);

  return (
    <div className="min-h-screen bg-white">
      <DashboardBoard model={model} />
    </div>
  );
}