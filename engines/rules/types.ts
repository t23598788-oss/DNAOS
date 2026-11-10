/**
 * Rules engine — shared types.
 *
 * Vocabulary used by the whole feature (migration
 * 20261110120000_role_mapping_and_event_rules.sql):
 *
 *   BusinessEvent  what happened (EVENT_ORDER_CREATED, EVENT_TRUCK_DELIVERED, ...)
 *   EventRule      stored rule: event_type + conditions → target roles + action
 *   Recipient      a resolved LINE push target for one role
 *   RuleRunResult  what actually happened when the rule was evaluated
 *
 * Kept free of Supabase/Next imports so the matcher and the message renderer
 * can be unit-tested (and reused by an edge function) without a database.
 */

/** Network role codes seeded in role_definitions. Extra codes may exist. */
export const NETWORK_ROLE_CODES = [
  "ROLE_CUSTOMER",
  "ROLE_SUPPLIER_SAND",
  "ROLE_TRANSPORTER",
  "ROLE_ENGINEER",
] as const;

export type NetworkRoleCode = (typeof NETWORK_ROLE_CODES)[number];

export type RuleAction = "notify_line" | "flag_exception";
export type RuleChannel = "line" | "in_app";

/** One business event, as produced by the order/truck/line webhooks. */
export interface BusinessEvent {
  /** e.g. EVENT_ORDER_CREATED, EVENT_TRUCK_DELIVERED */
  type: string;
  /** Free-form business payload; template placeholders read from here. */
  payload: Record<string, unknown>;
  /** Stable id of the underlying record (order id, job id, ...) for the log. */
  key?: string | null;
  /** ISO timestamp; defaults to now() at dispatch time. */
  occurredAt?: string;
}

/** One row of public.event_rules. */
export interface EventRule {
  id: string;
  code: string;
  name: string;
  event_type: string;
  target_roles: string[];
  action: RuleAction;
  channel: RuleChannel;
  message_template: string | null;
  conditions: Record<string, unknown>;
  priority: number;
  active: boolean;
}

/** A person/company that will receive the routed notification. */
export interface Recipient {
  roleCode: string;
  lineUserId: string | null;
  displayName: string | null;
  assignmentId: string;
  subjectKind: "partner" | "line_user" | "profile";
  subjectId: string;
}

/** Per-rule evaluation outcome, written to event_rule_runs. */
export interface RuleRunOutcome {
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  matched: boolean;
  reason: string;
  recipients: Recipient[];
  status: "logged" | "sent" | "partial" | "failed" | "skipped";
  error: string | null;
}

/** Whole-event outcome returned to the API/UI. */
export interface RuleRunResult {
  event: BusinessEvent;
  mode: "dry_run" | "live";
  evaluated: number;
  matched: number;
  sent: number;
  failed: number;
  outcomes: RuleRunOutcome[];
}
