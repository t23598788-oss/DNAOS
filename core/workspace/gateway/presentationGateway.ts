import { getAuthedUser, ADMIN_TIER } from "@/core/auth/session";
import type { DebtSummaryDTO } from "../presenters/debtPresenter";
import type { PartnerSummaryDTO } from "../presenters/partnerPresenter";
import type { InvoiceSummaryDTO } from "../presenters/invoicePresenter";
import type { OrderSummaryDTO } from "../presenters/orderPresenter";
import type { DocumentSummaryDTO } from "../presenters/documentPresenter";
import type { MaterialSummaryDTO } from "../presenters/materialPresenter";
import type { TransportSummaryDTO } from "../presenters/transportPresenter";
import type { WorkflowSummaryDTO } from "../presenters/workflowPresenter";

// Phase 2.3A: core must not import services/* or engines/* directly
// (registry/dependency-graph.json: allowed_imports.core = ["registry"]).
// Every real data function this Gateway needs is now injected — callers
// (already allowed to import services/ and engines/) supply the real
// implementations from @/services/supabase/queries and
// @/engines/transactions/state-machine via createPresentationGateway().
// These interfaces intentionally describe only the fields this file
// actually reads, not the full real return shape, so the real functions
// (which return richer objects) satisfy them structurally.
export interface WorkflowStepShape {
  event: string;
  label: string;
}

export interface WorkflowShape {
  label: string;
  steps: WorkflowStepShape[];
}

export interface PresentationGatewayDeps {
  getOpenDebts: () => Promise<{ id: string; outstanding_amount: number; invoice_status: string }[]>;
  getPartners: () => Promise<{ id: string; name: string; partner_type_label: string; phone: string }[]>;
  getDocuments: (docType?: string) => Promise<{
    id: string;
    document_number: string;
    status: string;
    party_name: string;
    net_amount: number;
    document_type: string;
  }[]>;
  getMaterialTypes: () => Promise<{ id: string; name: string }[]>;
  getTransactions: () => Promise<{
    id: string;
    title: string;
    state: string;
    tx_type: string;
    partners: { name?: string } | null;
  }[]>;
  getWorkflow(txType: string): WorkflowShape;
  // Method-shorthand syntax (not `prop: (fn) => T`) — TypeScript checks
  // method-signature parameters bivariantly, which is what allows the real
  // isFinalEvent/isPendingEvent (whose actual parameter is the richer
  // engines/transactions/workflows.ts TxWorkflow, a superset of
  // WorkflowShape) to satisfy this interface. Arrow-function-typed
  // properties are checked contravariantly and would reject them.
  isFinalEvent(workflow: WorkflowShape, event: string): boolean;
  isPendingEvent(workflow: WorkflowShape, event: string): boolean;
}

async function requireGatewayAuth() {
  const user = await getAuthedUser();
  if (!user || !ADMIN_TIER.includes(user.role)) {
    throw new Error("unauthorized");
  }
}

// Presentation Gateway (Phase 4B) — the ONLY place a Presenter's data may
// come from. This file is the sole server boundary: it owns authentication,
// authorization, and every call into the Service Layer / Business Engine
// (now injected rather than imported directly, Phase 2.3A). It is only ever
// used from Server Components (never from a "use client" file) — that's
// what keeps services/supabase/queries.ts's service-role client out of the
// browser bundle. Returns a shaped Presentation DTO, never a raw database
// row (getOpenDebts()'s rows carry fields like customer_order_id that have
// no reason to leave this file).
export function createPresentationGateway(deps: PresentationGatewayDeps) {
  return {
    async getDebtSummary(): Promise<DebtSummaryDTO> {
      await requireGatewayAuth();
      const debts = await deps.getOpenDebts();

      return {
        totalOutstanding: debts.reduce((sum, d) => sum + d.outstanding_amount, 0),
        openCount: debts.length,
        items: debts.map((d) => ({
          id: d.id,
          outstandingAmount: d.outstanding_amount,
          status: d.invoice_status,
        })),
      };
    },

    async getPartnerSummary(): Promise<PartnerSummaryDTO> {
      await requireGatewayAuth();
      const partners = await deps.getPartners();
      return {
        totalCount: partners.length,
        items: partners.map((p) => ({ id: p.id, name: p.name, type: p.partner_type_label, phone: p.phone })),
      };
    },

    async getInvoiceSummary(): Promise<InvoiceSummaryDTO> {
      await requireGatewayAuth();
      const invoices = await deps.getDocuments("invoice");
      return {
        totalCount: invoices.length,
        totalAmount: invoices.reduce((sum, i) => sum + i.net_amount, 0),
        items: invoices.map((i) => ({
          id: i.id,
          documentNumber: i.document_number,
          status: i.status,
          partyName: i.party_name,
          netAmount: i.net_amount,
        })),
      };
    },

    async getOrderSummary(): Promise<OrderSummaryDTO> {
      await requireGatewayAuth();
      const orders = await deps.getTransactions();
      return {
        totalCount: orders.length,
        items: orders.map((o) => ({
          id: o.id,
          orderNo: o.title,
          status: o.state,
          partnerName: o.partners?.name ?? "",
        })),
      };
    },

    async getDocumentSummary(): Promise<DocumentSummaryDTO> {
      await requireGatewayAuth();
      const documents = await deps.getDocuments();
      return {
        totalCount: documents.length,
        items: documents.map((d) => ({
          id: d.id,
          documentType: d.document_type,
          documentNumber: d.document_number,
          status: d.status,
          partyName: d.party_name,
        })),
      };
    },

    async getMaterialSummary(): Promise<MaterialSummaryDTO> {
      await requireGatewayAuth();
      const materials = await deps.getMaterialTypes();
      return {
        totalCount: materials.length,
        items: materials.map((m) => ({ id: m.id, name: m.name })),
      };
    },

    async getTransportSummary(): Promise<TransportSummaryDTO> {
      await requireGatewayAuth();
      // getJobs() queries transport_jobs, which does not exist anywhere in
      // the production schema — confirmed via live schema inspection
      // (2026-07-14, full public-schema table list checked, no
      // transport/job/delivery table found). Not calling it: it would only
      // throw. Returning an explicit unavailable state instead of a
      // fabricated or silently-empty one.
      return { available: false, totalCount: 0, items: [] };
    },

    async getWorkflowSummary(): Promise<WorkflowSummaryDTO> {
      await requireGatewayAuth();
      const orders = await deps.getTransactions();
      return {
        items: orders.map((o) => {
          const workflow = deps.getWorkflow(o.tx_type);
          const step = workflow.steps.find((s) => s.event === o.state);
          return {
            orderId: o.id,
            orderNo: o.title,
            txType: workflow.label,
            stepLabel: step?.label ?? o.state,
            isFinal: deps.isFinalEvent(workflow, o.state),
            isPending: deps.isPendingEvent(workflow, o.state),
          };
        }),
      };
    },
  };
}
