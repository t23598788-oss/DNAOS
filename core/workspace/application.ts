import type { AppRole } from "@/core/auth/session";
import type { BoardType } from "./board";

// Application Composition (Phase 5). Pure types + data — no I/O, safe to
// import from either server or client. An Application is a composition of
// existing pieces (Board, Presenters, Roles) — it never defines new
// business logic itself.

export type PresenterId =
  | "debt" | "partner" | "invoice" | "order" | "document" | "material" | "transport" | "workflow"
  // Named in the spec, no real Presenter exists for these yet (Phase 4/4C
  // findings: no backing query/aggregation) — kept as placeholder ids so an
  // Application can name its intended composition honestly, without a real
  // implementation pretending to exist.
  | "payment" | "cashflow" | "vat" | "system-status" | "timeline" | "alerts";

export interface ApplicationPanel {
  presenterId: PresenterId;
  title: string;
}

export interface ApplicationDefinition {
  id: string;
  name: string;
  boardType: BoardType;
  panels: ApplicationPanel[];
  requiredRoles: AppRole[];
}