/**
 * หน้าที่: turn one `DigitalOceanIntent` into the real endpoint/method/
 * required-scope this connector must call — read directly from
 * `../../providers/digitalocean/definition/actions.json` and `billing.json`,
 * never hardcoded here. This is what makes
 * `../../providers/digitalocean/definition/*` the actual source-of-truth
 * Owner required, rather than this connector quietly re-encoding its own
 * copy of the same facts.
 *
 * Input: a `DigitalOceanIntent`.
 * Output: `ResolvedAction | undefined` (undefined = the intent maps to a
 * resource/action pair not found in the definition files — treated as a
 * hard failure by the caller, never silently substituted).
 * Dependency ที่อนุญาต:
 * `../../providers/digitalocean/definition/actions.json`,
 * `../../providers/digitalocean/definition/billing.json` (both read via
 * `resolveJsonModule`, already enabled repo-wide — see tsconfig.json),
 * `./adapter-contract`.
 * สิ่งที่ห้ามแตะ: never hardcode an endpoint, method, or scope string in
 * this file as a fallback if the JSON lookup misses — a miss must be
 * reported as `undefined`, not papered over.
 */

import actionsDefinition from "../../providers/digitalocean/definition/actions.json";
import billingDefinition from "../../providers/digitalocean/definition/billing.json";
import { DIGITALOCEAN_INTENTS, type DigitalOceanIntent } from "./adapter-contract";

export interface ResolvedAction {
  resource: string;
  action: string;
  endpoint: string;
  method: string;
  /** A real DigitalOcean scope string, or the literal "not_confirmed" when `../../providers/digitalocean/definition/actions.json`/`billing.json` themselves recorded it as not_confirmed — see ./authorization.ts for how that case is handled (never silently skipped). */
  required_scope: string;
  source_file: "actions.json" | "billing.json";
}

interface IntentLookupKey {
  file: "actions" | "billing";
  resource: string;
  action: string;
}

/** The one place a Phase-1 intent is mapped to which record in the definition files answers it. Every entry here must correspond to a real record already present in actions.json/billing.json — verified in ./tests/adapter.test.ts, not just asserted here. */
const INTENT_LOOKUP_KEYS: Record<DigitalOceanIntent, IntentLookupKey> = {
  [DIGITALOCEAN_INTENTS.accountRead]: { file: "actions", resource: "account", action: "GET" },
  [DIGITALOCEAN_INTENTS.regionsList]: { file: "actions", resource: "regions", action: "LIST" },
  [DIGITALOCEAN_INTENTS.sizesList]: { file: "actions", resource: "sizes", action: "LIST" },
  [DIGITALOCEAN_INTENTS.dropletsList]: { file: "actions", resource: "droplets", action: "LIST" },
  [DIGITALOCEAN_INTENTS.billingRead]: { file: "billing", resource: "balance", action: "GET" },
};

interface DefinitionRecord {
  resource: string;
  action: string;
  endpoint: string | null;
  method: string | null;
  scope?: string | null;
}

export function resolveAction(intent: DigitalOceanIntent): ResolvedAction | undefined {
  const key = INTENT_LOOKUP_KEYS[intent];
  if (key === undefined) return undefined;

  if (key.file === "actions") {
    const record = (actionsDefinition.actions as DefinitionRecord[]).find((r) => r.resource === key.resource && r.action === key.action);
    if (record === undefined || record.endpoint === null || record.method === null) return undefined;
    return {
      resource: record.resource,
      action: record.action,
      endpoint: record.endpoint,
      method: record.method,
      required_scope: record.scope ?? "not_confirmed",
      source_file: "actions.json",
    };
  }

  const record = (billingDefinition.endpoints as DefinitionRecord[]).find((r) => r.resource === key.resource && r.action === key.action);
  if (record === undefined || record.endpoint === null || record.method === null) return undefined;
  return {
    resource: record.resource,
    action: record.action,
    endpoint: record.endpoint,
    method: record.method,
    required_scope: record.scope ?? "not_confirmed",
    source_file: "billing.json",
  };
}
