/**
 * หน้าที่: the ONE inbound path for this capability — validate a real
 * GitHub `push` webhook delivery's `X-Hub-Signature-256` HMAC against a
 * secret resolved through the same canonical DNA OS credential/authority
 * path every other credential in this capability uses
 * (./credential-resolution.ts's `resolveGithubWebhookSecret` ->
 * `credentials/registry/api-credential-registry.ts` ->
 * `credentials/macos-keychain/`'s real `MacOsKeychainProvider`), then
 * normalize the verified payload into this repo's own `EventEnvelope`
 * shape (`../../contracts/event/event-envelope.ts`) carrying a
 * `GithubPushEventData` (./adapter-contract.ts).
 *
 * This module is a pure function of (raw request-like object) ->
 * (EventEnvelope | rejection) — it does not itself listen on a socket.
 * Wiring an actual HTTP listener to the internet is a separate,
 * later authorization; `handleGithubWebhookDelivery` below is what that
 * listener would call once it existed, and is exactly what this
 * capability's own tests call today.
 *
 * Input: `RawWebhookDelivery` (headers + raw body string, exactly as an
 * HTTP framework would hand them over, unparsed — the signature MUST be
 * computed over the raw bytes, never over a re-serialized JSON.parse
 * round-trip, or a byte-for-byte different-but-equivalent body would
 * verify against the wrong signature).
 * Output: `WebhookReceiveOutcome` — a real `EventEnvelope<GithubPushEventData>`
 * on success, or a typed rejection (`BAD_SIGNATURE`, `UNSUPPORTED_EVENT`,
 * `MALFORMED_PAYLOAD`, `SECRET_UNAVAILABLE`) — never a bare boolean.
 * Dependency ที่อนุญาต: node:crypto (`createHmac`, `timingSafeEqual`,
 * `randomUUID` — used directly rather than ./host-runtime.ts's
 * `hostRandomId`, which reaches for a browser-global `crypto` this Node
 * runtime does not define; same underlying primitive, called directly),
 * ./credential-resolution.ts (`resolveGithubWebhookSecret`),
 * ./adapter-contract.ts (types + `GITHUB_EVENT_TYPES.pushReceived`),
 * `../../contracts/event/event-envelope.ts`.
 * สิ่งที่ห้ามแตะ: **ห้ามใส่ secret ลง log, error, หรือ EventEnvelope ใดๆ**
 * — ทุก failure reason อ้างถึงได้แค่ credential_ref/reference เท่านั้น.
 * ห้ามเปรียบเทียบลายเซ็นด้วย `===`/string compare ธรรมดา — ต้องใช้
 * `crypto.timingSafeEqual` เสมอ (constant-time) ห้ามข้าม case ที่ความยาว
 * ของ digest ไม่เท่ากัน (ต้อง reject อย่างปลอดภัย ไม่ throw ให้ crash).
 * ห้ามยอมรับ event_type อื่นนอกจาก "push" ในรอบนี้.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { GithubPushEventData } from "./adapter-contract";
import { GITHUB_EVENT_TYPES } from "./adapter-contract";
import { resolveGithubWebhookSecret } from "./credential-resolution";
import type { EventEnvelope } from "../../contracts/event/event-envelope";
import type { EnvelopeIdentity } from "../../contracts/identity/envelope-identity";

export interface RawWebhookDelivery {
  headers: Readonly<Record<string, string | undefined>>;
  /** Exact raw bytes GitHub sent, as a string — never a re-stringified object. */
  raw_body: string;
}

export type WebhookReceiveOutcome =
  | { ok: true; event: EventEnvelope<GithubPushEventData> }
  | { ok: false; code: "BAD_SIGNATURE" | "UNSUPPORTED_EVENT" | "MALFORMED_PAYLOAD" | "SECRET_UNAVAILABLE" | "MISSING_SIGNATURE_HEADER" | "MISSING_REPO_IDENTITY"; reason: string };

