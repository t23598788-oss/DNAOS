/**
 * หน้าที่: the capability's entry point — implements Owner's exact
 * required flow for Phase 1 (2026-08-17, READ ONLY):
 *
 *   DNA OS request -> resolve account binding -> validate binding STATUS
 *   -> validate required scope -> resolve credential reference
 *   -> credential provider interface -> DigitalOcean API
 *   -> normalized result -> evidence
 *
 * Built to the contract, not to a caller: `control/command-router/`
 * exists but nothing routes to this adapter yet (Owner's scope this round
 * did not include capability-registry.ts wiring). Nothing in this folder
 * imports it, and nothing here assumes anything beyond the shapes
 * declared in `../../contracts/`.
 *
 * Input: a `CommandEnvelope<DigitalOceanReadPayload>`, an
 * `AccountBindingProvider`, a `CredentialProvider`, and (test-only) an
 * optional `FetchImpl` override.
 * Output: `DigitalOceanAdapterOutcome`.
 * Dependency ที่อนุญาต: `../../contracts/command/command-envelope.ts`,
 * `../../contracts/event/event-envelope.ts` (via ./adapter-contract),
 * `./adapter-contract`, `./binding-provider`, `./credential-provider`,
 * `./authorization`, `./provider-action-lookup`, `./digitalocean-read-api`,
 * `./evidence`, `./host-runtime`.
 * สิ่งที่ห้ามแตะ: ห้าม import อะไรจาก capability folder อื่น (นอกเหนือจาก
 * `../../contracts/`, `../../providers/digitalocean/definition/`,
 * `../../credentials/provider-accounts/digitalocean/` ซึ่งเป็น source-of-
 * truth ที่ Owner สั่งให้ใช้โดยตรง) — ทางเข้าเดียวคือ
 * `handleDigitalOceanReadCommand` (Capability Folder Law ข้อ 9). ห้ามข้าม
 * ลำดับ: resolve binding -> validate STATUS -> validate SCOPE -> resolve
 * credential -> call API เท่านั้น ห้ามสลับลำดับ credential resolution ไป
 * ก่อน authorization เด็ดขาด. ห้าม log/return ค่า credential ที่แท้จริง.
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { EventEnvelope } from "../../contracts/event/event-envelope";
import type { CapabilityResultEvidence } from "../../contracts/command/capability-result";
import {
  DIGITALOCEAN_ADAPTER_NAME,
  DIGITALOCEAN_EVENT_TYPES,
  DIGITALOCEAN_INTENTS,
  type DigitalOceanAdapterOutcome,
  type DigitalOceanEventData,
  type DigitalOceanIntent,
  type DigitalOceanReadPayload,
  type DigitalOceanRejection,
} from "./adapter-contract";
import type { AccountBindingProvider } from "./binding-provider";
import type { CredentialProvider } from "./credential-provider";
import { authorizeBindingStatus, authorizeRequiredScope } from "./authorization";
import { resolveAction } from "./provider-action-lookup";
import { fetchAccount, fetchBilling, fetchDropletsList, fetchRegionsList, fetchSizesList } from "./digitalocean-read-api";
import type { FetchImpl } from "./host-runtime";
import { hostFetch, hostRandomId } from "./host-runtime";
import { deriveStatus } from "../../credentials/provider-accounts/digitalocean/status";
import {
  apiCallEvidence,
  bindingResolvedEvidence,
  credentialResolvedEvidence,
  normalizedResultEvidence,
  scopeCheckEvidence,
  statusCheckEvidence,
} from "./evidence";

export interface DigitalOceanAdapterDeps {
  bindingProvider: AccountBindingProvider;
  credentialProvider: CredentialProvider;
  /** Defaults to the real ./host-runtime.ts hostFetch. Tests override with a fake transport — see ./tests/adapter.test.ts. */
  fetchImpl?: FetchImpl;
}

function reject(reason: string, stage: DigitalOceanRejection["denied_at_stage"], evidence: CapabilityResultEvidence[]): DigitalOceanAdapterOutcome {
  return { ok: false, rejection: { ok: false, reason, denied_at_stage: stage }, evidence };
}

