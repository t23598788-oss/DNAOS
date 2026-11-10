/**
 * Rules engine — dispatch.
 *
 * The executable half of "ถ้าเกิด Event นี้ → ยิงข้อความ/งานไปหา Role ไหน":
 *
 *   event  →  load active rules for that event type (priority order)
 *          →  match conditions (engines/rules/matching.ts)
 *          →  resolve role holders (engines/rules/recipients.ts)
 *          →  render the message template
 *          →  send through the ONE outbound gateway (registry/communication)
 *          →  append one event_rule_runs row per evaluated rule
 *
 * Two modes, and the difference is visible in the log:
 *   dryRun: true  → resolve + render only, nothing leaves the system ("logged")
 *   dryRun: false → actually pushes LINE messages ("sent" / "partial" / "failed")
 *
 * The caller decides the mode. The admin UI defaults to dry run so testing a
 * rule can never message real customers by accident; a live dispatch is an
 * explicit second action.
 *
 * Sender is injectable so tests (and an edge function) can run without LINE.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { explainMatch, readPath } from "./matching";
import { resolveRecipients } from "./recipients";
import type { BusinessEvent, EventRule, RuleRunOutcome, RuleRunResult } from "./types";

export interface SendResult {
  success: boolean;
  error?: string;
}

export type LineSender = (db: SupabaseClient, to: string, messages: unknown[]) => Promise<SendResult>;

export interface DispatchOptions {
  /** Supabase client (service_role). Required for real reads/writes. */
  db: SupabaseClient;
  /** true = evaluate + log only. Defaults to true — safe by default. */
  dryRun?: boolean;
  /** Injected sender; defaults to the canonical LINE gateway. */
  sendLine?: LineSender;
  /** Clock override for tests. */
  now?: Date;
}

const DEFAULT_FALLBACK = "—";

/** `{{order_no}}` / `{{customer.name}}` → payload value, else em dash. */
export function renderTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, path: string) => {
    const value = readPath(payload, path);
    if (value === null || value === undefined || value === "") return DEFAULT_FALLBACK;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

interface RuleRow {
  id: string;
  code: string;
  name: string;
  event_type: string;
  target_roles: string[] | null;
  action: EventRule["action"];
  channel: EventRule["channel"];
  message_template: string | null;
  conditions: Record<string, unknown> | null;
  priority: number;
  active: boolean;
}

function toRule(row: RuleRow): EventRule {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    event_type: row.event_type,
    target_roles: row.target_roles ?? [],
    action: row.action,
    channel: row.channel,
    message_template: row.message_template,
    conditions: row.conditions ?? {},
    priority: row.priority,
    active: row.active,
  };
}

async function defaultSender(db: SupabaseClient, to: string, messages: unknown[]): Promise<SendResult> {
  // Lazy import keeps this module usable (and testable) without pulling the
  // connector lifecycle in when a sender is injected.
  const { sendLineMessage } = await import("@/registry/communication");
  return sendLineMessage(db, to, messages as never);
}

async function logRun(
  db: SupabaseClient,
  event: BusinessEvent,
  outcome: RuleRunOutcome,
  mode: "dry_run" | "live",
  occurredAt: string,
): Promise<void> {
  const { error } = await db.from("event_rule_runs").insert({
    rule_id: outcome.ruleId,
    rule_code: outcome.ruleCode,
    event_type: event.type,
    event_key: event.key ?? null,
    payload: { ...event.payload, _occurred_at: occurredAt, _reason: outcome.reason },
    mode,
    matched: outcome.matched,
    targets: outcome.recipients.map((r) => ({
      role: r.roleCode,
      line_user_id: r.lineUserId,
      name: r.displayName,
    })),
    status: outcome.status,
    error: outcome.error,
  });
  if (error) {
    // Logging must never break the dispatch result the caller sees; the send
    // already happened (or was deliberately not sent), so we only record it.
    console.error("[rules] failed to write event_rule_runs:", error.message);
  }
}

/**
 * Evaluate every active rule for this event and (in live mode) send.
 *
 * Never throws on a per-rule failure: one broken role mapping or one failed
 * LINE push must not stop the other roles from being notified. Failures are
 * returned in `outcomes` and written to event_rule_runs.
 */
