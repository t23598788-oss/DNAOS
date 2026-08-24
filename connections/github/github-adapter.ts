/**
 * หน้าที่: the capability's entry point — the one function
 * `../../control/command-router/` will call when it routes a GitHub
 * `CommandEnvelope` to `adapter: "github"`. It takes an envelope, decides
 * whether it may run at all, runs the real operation, and returns either
 * an `EventEnvelope` describing what happened or a `RoutingResult`-shaped
 * rejection carrying the reason and the stage it was denied at.
 *
 * Built to the contract, not to a caller: `control/command-router/` does
 * not exist yet (NOT_YET_BUILT). Nothing in this folder imports it, and
 * nothing here assumes anything about it beyond the shapes declared in
 * `../../contracts/`.
 *
 * The account-scope check below is the one thing this capability does that
 * TASK-172 could not: that connector reached Supabase straight from an API
 * route with no account scoping, which is precisely why it is frozen as
 * legacy. Here, a Command may only use a connection that belongs to the
 * account the caller is acting as — `../../contracts/command/command-envelope.ts`'s
 * own rule ("the only account a Command may affect is
 * issued_by.acting_as_account_id"), enforced in code.
 *
 * Input: a `CommandEnvelope` (payload typed `unknown`, validated here).
 * Output: `GithubAdapterOutcome` — an `EventEnvelope` or a rejection.
 * Dependency ที่อนุญาต: `../../contracts/command/command-envelope.ts`,
 * `../../contracts/event/event-envelope.ts`,
 * `../../contracts/command/routing-result.ts` (via ./adapter-contract),
 * `./adapter-contract`, `./credential-resolution`, `./payload-validation`,
 * `./status-operations`, `./host-runtime`.
 * สิ่งที่ห้ามแตะ: ห้าม import อะไรจาก capability folder อื่น และห้ามให้
 * capability อื่น import ไฟล์ภายในของโฟลเดอร์นี้ — ทางเข้าเดียวคือ
 * `handleGithubCommand` (Capability Folder Law ข้อ 9). ห้ามข้าม
 * account-scope check ไม่ว่ากรณีใด. ห้าม log/return ค่า credential
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { EventEnvelope } from "../../contracts/event/event-envelope";
import {
  GITHUB_ADAPTER_NAME,
  GITHUB_EVENT_TYPES,
  GITHUB_INTENTS,
  type GithubAdapterOutcome,
  type GithubEventData,
  type GithubIntent,
  type GithubRejection,
} from "./adapter-contract";
import { resolveGithubCredential } from "./credential-resolution";
import { hostRandomId } from "./host-runtime";
import { checkCheckAccessPayload, checkReadStatusPayload } from "./payload-validation";
import { checkRepoAccess, readRepositoryStatus } from "./status-operations";

function reject(reason: string, stage: GithubRejection["denied_at_stage"]): GithubAdapterOutcome {
  return { ok: false, rejection: { ok: false, reason, denied_at_stage: stage } };
}

function emit(command: CommandEnvelope, eventType: string, data: GithubEventData): GithubAdapterOutcome {
  const event: EventEnvelope<GithubEventData> = {
    event_id: `evt_${hostRandomId()}`,
    concerns: command.issued_by,
    event_type: eventType,
    data,
    occurred_at: new Date().toISOString(),
    caused_by_command_id: command.command_id,
  };
  return { ok: true, event };
}

function isGithubIntent(intent: string): intent is GithubIntent {
  return intent === GITHUB_INTENTS.checkAccess || intent === GITHUB_INTENTS.readStatus;
}

/**
 * `connection.account_id` must equal the account the caller is acting as.
 * Anything else means one account's Command is reaching for another
 * account's connection — denied at "authorize", before any credential is
 * resolved and before any network call is made.
 */
function authorizeConnectionScope(command: CommandEnvelope, connectionAccountId: string, connectionAdapter: string): GithubAdapterOutcome | null {
  if (connectionAdapter !== GITHUB_ADAPTER_NAME) {
    return reject(
      `connection.adapter is "${connectionAdapter}", not "${GITHUB_ADAPTER_NAME}" — this command was routed to the wrong adapter`,
      "route"
    );
  }
  if (connectionAccountId !== command.issued_by.acting_as_account_id) {
    return reject(
      `connection belongs to account "${connectionAccountId}" but the command is issued acting as account "${command.issued_by.acting_as_account_id}" — a command may only use its own account's connection`,
      "authorize"
    );
  }
  return null;
}

/**
 * The single public entry point of `connections/github/`.
 *
 * Order is deliberate: classify the intent, validate the payload,
 * authorize the account scope, THEN resolve the credential, THEN talk to
 * GitHub. A command that is not allowed never causes a credential read or
 * a network call.
 */
export async function handleGithubCommand(command: CommandEnvelope): Promise<GithubAdapterOutcome> {
  if (!isGithubIntent(command.intent)) {
    return reject(
      `intent "${command.intent}" is not answered by the github adapter (known intents: ${Object.values(GITHUB_INTENTS).join(", ")})`,
      "classify"
    );
  }

  if (command.intent === GITHUB_INTENTS.checkAccess) {
    const payload = checkCheckAccessPayload(command.payload);
    if (!payload.ok) return reject(payload.reason, "classify");

    const scopeDenial = authorizeConnectionScope(command, payload.value.connection.account_id, payload.value.connection.adapter);
    if (scopeDenial !== null) return scopeDenial;

    const credential = await resolveGithubCredential(payload.value.connection);
    if (!credential.ok) return reject(credential.reason, "authenticate");

    const result = await checkRepoAccess(credential.token, credential.credential_source, payload.value.target);
    return emit(command, GITHUB_EVENT_TYPES.accessChecked, result);
  }

  const payload = checkReadStatusPayload(command.payload);
  if (!payload.ok) return reject(payload.reason, "classify");

  const scopeDenial = authorizeConnectionScope(command, payload.value.connection.account_id, payload.value.connection.adapter);
  if (scopeDenial !== null) return scopeDenial;

  const credential = await resolveGithubCredential(payload.value.connection);
  if (!credential.ok) return reject(credential.reason, "authenticate");

  const result = await readRepositoryStatus(credential.token, credential.credential_source, payload.value);
  return emit(command, GITHUB_EVENT_TYPES.statusRead, result);
}

/**
 * NOT_YET_BUILT / NOT_ENFORCED, stated rather than silently skipped:
 * - `connection.status` ("disconnected" | "connecting" | "connected" |
 *   "error") is NOT used as a gate here. Nothing in this repo owns those
 *   transitions yet (`control/command-status/` has a lifecycle type but no
 *   runtime), so gating on a field nobody maintains would block every real
 *   command for a reason that is not real. The status a run OBSERVES is
 *   reported in the event; updating the registration is the router's job
 *   once it exists.
 * - `software_id` is NOT compared between `connection.software_id` and
 *   `issued_by.software_id`. Those two fields do not provably mean the
 *   same thing ("the software this connection belongs to" vs. "the
 *   software the caller is acting through"), and inventing an equality
 *   rule between them would be a guess with real denial consequences.
 *   Account scope IS enforced, because `command-envelope.ts` states that
 *   rule explicitly.
 * - No retry/backoff on HTTP 429. A rate-limited read is reported as a
 *   rate-limited read, not silently retried.
 */
