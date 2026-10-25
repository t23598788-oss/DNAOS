import { getOpenDebts, getPartners, getDocuments, getMaterialTypes, getTransactions } from "@/services/supabase/queries";
import { getWorkflow, isFinalEvent, isPendingEvent } from "@/engines/transactions/state-machine";
import type { PresentationGatewayDeps } from "@/core/workspace/gateway/presentationGateway";

// Phase 2.3A: core/workspace/gateway/presentationGateway.ts no longer
// imports services/engines directly — it takes them as injected deps. This
// is the one place under app/ (already allowed to import services/ and
// engines/) that supplies the real implementations, shared by every page
// in this directory instead of each one repeating the same 8 imports.
export const presentationGatewayDeps: PresentationGatewayDeps = {
  getOpenDebts,
  getPartners,
  getDocuments,
  getMaterialTypes,
  getTransactions,
  getWorkflow,
  isFinalEvent,
  isPendingEvent,
};