export async function runRulesForEvent(
  event: BusinessEvent,
  options: DispatchOptions,
): Promise<RuleRunResult> {
  const { db } = options;
  const mode: "dry_run" | "live" = options.dryRun === false ? "live" : "dry_run";
  const sender = options.sendLine ?? defaultSender;
  const occurredAt = event.occurredAt ?? (options.now ?? new Date()).toISOString();

  const { data, error } = await db
    .from("event_rules")
    .select(
      "id, code, name, event_type, target_roles, action, channel, message_template, conditions, priority, active",
    )
    .eq("active", true)
    .in("event_type", [event.type, "*"])
    .order("priority", { ascending: true });

  if (error) {
    throw new Error(`rules: failed to read event_rules: ${error.message}`);
  }

  const rules = ((data ?? []) as RuleRow[]).map(toRule);
  const outcomes: RuleRunOutcome[] = [];

  for (const rule of rules) {
    const judgement = explainMatch(rule, event);

    if (!judgement.matched) {
      const outcome: RuleRunOutcome = {
        ruleId: rule.id,
        ruleCode: rule.code,
        ruleName: rule.name,
        matched: false,
        reason: judgement.reason,
        recipients: [],
        status: "skipped",
        error: null,
      };
      outcomes.push(outcome);
      await logRun(db, event, outcome, mode, occurredAt);
      continue;
    }

    let recipients = [] as RuleRunOutcome["recipients"];
    try {
      const resolution = await resolveRecipients(db, rule.target_roles);
      recipients = resolution.unique;
    } catch (recipientError) {
      const message = recipientError instanceof Error ? recipientError.message : String(recipientError);
      const outcome: RuleRunOutcome = {
        ruleId: rule.id,
        ruleCode: rule.code,
        ruleName: rule.name,
        matched: true,
        reason: judgement.reason,
        recipients: [],
        status: "failed",
        error: message,
      };
      outcomes.push(outcome);
      await logRun(db, event, outcome, mode, occurredAt);
      continue;
    }

    // flag_exception is an in-app signal only: the run row IS the signal, so
    // there is no outbound message even in live mode.
    if (rule.action === "flag_exception" || rule.channel === "in_app") {
      const outcome: RuleRunOutcome = {
        ruleId: rule.id,
        ruleCode: rule.code,
        ruleName: rule.name,
        matched: true,
        reason: `${judgement.reason}; action=${rule.action} (in-app only)`,
        recipients,
        status: "logged",
        error: null,
      };
      outcomes.push(outcome);
      await logRun(db, event, outcome, mode, occurredAt);
      continue;
    }

    if (mode === "dry_run") {
      const outcome: RuleRunOutcome = {
        ruleId: rule.id,
        ruleCode: rule.code,
        ruleName: rule.name,
        matched: true,
        reason: judgement.reason,
        recipients,
        status: "logged",
        error: null,
      };
      outcomes.push(outcome);
      await logRun(db, event, outcome, mode, occurredAt);
      continue;
    }

    const text = renderTemplate(rule.message_template ?? rule.name, event.payload);
    let sent = 0;
    const failures: string[] = [];

    for (const recipient of recipients) {
      if (!recipient.lineUserId) continue;
      try {
        const result = await sender(db, recipient.lineUserId, [{ type: "text", text }]);
        if (result.success) sent += 1;
        else failures.push(`${recipient.lineUserId}: ${result.error ?? "send failed"}`);
      } catch (sendError) {
        failures.push(
          `${recipient.lineUserId}: ${sendError instanceof Error ? sendError.message : String(sendError)}`,
        );
      }
    }

    const outcome: RuleRunOutcome = {
      ruleId: rule.id,
      ruleCode: rule.code,
      ruleName: rule.name,
      matched: true,
      reason: judgement.reason,
      recipients,
      status: failures.length === 0 ? "sent" : sent > 0 ? "partial" : "failed",
      error: failures.length > 0 ? failures.join(" | ") : null,
    };
    outcomes.push(outcome);
    await logRun(db, event, outcome, mode, occurredAt);
  }

  return {
    event,
    mode,
    evaluated: outcomes.length,
    matched: outcomes.filter((o) => o.matched).length,
    sent: outcomes.filter((o) => o.status === "sent" || o.status === "partial").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    outcomes,
  };
}
