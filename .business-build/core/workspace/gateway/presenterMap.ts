import type { PresenterId } from "../application";
import type { RenderModel } from "../renderModel";
import { createPresentationGateway, type PresentationGatewayDeps } from "./presentationGateway";
import { toRenderModel as debtToRenderModel } from "../presenters/debtPresenter";
import { toRenderModel as partnerToRenderModel } from "../presenters/partnerPresenter";
import { toRenderModel as invoiceToRenderModel } from "../presenters/invoicePresenter";
import { toRenderModel as orderToRenderModel } from "../presenters/orderPresenter";
import { toRenderModel as documentToRenderModel } from "../presenters/documentPresenter";
import { toRenderModel as materialToRenderModel } from "../presenters/materialPresenter";
import { toRenderModel as transportToRenderModel } from "../presenters/transportPresenter";
import { toRenderModel as workflowToRenderModel } from "../presenters/workflowPresenter";

// Presenter Map (Phase 5) — server-only. This is the one place that
// actually knows how to go from a PresenterId to a real RenderModel: call
// the Gateway, then the matching Presenter. Only ids with a real Gateway
// function + Presenter are listed; every id from Phase 4C's gap list
// (payment/cashflow/vat/system-status/timeline/alerts) is deliberately
// absent, so resolvePanelRenderModel returns null for them — the caller
// renders a placeholder, nothing here fabricates data.
//
// Phase 2.3A: core must not import services/* or engines/* directly
// (registry/dependency-graph.json). The real query/workflow functions are
// no longer imported here — the caller (in app/, already allowed to import
// services/engines) builds a PresentationGatewayDeps and passes it in.
export async function resolvePanelRenderModel(
  id: PresenterId,
  deps: PresentationGatewayDeps
): Promise<RenderModel | null> {
  const gateway = createPresentationGateway(deps);

  const RESOLVERS: Partial<Record<PresenterId, () => Promise<RenderModel>>> = {
    debt: async () => debtToRenderModel(await gateway.getDebtSummary()),
    partner: async () => partnerToRenderModel(await gateway.getPartnerSummary()),
    invoice: async () => invoiceToRenderModel(await gateway.getInvoiceSummary()),
    order: async () => orderToRenderModel(await gateway.getOrderSummary()),
    document: async () => documentToRenderModel(await gateway.getDocumentSummary()),
    material: async () => materialToRenderModel(await gateway.getMaterialSummary()),
    transport: async () => transportToRenderModel(await gateway.getTransportSummary()),
    workflow: async () => workflowToRenderModel(await gateway.getWorkflowSummary()),
  };

  const resolver = RESOLVERS[id];
  if (!resolver) return null;
  return resolver();
}