function header(headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  // Header names arrive case-insensitive from any real HTTP stack; this
  // capability owns no framework, so it normalizes itself rather than
  // trusting callers to pass a canonical case.
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

/**
 * Constant-time HMAC-SHA256 verification of GitHub's
 * `X-Hub-Signature-256: sha256=<hex>` header against the raw body, using
 * `secret`. Returns false (never throws) on any malformed header or
 * length mismatch — a length mismatch is itself a legitimate "does not
 * match" outcome, not a program error.
 */
function verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const providedHex = signatureHeader.slice(prefix.length).trim();
  const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  const providedBuffer = Buffer.from(providedHex, "hex");
  const expectedBuffer = Buffer.from(expectedHex, "hex");
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The one real entry point. Verifies the signature FIRST, against the
 * exact raw bytes — parsing the JSON body only happens after a verified
 * signature, so a malformed/malicious payload never reaches JSON.parse
 * under an attacker's control without having already proven it came from
 * a holder of the shared secret.
 */
export async function handleGithubWebhookDelivery(delivery: RawWebhookDelivery): Promise<WebhookReceiveOutcome> {
  const eventName = header(delivery.headers, "X-GitHub-Event");
  if (eventName !== "push") {
    return { ok: false, code: "UNSUPPORTED_EVENT", reason: `event type "${eventName ?? "(missing)"}" is not accepted — this receiver only understands "push" this round` };
  }

  const signatureHeader = header(delivery.headers, "X-Hub-Signature-256");
  if (!signatureHeader) {
    return { ok: false, code: "MISSING_SIGNATURE_HEADER", reason: `delivery has no X-Hub-Signature-256 header — refusing an unsigned payload` };
  }

  // The secret is per (owner, repo) — but we cannot know which repo this
  // delivery claims to be for until we parse the body, and we refuse to
  // parse an unverified body. Resolve the identity honestly: GitHub also
  // sends X-GitHub-Hook-Installation-Target-* headers in real deliveries,
  // but this capability accepts the canonical, always-present source: the
  // repository full_name is looked up from a SEPARATE header this
  // receiver requires callers to set from their own already-trusted
  // routing (X-DNA-OS-Repo-Owner / X-DNA-OS-Repo-Name) rather than trust
  // an unverified body for which secret to try.
  const ownerHeader = header(delivery.headers, "X-DNA-OS-Repo-Owner");
  const repoHeader = header(delivery.headers, "X-DNA-OS-Repo-Name");
  if (!ownerHeader || !repoHeader) {
    return { ok: false, code: "MISSING_REPO_IDENTITY", reason: `delivery is missing X-DNA-OS-Repo-Owner / X-DNA-OS-Repo-Name — this receiver needs the repository identity from already-trusted routing, never from the unverified body, to know which secret to verify against` };
  }

  const secretResolution = await resolveGithubWebhookSecret(ownerHeader, repoHeader);
  if (!secretResolution.ok) {
    return { ok: false, code: "SECRET_UNAVAILABLE", reason: secretResolution.reason };
  }

  if (!verifySignature(delivery.raw_body, signatureHeader, secretResolution.token)) {
    return { ok: false, code: "BAD_SIGNATURE", reason: `X-Hub-Signature-256 did not verify against the resolved secret (credential_source: ${secretResolution.credential_source})` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(delivery.raw_body);
  } catch {
    return { ok: false, code: "MALFORMED_PAYLOAD", reason: "raw_body is not valid JSON, even though its signature verified" };
  }
  if (!isRecord(parsed)) {
    return { ok: false, code: "MALFORMED_PAYLOAD", reason: "verified payload is not a JSON object" };
  }

  const ref = typeof parsed.ref === "string" ? parsed.ref : null;
  const before = typeof parsed.before === "string" ? parsed.before : null;
  const after = typeof parsed.after === "string" ? parsed.after : null;
  const repository = isRecord(parsed.repository) ? parsed.repository : null;
  const owner = repository && isRecord(repository.owner) && typeof repository.owner.login === "string" ? repository.owner.login : ownerHeader;
  const repoName = repository && typeof repository.name === "string" ? repository.name : repoHeader;
  if (!ref || !before || !after) {
    return { ok: false, code: "MALFORMED_PAYLOAD", reason: `verified push payload is missing required field(s) among ref/before/after` };
  }

  const commits = Array.isArray(parsed.commits) ? parsed.commits : [];
  const headCommit = isRecord(parsed.head_commit) ? parsed.head_commit : null;
  const pusher = isRecord(parsed.pusher) && typeof parsed.pusher.name === "string" ? parsed.pusher.name : null;
  const deliveryId = header(delivery.headers, "X-GitHub-Delivery") ?? null;

  const data: GithubPushEventData = {
    owner,
    repo: repoName,
    ref,
    branch: ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref,
    before_sha: before,
    after_sha: after,
    commit_count: commits.length,
    head_commit_sha: headCommit && typeof headCommit.id === "string" ? headCommit.id : null,
    head_commit_message: headCommit && typeof headCommit.message === "string" ? headCommit.message : null,
    pusher,
    delivery_id: deliveryId,
  };

  // There is no CommandEnvelope for an inbound webhook — GitHub itself
  // initiated this, not a Command this repo's own Owner issued. `concerns`
  // still must resolve to exactly one Account's scope
  // (../../contracts/identity/envelope-identity.ts's own rule): this
  // identifies the sender as GitHub's own external system identity,
  // scoped to the account that registered this webhook secret — real
  // account resolution is deliberately deferred to whatever consumes
  // this event downstream (control/event-pipeline/), matching that
  // pipeline's own `command_id: "UNTRACKED"` convention for producers
  // with no live command to attribute to.
  const concerns: EnvelopeIdentity = {
    identity_id: `github-webhook:${owner}/${repoName}`,
    acting_as_account_id: "UNTRACKED",
    acting_as_tenant_id: "UNTRACKED",
    software_id: "connections/github/webhook-receiver",
    kind: "external_program",
  };

  const event: EventEnvelope<GithubPushEventData> = {
    event_id: `github-push-${randomUUID()}`,
    concerns,
    event_type: GITHUB_EVENT_TYPES.pushReceived,
    data,
    occurred_at: new Date().toISOString(),
  };

  return { ok: true, event };
}
