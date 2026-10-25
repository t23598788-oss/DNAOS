#!/usr/bin/env npx tsx
/**
 * Transitional Layer Removal Checker (owner, 2026-08-05).
 *
 * Reads registry/transitional-layers.json — never edits code, never deletes
 * anything. For each entry the OWNER has already marked
 * removal_condition_met: true (this script never sets that flag itself —
 * only a human verifying Runtime/Registry/End-to-End can), it runs a real
 * dependents check via engines/workspace/dependencyRegistry.ts's
 * getDependents() against the entry's owner_module, then proposes removal
 * through the existing Integration Gateway Proposal Channel
 * (engines/integration-gateway/event-bus/bus.ts's publish(), capability
 * "transitional_layer.removal_proposed") — the exact same
 * integration_gateway_proposals table and review flow every other proposal
 * in this app already uses. Nothing here auto-removes a layer; approval
 * still requires an owner decision via /api/gateway/proposals/[id]/decide,
 * and that route only knows how to execute whitelisted Automation commands,
 * so a removal proposal always stays a review record for the owner to act
 * on manually — by design, not an oversight.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { getDependents } from "../engines/workspace/dependencyRegistry";
import { publish } from "../engines/integration-gateway/event-bus/bus";
import type { GatewayEvent } from "../engines/integration-gateway/contracts/event";

const ROOT = join(__dirname, "..");

try {
  const envFile = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    if (!process.env[key]) process.env[key] = line.slice(i + 1);
  }
} catch {
  // no .env.local — falls through to the missing-env-var check below
}

interface TransitionalLayer {
  component: string;
  owner_module: string;
  temporary_reason: string;
  replacement_target: string;
  removal_condition: string;
  removal_phase: string;
  blocking_dependency: string;
  estimated_removal: string;
  removal_condition_met: boolean;
  status: "TRANSITIONAL" | "REMOVAL_PROPOSED" | "REMOVED";
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[check-transitional-layers] missing Supabase env vars");
    process.exit(1);
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const registryPath = join(ROOT, "registry/transitional-layers.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf-8")) as { layers: TransitionalLayer[] };

  const eligible = registry.layers.filter((l) => l.removal_condition_met && l.status === "TRANSITIONAL");

  if (eligible.length === 0) {
    console.log(`[check-transitional-layers] 0 of ${registry.layers.length} entries have removal_condition_met: true — nothing to propose.`);
    return;
  }

  for (const layer of eligible) {
    const dependents = getDependents(layer.owner_module);
    const event: GatewayEvent = {
      event_id: `EVT-propose-removal-${layer.component.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}`,
      provider: "vscode",
      capability: "transitional_layer.removal_proposed",
      channel: "propose",
      action: "propose",
      session_id: null,
      change_id: null,
      evidence: {
        component: layer.component,
        owner_module: layer.owner_module,
        replacement_target: layer.replacement_target,
        removal_condition: layer.removal_condition,
        dependents: dependents.map((d) => d.source),
        dependents_count: dependents.length,
      },
      requested_effect: `remove Transitional Layer: ${layer.component}`,
      requires_owner_approval: true,
      occurred_at: new Date().toISOString(),
    };

    const result = await publish(db, event);
    if (result.ok) {
      console.log(`[check-transitional-layers] proposed removal for "${layer.component}" — ${dependents.length} real dependent(s) found, evidence attached. event_id=${event.event_id}`);
    } else {
      console.error(`[check-transitional-layers] failed to propose removal for "${layer.component}": ${result.reason}`);
    }
  }
}

main().catch((e) => {
  console.error("[check-transitional-layers] fatal:", e);
  process.exit(1);
});
