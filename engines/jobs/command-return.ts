/**
 * COMMAND RETURN ROUTING (Phase 7) — routes an execution result back to the
 * ORIGINAL requester through the ONE Response Gateway (deliverBusinessResult).
 *
 * No new sender. If the requester is unknown (no reply_to) the result is
 * retained and ROUTING_BLOCKED is reported — never guessed, never broadcast.
 * The injected `deliver` is engines/delivery/result-delivery.ts in production.
 */

export interface CommandRouting {
  source_channel?: string | null;   // "line" | "admin" | "mcp"
  reply_to?: string | null;         // line_user_id / conversation_id / mcp session id
  conversation_id?: string | null;
  provider_account?: string | null;
}

export interface CommandReturnDeps {
  deliver?: (input: { replyTo: string; channel: string; text: string; resultKey: string }) => Promise<{ status: string; messageId?: string }>;
}

export interface CommandReturnResult {
  ok: boolean;
  code?: "ROUTING_BLOCKED" | "DELIVERED" | "DELIVERY_FAILED";
  deliveryStatus?: string;
  messageId?: string | null;
  error?: string;
}

/** The original requester must be known; otherwise the result is retained. */
export function resolveReplyTarget(routing: CommandRouting | undefined): { channel: string; replyTo: string } | null {
  if (!routing?.reply_to) return null;
  return { channel: routing.source_channel ?? "unknown", replyTo: routing.reply_to };
}

export async function routeCommandResult(
  deps: CommandReturnDeps,
  input: { routing?: CommandRouting; result: unknown; resultKey: string },
): Promise<CommandReturnResult> {
  const target = resolveReplyTarget(input.routing);
  if (!target) {
    return { ok: false, code: "ROUTING_BLOCKED", error: "no reply_to — result retained, never guessed" };
  }
  if (!deps.deliver) {
    return { ok: false, code: "ROUTING_BLOCKED", error: "no delivery gateway configured" };
  }

  const text = typeof input.result === "string"
    ? input.result
    : (() => { try { return JSON.stringify(input.result ?? {}); } catch { return String(input.result ?? ""); } })();

  const delivery = await deps.deliver({
    replyTo: target.replyTo,
    channel: target.channel,
    text,
    resultKey: input.resultKey,
  });

  if (delivery.status === "SENT") {
    return { ok: true, code: "DELIVERED", deliveryStatus: delivery.status, messageId: delivery.messageId ?? null };
  }
  return { ok: false, code: "DELIVERY_FAILED", deliveryStatus: delivery.status };
}