function emit(command: CommandEnvelope, eventType: string, data: DigitalOceanEventData, evidence: CapabilityResultEvidence[]): DigitalOceanAdapterOutcome {
  const event: EventEnvelope<DigitalOceanEventData> = {
    event_id: `evt_${hostRandomId()}`,
    concerns: command.issued_by,
    event_type: eventType,
    data,
    occurred_at: new Date().toISOString(),
    caused_by_command_id: command.command_id,
  };
  return { ok: true, event, evidence };
}

function isDigitalOceanIntent(intent: string): intent is DigitalOceanIntent {
  return Object.values(DIGITALOCEAN_INTENTS).includes(intent as DigitalOceanIntent);
}

function isValidPayload(payload: unknown): payload is DigitalOceanReadPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as Record<string, unknown>)["digitalocean_team_id"] === "string" &&
    typeof (payload as Record<string, unknown>)["auth_method"] === "string"
  );
}

/**
 * The single public entry point of `connections/digitalocean/` Phase 1.
 * Order is deliberate and matches Owner's exact required flow — a command
 * whose binding is missing/bad-status/under-scoped never causes a
 * credential read or a network call.
 */
export async function handleDigitalOceanReadCommand(command: CommandEnvelope, deps: DigitalOceanAdapterDeps): Promise<DigitalOceanAdapterOutcome> {
  const evidence: CapabilityResultEvidence[] = [];
  const fetchImpl = deps.fetchImpl ?? hostFetch;

  // 1. classify
  if (!isDigitalOceanIntent(command.intent)) {
    return reject(`intent "${command.intent}" is not answered by the digitalocean adapter (known intents: ${Object.values(DIGITALOCEAN_INTENTS).join(", ")})`, "classify", evidence);
  }
  if (!isValidPayload(command.payload)) {
    return reject(`payload for intent "${command.intent}" must include digitalocean_team_id and auth_method (both strings)`, "classify", evidence);
  }
  const payload = command.payload;

  // Resolve which real DigitalOcean endpoint/method/scope this intent maps to — from
  // ../../providers/digitalocean/definition/*, never hardcoded.
  const action = resolveAction(command.intent);
  if (action === undefined) {
    return reject(`intent "${command.intent}" has no corresponding record in providers/digitalocean/definition/ — refusing rather than guessing an endpoint`, "classify", evidence);
  }

  const accountId = command.issued_by.acting_as_account_id;

  // 2. resolve account binding
  const binding = await deps.bindingProvider.resolve(accountId, payload.digitalocean_team_id, payload.auth_method);
  evidence.push(bindingResolvedEvidence(accountId, payload.digitalocean_team_id, binding !== undefined));
  if (binding === undefined) {
    return reject(`no credential binding found for account "${accountId}" / DigitalOcean team "${payload.digitalocean_team_id}" / auth_method "${payload.auth_method}"`, "authenticate", evidence);
  }

  // 3. validate binding STATUS (fail-closed: expired/revoked/unverified)
  const statusOutcome = authorizeBindingStatus(binding);
  evidence.push(statusCheckEvidence(deriveStatus(binding), statusOutcome.ok));
  if (!statusOutcome.ok) {
    return reject(statusOutcome.reason, "authenticate", evidence);
  }

  // 4. validate required scope (fail-closed)
  const scopeOutcome = authorizeRequiredScope(binding, action.required_scope);
  evidence.push(scopeCheckEvidence(action.required_scope, scopeOutcome.ok));
  if (!scopeOutcome.ok) {
    return reject(scopeOutcome.reason, "authorize", evidence);
  }

  // 5. resolve credential reference
  if (binding.token_reference === undefined) {
    evidence.push(credentialResolvedEvidence("(no token_reference on binding)", false));
    return reject(`binding for account "${accountId}" / team "${payload.digitalocean_team_id}" has no token_reference set — nothing to resolve`, "authenticate", evidence);
  }

  // 6. credential provider interface
  const credential = await deps.credentialProvider.resolve(binding.token_reference);
  evidence.push(credentialResolvedEvidence(binding.token_reference.uri, credential.ok));
  if (!credential.ok) {
    return reject(`credential resolution failed: ${credential.reason}`, "authenticate", evidence);
  }

  // 7. DigitalOcean API (real, GET-only) + 8. normalized result
  switch (command.intent) {
    case DIGITALOCEAN_INTENTS.accountRead: {
      const apiResult = await fetchAccount(action.endpoint, credential.secret, credential.credential_source, fetchImpl);
      evidence.push(apiCallEvidence(action.resource, action.endpoint, apiResult.ok ? apiResult.result.http_status : apiResult.http_status, apiResult.ok));
      if (!apiResult.ok) return reject(apiResult.reason, "route", evidence);
      evidence.push(normalizedResultEvidence(action.resource, null));
      return emit(command, DIGITALOCEAN_EVENT_TYPES.accountRead, apiResult.result, evidence);
    }
    case DIGITALOCEAN_INTENTS.regionsList: {
      const apiResult = await fetchRegionsList(action.endpoint, credential.secret, credential.credential_source, fetchImpl);
      evidence.push(apiCallEvidence(action.resource, action.endpoint, apiResult.ok ? apiResult.result.http_status : apiResult.http_status, apiResult.ok));
      if (!apiResult.ok) return reject(apiResult.reason, "route", evidence);
      evidence.push(normalizedResultEvidence(action.resource, apiResult.result.count));
      return emit(command, DIGITALOCEAN_EVENT_TYPES.regionsListed, apiResult.result, evidence);
    }
    case DIGITALOCEAN_INTENTS.sizesList: {
      const apiResult = await fetchSizesList(action.endpoint, credential.secret, credential.credential_source, fetchImpl);
      evidence.push(apiCallEvidence(action.resource, action.endpoint, apiResult.ok ? apiResult.result.http_status : apiResult.http_status, apiResult.ok));
      if (!apiResult.ok) return reject(apiResult.reason, "route", evidence);
      evidence.push(normalizedResultEvidence(action.resource, apiResult.result.count));
      return emit(command, DIGITALOCEAN_EVENT_TYPES.sizesListed, apiResult.result, evidence);
    }
    case DIGITALOCEAN_INTENTS.dropletsList: {
      const apiResult = await fetchDropletsList(action.endpoint, credential.secret, credential.credential_source, fetchImpl);
      evidence.push(apiCallEvidence(action.resource, action.endpoint, apiResult.ok ? apiResult.result.http_status : apiResult.http_status, apiResult.ok));
      if (!apiResult.ok) return reject(apiResult.reason, "route", evidence);
      evidence.push(normalizedResultEvidence(action.resource, apiResult.result.count));
      return emit(command, DIGITALOCEAN_EVENT_TYPES.dropletsListed, apiResult.result, evidence);
    }
    case DIGITALOCEAN_INTENTS.billingRead: {
      const apiResult = await fetchBilling(action.endpoint, credential.secret, credential.credential_source, fetchImpl);
      evidence.push(apiCallEvidence(action.resource, action.endpoint, apiResult.ok ? apiResult.result.http_status : apiResult.http_status, apiResult.ok));
      if (!apiResult.ok) return reject(apiResult.reason, "route", evidence);
      evidence.push(normalizedResultEvidence(action.resource, null));
      return emit(command, DIGITALOCEAN_EVENT_TYPES.billingRead, apiResult.result, evidence);
    }
  }
}

/**
 * NOT_YET_BUILT / NOT_ENFORCED, stated rather than silently skipped:
 * - No write path exists anywhere in this folder (see ./host-runtime.ts's
 *   GET-only hostFetch and ./adapter-contract.ts's NOT_YET_BUILT list).
 * - No retry/backoff on HTTP 429 — a rate-limited read is reported as a
 *   rate-limited read, matching connections/github/'s own stated choice.
 * - No wiring into control/command-router/capability-registry.ts.
 */
