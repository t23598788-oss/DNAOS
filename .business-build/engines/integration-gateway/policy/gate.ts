/**
 * Integration Gateway — Policy Gate (owner, 2026-08-05).
 * One real switch, not a stub with a TODO: which channels are enabled right
 * now. Observe opened first (2026-08-05). Propose opened the same day, once
 * Observe was proven end-to-end for the Supabase adapter — a Proposal
 * Channel event can only ever request a run of an already-whitelisted
 * Automation command (engines/integration-gateway/automationCommands.ts)
 * and never executes on its own; approval still requires a real Owner
 * session via app/api/gateway/proposals/[id]/decide/route.ts. Execution
 * Channel (a general-purpose "run anything approved" path beyond the
 * Automation whitelist) is not open yet. event-bus/bus.ts calls
 * channelIsEnabled() before every publish — this is what actually prevents
 * an Execute-channel event from reaching Registry/Governance/Runtime before
 * that channel is real, not just a naming convention.
 */
import type { GatewayChannel } from "../contracts/event";

const ENABLED_CHANNELS: readonly GatewayChannel[] = ["observe", "propose"];

export function channelIsEnabled(channel: GatewayChannel): boolean {
  return ENABLED_CHANNELS.includes(channel);
}

/**
 * Execution Channel's real gate, wired now so turning it on later is a
 * one-line change to ENABLED_CHANNELS, not new policy logic: reuses the
 * existing Deploy Gate (scripts/deploy-gate.ts's dev_loop_check_results /
 * dev_loop_registry_proposals checks) plus an explicit Owner approval flag.
 * Not called by anything yet — Execution Channel isn't open — kept here so
 * the real rule is written down before it's needed, not invented later
 * under time pressure.
 */
export function canExecute(_opts: { deployGatePassed: boolean; ownerApproved: boolean }): boolean {
  if (!channelIsEnabled("execute")) return false;
  return _opts.deployGatePassed && _opts.ownerApproved;
}
