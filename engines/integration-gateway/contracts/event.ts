/**
 * Integration Gateway — Canonical Event Contract (owner, 2026-08-05).
 *
 * The one shape every provider (GitHub, Supabase, Vercel, VS Code, ChatGPT
 * MCP, ...) gets translated into before anything inside DNA OS Core ever
 * sees it. Adapters (engines/integration-gateway/adapters/*) are the only
 * code allowed to construct one of these from a provider's native payload —
 * nothing downstream (event-bus, evidence, policy, Registry/Governance/
 * Runtime) ever reads a raw GitHub/Supabase/Vercel payload directly.
 *
 * Three channels, built in this order (Observe first — safest, no side
 * effects; Proposal once Observe is proven for GitHub+Supabase+Vercel;
 * Execution last, and only for actions the Deploy Gate + Owner already
 * approved):
 *   - "observe"   — read-only status/event, never requests a change.
 *   - "propose"   — AI or system proposes a command; not run yet.
 *   - "execute"   — runs, but only once Deploy Gate + Owner have approved it.
 *
 * This file is scaffolding only, per explicit instruction: it does not move
 * or replace scripts/watch-registry.ts, scripts/impact-analyzer.ts,
 * scripts/deploy-gate.ts, or the dev_loop_* tables built 2026-08-05 — those
 * keep working exactly as they are. The Gateway is a new translation layer
 * ABOVE provider adapters, not a replacement for what already exists.
 */

export type GatewayChannel = "observe" | "propose" | "execute";

export type GatewayProvider = "github" | "supabase" | "vercel" | "vscode" | "chatgpt-mcp";

/**
 * Capability strings are dot-namespaced, provider-agnostic verbs — e.g.
 * "source.change.detected" (GitHub push/PR), "database.health.observed"
 * (Supabase), "deployment.status.observed" (Vercel). New capabilities get
 * added here as new adapters are built; never invented ad hoc inside an
 * adapter.
 */
export type GatewayCapability =
  | "source.change.detected"
  | "source.workflow.status"
  | "database.health.observed"
  | "database.migration.observed"
  | "deployment.status.observed"
  | "workspace.file.changed"
  | "intent.received"
  // Proposal Channel (owner, 2026-08-05) — requests a run of an
  // already-whitelisted Automation command; never runs on its own.
  | "automation.command.proposed";

export interface GatewayEvent {
  event_id: string;
  provider: GatewayProvider;
  capability: GatewayCapability;
  channel: GatewayChannel;
  action: "observe" | "propose" | "execute";
  session_id: string | null;
  change_id: string | null;
  evidence: Record<string, unknown>;
  requested_effect: string;
  requires_owner_approval: boolean;
  occurred_at: string;
}

export function isGatewayEvent(value: unknown): value is GatewayEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.event_id === "string" &&
    typeof v.provider === "string" &&
    typeof v.capability === "string" &&
    typeof v.channel === "string" &&
    typeof v.action === "string" &&
    typeof v.evidence === "object" &&
    typeof v.requested_effect === "string" &&
    typeof v.requires_owner_approval === "boolean" &&
    typeof v.occurred_at === "string"
  );
}
