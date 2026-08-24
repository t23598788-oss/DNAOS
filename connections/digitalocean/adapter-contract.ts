/**
 * หน้าที่: this capability's own intents, payload shape, and normalized
 * result types — Phase 1 (Owner-approved, 2026-08-17): READ ONLY. Every
 * intent below maps to exactly one GET action already recorded in
 * `../../providers/digitalocean/definition/actions.json` or `billing.json`
 * (see ./provider-action-lookup.ts) — this file does not invent an
 * endpoint or scope, it only names the five capabilities Owner approved
 * and shapes what each returns.
 *
 * Input: none (pure type definitions + intent/event-type constants).
 * Output: the types below.
 * Dependency ที่อนุญาต: `../../contracts/command/command-envelope.ts`,
 * `../../contracts/event/event-envelope.ts`,
 * `../../contracts/command/routing-result.ts`,
 * `../../contracts/command/capability-result.ts` (for
 * `CapabilityResultEvidence`, the shared "evidence" shape).
 * สิ่งที่ห้ามแตะ: no CREATE/UPDATE/DELETE intent, payload, or result type
 * anywhere in this file — see NOT_YET_BUILT at the bottom. No field in any
 * result type may hold a token/secret value — only `credential_source`
 * (a safe-to-log Vault URI, never the resolved secret) is allowed.
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { EventEnvelope } from "../../contracts/event/event-envelope";
import type { RoutingResult } from "../../contracts/command/routing-result";
import type { CapabilityResultEvidence } from "../../contracts/command/capability-result";
import type { AuthMethod } from "../../credentials/provider-accounts/digitalocean/types";

/** Must equal this folder's own name under `../` — mirrors connections/github/adapter-contract.ts's GITHUB_ADAPTER_NAME convention. */
export const DIGITALOCEAN_ADAPTER_NAME = "digitalocean";

/** The complete set of `CommandEnvelope.intent` values this adapter answers in Phase 1. Anything else is rejected at "classify". */
export const DIGITALOCEAN_INTENTS = {
  accountRead: "digitalocean.account.read",
  regionsList: "digitalocean.regions.list",
  sizesList: "digitalocean.sizes.list",
  dropletsList: "digitalocean.droplets.list",
  billingRead: "digitalocean.billing.read",
} as const;

export type DigitalOceanIntent = (typeof DIGITALOCEAN_INTENTS)[keyof typeof DIGITALOCEAN_INTENTS];

/** The complete set of `EventEnvelope.event_type` values this adapter emits in Phase 1. */
export const DIGITALOCEAN_EVENT_TYPES = {
  accountRead: "digitalocean.account.read.completed",
  regionsListed: "digitalocean.regions.list.completed",
  sizesListed: "digitalocean.sizes.list.completed",
  dropletsListed: "digitalocean.droplets.list.completed",
  billingRead: "digitalocean.billing.read.completed",
} as const;

/**
 * Every Phase-1 request payload. `digitalocean_team_id` and `auth_method`
 * are both required, never defaulted — a caller must say exactly which
 * team and which of DigitalOcean's distinct credential systems (see
 * `../../providers/digitalocean/definition/provider.json` auth_methods)
 * it means, so this adapter never silently guesses which of an account's
 * possibly-several bindings to use.
 */
export interface DigitalOceanReadPayload {
  digitalocean_team_id: string;
  auth_method: AuthMethod;
}

/** Fields every Phase-1 result shares: was the real HTTP call itself successful, and which credential (by safe reference, never value) made it. */
interface DigitalOceanResultBase {
  http_status: number | null;
  /** The Vault URI actually used, e.g. "vault://digitalocean/team-001/control-token" — NEVER the resolved secret. */
  credential_source: string;
  fetched_at: string;
}

export interface DigitalOceanAccountResult extends DigitalOceanResultBase {
  email: string | null;
  uuid: string | null;
  status: string | null;
  /** The only field independently re-verified in the account response schema this round — see providers/digitalocean/definition/actions.json's account record. */
  droplet_limit: number | null;
  /** Every top-level key the real response actually had — an honesty net so a caller can see what this normalizer chose not to surface, rather than this shape silently claiming completeness. */
  raw_available_fields: readonly string[];
}

export interface DigitalOceanRegionSummary {
  slug: string;
  name: string;
  available: boolean;
  sizes: readonly string[];
}
export interface DigitalOceanRegionsListResult extends DigitalOceanResultBase {
  regions: readonly DigitalOceanRegionSummary[];
  count: number;
}

export interface DigitalOceanSizeSummary {
  slug: string;
  price_monthly: number | null;
  price_hourly: number | null;
  memory: number | null;
  vcpus: number | null;
  disk: number | null;
}
export interface DigitalOceanSizesListResult extends DigitalOceanResultBase {
  sizes: readonly DigitalOceanSizeSummary[];
  count: number;
}

/** Metadata only — matches connections/github/'s own "never raw content" discipline. No droplet networking/user-data/backup detail, just enough to identify and report on each Droplet. */
export interface DigitalOceanDropletSummary {
  id: number;
  name: string;
  status: string;
  region_slug: string | null;
  size_slug: string | null;
  created_at: string | null;
}
export interface DigitalOceanDropletsListResult extends DigitalOceanResultBase {
  droplets: readonly DigitalOceanDropletSummary[];
  count: number;
}

export interface DigitalOceanBillingReadResult extends DigitalOceanResultBase {
  account_balance: number | null;
  month_to_date_balance: number | null;
  month_to_date_usage: number | null;
  generated_at: string | null;
}

/** The `ok: false` half of the shared `RoutingResult` — reused as-is, same discipline as connections/github/adapter-contract.ts's GithubRejection. */
export type DigitalOceanRejection = Extract<RoutingResult, { ok: false }>;

/** Every `EventEnvelope.data` this adapter can produce in Phase 1. */
export type DigitalOceanEventData =
  | DigitalOceanAccountResult
  | DigitalOceanRegionsListResult
  | DigitalOceanSizesListResult
  | DigitalOceanDropletsListResult
  | DigitalOceanBillingReadResult;

/**
 * What the adapter returns: a real Event with its evidence trail, or a
 * rejection with its (shorter, but non-empty) evidence trail — a
 * fail-closed denial is itself an auditable fact, not a silent no-op.
 */
export type DigitalOceanAdapterOutcome =
  | { ok: true; event: EventEnvelope<DigitalOceanEventData>; evidence: readonly CapabilityResultEvidence[] }
  | { ok: false; rejection: DigitalOceanRejection; evidence: readonly CapabilityResultEvidence[] };

/**
 * NOT_YET_BUILT (Owner scope decision 2026-08-17, Phase 1 = READ ONLY):
 * - No create/update/delete intent, payload, or result type — no droplet
 *   creation, no resize, no destroy, nothing that mutates a DigitalOcean
 *   account in any way.
 * - No Spaces, Kubernetes, App Platform, Databases, Networking, or AI/
 *   Inference intents — only the five Owner explicitly named.
 * - No Vault client — see ../credential-provider.ts's own NOT_YET_BUILT.
 * - No account-binding registry/persistence — see
 *   ../../credentials/provider-accounts/digitalocean/README.md and
 *   ../binding-provider.ts's own NOT_YET_BUILT.
 * - No wiring into ../../control/command-router/capability-registry.ts —
 *   this folder is a complete, callable capability on its own, but
 *   nothing yet routes a real CommandEnvelope to it.
 */
