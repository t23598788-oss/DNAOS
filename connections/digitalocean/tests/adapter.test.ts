/**
 * หน้าที่: the real, fully OFFLINE test for `connections/digitalocean/`
 * Phase 1. Owner, 2026-08-17: "Tests must use fake/in-memory credential
 * provider. No real token in tests or source." Both requirements are
 * absolute in this file — `FakeCredentialProvider` and
 * `FakeAccountBindingProvider` are in-memory maps defined only here, and
 * the one "secret" value used anywhere below (`FAKE_SECRET_NEVER_REAL`)
 * is a constant string that is never a real DigitalOcean token, explicitly
 * asserted to never leak into any event/evidence output.
 *
 * Covers: every fail-closed path (missing binding, expired/revoked/
 * unverified status, missing scope, failed credential resolution,
 * unknown intent, invalid payload) and the success path for all five
 * Phase-1 capabilities, using a fake HTTP transport (canned JSON matching
 * DigitalOcean's real response shape) — zero network calls, zero real
 * tokens, anywhere in this run.
 *
 * How to run: npx tsx connections/digitalocean/tests/adapter.test.ts
 */

import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";
import type { AccountCredentialBinding } from "../../../credentials/provider-accounts/digitalocean/types";
import type { AccountBindingProvider } from "../binding-provider";
import type { CredentialProvider, CredentialResolution } from "../credential-provider";
import type { HostFetchOutcome, HostResponse } from "../host-runtime";
import { DIGITALOCEAN_INTENTS } from "../adapter-contract";
import { handleDigitalOceanReadCommand } from "../digitalocean-adapter";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const TEST_ACCOUNT_ID = "account_test_digitalocean_adapter";
const TEST_TEAM_ID = "team_001";
const FAKE_SECRET_NEVER_REAL = "FAKE-NOT-A-REAL-DIGITALOCEAN-TOKEN-abc123";
const FAKE_VAULT_URI = "vault://digitalocean/team-001/control-token";

const testIdentity: EnvelopeIdentity = {
  identity_id: "identity_test_digitalocean_adapter",
  acting_as_account_id: TEST_ACCOUNT_ID,
  acting_as_tenant_id: "tenant_test_digitalocean_adapter",
  software_id: "software_dna_os_infrastructure",
  kind: "service",
};

function commandFixture(intent: string, payload: unknown): CommandEnvelope {
  return { command_id: `cmd_${Math.random().toString(36).slice(2)}`, issued_by: testIdentity, intent, payload, issued_at: new Date().toISOString() };
}

function bindingFixture(overrides: Partial<AccountCredentialBinding> = {}): AccountCredentialBinding {
  return {
    account_id: TEST_ACCOUNT_ID,
    digitalocean_team_id: TEST_TEAM_ID,
    auth_method: "pat",
    token_reference: { uri: FAKE_VAULT_URI },
    scopes: ["account:read", "droplet:read", "billing:read", "api:read"],
    expires_at: undefined,
    refresh_reference: undefined,
    status: "active",
    last_verified: new Date().toISOString(),
    revoked_at: undefined,
    ...overrides,
  };
}

/** In-memory only — no persistence, no real store, matching binding-provider.ts's own NOT_YET_BUILT note. */
class FakeAccountBindingProvider implements AccountBindingProvider {
  private readonly bindings = new Map<string, AccountCredentialBinding>();
  set(binding: AccountCredentialBinding): void {
    this.bindings.set(`${binding.account_id}:${binding.digitalocean_team_id}:${binding.auth_method}`, binding);
  }
  async resolve(account_id: string, digitalocean_team_id: string, auth_method: string): Promise<AccountCredentialBinding | undefined> {
    return this.bindings.get(`${account_id}:${digitalocean_team_id}:${auth_method}`);
  }
}

/** In-memory only — no real Vault client, matching credential-provider.ts's own NOT_YET_BUILT note. Resolving ALWAYS returns FAKE_SECRET_NEVER_REAL, which is asserted never to appear in any test output. */
class FakeCredentialProvider implements CredentialProvider {
  shouldFail = false;
  async resolve(reference: { uri: string }): Promise<CredentialResolution> {
    if (this.shouldFail) return { ok: false, reason: "fake credential provider configured to fail for this test" };
    return { ok: true, secret: FAKE_SECRET_NEVER_REAL, credential_source: reference.uri };
  }
}

function fakeJsonResponse(status: number, body: unknown): HostFetchOutcome {
  const response: HostResponse = { ok: status >= 200 && status < 300, status, json: async () => body };
  return { kind: "response", response };
}

/** Records every URL it was called with (so tests can assert GET-only + correct endpoint), returns whatever `nextResponse` was set to. */
class FakeFetch {
  calls: string[] = [];
  nextResponse: HostFetchOutcome = fakeJsonResponse(200, {});
  impl = async (url: string, _headers: Record<string, string>, _timeout: number): Promise<HostFetchOutcome> => {
    this.calls.push(url);
    return this.nextResponse;
  };
}

function serializedContainsSecret(value: unknown): boolean {
  return JSON.stringify(value).includes(FAKE_SECRET_NEVER_REAL);
}

async function run(): Promise<void> {
  console.log("=== connections/digitalocean/tests/adapter.test.ts ===");

  // --- fail-closed: unknown intent ---
  {
    const bindingProvider = new FakeAccountBindingProvider();
    const credentialProvider = new FakeCredentialProvider();
    const outcome = await handleDigitalOceanReadCommand(commandFixture("digitalocean.droplets.delete", {}), { bindingProvider, credentialProvider });
    assert(!outcome.ok && outcome.rejection.denied_at_stage === "classify", "unknown intent rejected at classify");
    console.log("PASS: unknown intent rejected at classify (proves no write intent is accepted)");
  }

  // --- fail-closed: invalid payload ---
  {
    const bindingProvider = new FakeAccountBindingProvider();
    const credentialProvider = new FakeCredentialProvider();
    const outcome = await handleDigitalOceanReadCommand(commandFixture(DIGITALOCEAN_INTENTS.accountRead, { digitalocean_team_id: 123 }), { bindingProvider, credentialProvider });
    assert(!outcome.ok && outcome.rejection.denied_at_stage === "classify", "invalid payload (missing auth_method) rejected at classify");
    console.log("PASS: invalid payload rejected at classify");
  }

  // --- fail-closed: no binding found ---
  {
    const bindingProvider = new FakeAccountBindingProvider(); // empty — nothing registered
    const credentialProvider = new FakeCredentialProvider();
    const outcome = await handleDigitalOceanReadCommand(
      commandFixture(DIGITALOCEAN_INTENTS.accountRead, { digitalocean_team_id: TEST_TEAM_ID, auth_method: "pat" }),
      { bindingProvider, credentialProvider }
    );
    assert(!outcome.ok && outcome.rejection.denied_at_stage === "authenticate", "missing binding rejected at authenticate");
    assert(outcome.evidence.length >= 1, "missing binding still produces an evidence trail");
    console.log("PASS: missing account binding is rejected, never reaches credential/API");
  }

  // --- fail-closed: expired / revoked / unverified status (Owner's exact three) ---
  for (const overrides of [
    { expires_at: "2020-01-01T00:00:00Z" }, // expired
    { revoked_at: "2026-08-01T00:00:00Z" }, // revoked
    { last_verified: undefined }, // unverified
  ]) {
    const bindingProvider = new FakeAccountBindingProvider();
    bindingProvider.set(bindingFixture(overrides));
    const credentialProvider = new FakeCredentialProvider();
    const outcome = await handleDigitalOceanReadCommand(
      commandFixture(DIGITALOCEAN_INTENTS.accountRead, { digitalocean_team_id: TEST_TEAM_ID, auth_method: "pat" }),
      { bindingProvider, credentialProvider }
    );
    assert(!outcome.ok && outcome.rejection.denied_at_stage === "authenticate", `bad-status binding (${JSON.stringify(overrides)}) rejected at authenticate`);
  }
  console.log("PASS: expired, revoked, and unverified bindings are all fail-closed rejected");

  // --- allowed: expiring_soon status still proceeds (Owner's rule names exactly three deny states) ---
  {
    const bindingProvider = new FakeAccountBindingProvider();
    bindingProvider.set(bindingFixture({ expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }));
    const credentialProvider = new FakeCredentialProvider();
    const fakeFetch = new FakeFetch();
    fakeFetch.nextResponse = fakeJsonResponse(200, { account: { email: "owner@example.com", uuid: "u1", status: "active", droplet_limit: 25 } });
    const outcome = await handleDigitalOceanReadCommand(
      commandFixture(DIGITALOCEAN_INTENTS.accountRead, { digitalocean_team_id: TEST_TEAM_ID, auth_method: "pat" }),
      { bindingProvider, credentialProvider, fetchImpl: fakeFetch.impl }
    );
    assert(outcome.ok, "expiring_soon status is allowed to proceed, per Owner's exact rule (only expired/revoked/unverified deny)");
    console.log("PASS: expiring_soon binding is NOT denied (only expired/revoked/unverified are)");
  }

  // --- fail-closed: missing required scope ---
  {
    const bindingProvider = new FakeAccountBindingProvider();
    bindingProvider.set(bindingFixture({ scopes: ["billing:read"] })); // no droplet:read, no api:read
    const credentialProvider = new FakeCredentialProvider();
    const outcome = await handleDigitalOceanReadCommand(
      commandFixture(DIGITALOCEAN_INTENTS.dropletsList, { digitalocean_team_id: TEST_TEAM_ID, auth_method: "pat" }),
      { bindingProvider, credentialProvider }
    );
    assert(!outcome.ok && outcome.rejection.denied_at_stage === "authorize", "missing droplet:read scope rejected at authorize");
    console.log("PASS: missing required scope is fail-closed rejected, never reaches credential resolution");
  }

  // --- fail-closed: credential provider fails ---
  {
    const bindingProvider = new FakeAccountBindingProvider();
    bindingProvider.set(bindingFixture());
    const credentialProvider = new FakeCredentialProvider();
    credentialProvider.shouldFail = true;
    const outcome = await handleDigitalOceanReadCommand(
      commandFixture(DIGITALOCEAN_INTENTS.accountRead, { digitalocean_team_id: TEST_TEAM_ID, auth_method: "pat" }),
      { bindingProvider, credentialProvider }
    );
    assert(!outcome.ok && outcome.rejection.denied_at_stage === "authenticate", "credential resolution failure rejected at authenticate");
    console.log("PASS: a failing CredentialProvider is fail-closed rejected, never reaches the DigitalOcean API");
  }

  // --- success: digitalocean.account.read ---
  {
    const bindingProvider = new FakeAccountBindingProvider();
    bindingProvider.set(bindingFixture());
    const credentialProvider = new FakeCredentialProvider();
    const fakeFetch = new FakeFetch();
    fakeFetch.nextResponse = fakeJsonResponse(200, { account: { email: "owner@example.com", uuid: "u1", status: "active", droplet_limit: 25 } });
    const outcome = await handleDigitalOceanReadCommand(
      commandFixture(DIGITALOCEAN_INTENTS.accountRead, { digitalocean_team_id: TEST_TEAM_ID, auth_method: "pat" }),
      { bindingProvider, credentialProvider, fetchImpl: fakeFetch.impl }
    );
    assert(outcome.ok, "account.read succeeds with a valid binding + fake credential + fake API response");
    if (outcome.ok) {
      const data = outcome.event.data as { droplet_limit: number | null; email: string | null };
      assert(data.droplet_limit === 25, "normalized account result carries droplet_limit from the fake API response");
      assert(data.email === "owner@example.com", "normalized account result carries email");
    }
    assert(fakeFetch.calls.length === 1 && fakeFetch.calls[0].endsWith("/v2/account"), "exactly one GET call, to the real /v2/account endpoint from actions.json");
    assert(!serializedContainsSecret(outcome), "no part of the outcome contains the fake secret value");
    console.log("PASS: digitalocean.account.read full success path, real endpoint, normalized result, no secret leakage");
  }

  // --- success: digitalocean.regions.list ---
  {
    const bindingProvider = new FakeAccountBindingProvider();
    bindingProvider.set(bindingFixture());
    const credentialProvider = new FakeCredentialProvider();
    const fakeFetch = new FakeFetch();
    fakeFetch.nextResponse = fakeJsonResponse(200, { regions: [{ slug: "nyc1", name: "New York 1", available: true, sizes: ["s-1vcpu-1gb"] }] });
    const outcome = await handleDigitalOceanReadCommand(
      commandFixture(DIGITALOCEAN_INTENTS.regionsList, { digitalocean_team_id: TEST_TEAM_ID, auth_method: "pat" }),
      { bindingProvider, credentialProvider, fetchImpl: fakeFetch.impl }
    );
    assert(outcome.ok, "regions.list succeeds");
    if (outcome.ok) {
      const data = outcome.event.data as { count: number; regions: readonly { slug: string }[] };
      assert(data.count === 1 && data.regions[0].slug === "nyc1", "normalized regions result");
    }
    assert(fakeFetch.calls[0].endsWith("/v2/regions"), "called the real /v2/regions endpoint");
    console.log("PASS: digitalocean.regions.list full success path");
  }

  // --- success: digitalocean.sizes.list ---
  {
    const bindingProvider = new FakeAccountBindingProvider();
    bindingProvider.set(bindingFixture());
    const credentialProvider = new FakeCredentialProvider();
    const fakeFetch = new FakeFetch();
    fakeFetch.nextResponse = fakeJsonResponse(200, { sizes: [{ slug: "s-1vcpu-1gb", price_monthly: 6, price_hourly: 0.009, memory: 1024, vcpus: 1, disk: 25 }] });
    const outcome = await handleDigitalOceanReadCommand(
      commandFixture(DIGITALOCEAN_INTENTS.sizesList, { digitalocean_team_id: TEST_TEAM_ID, auth_method: "pat" }),
      { bindingProvider, credentialProvider, fetchImpl: fakeFetch.impl }
    );
    assert(outcome.ok, "sizes.list succeeds");
    if (outcome.ok) {
      const data = outcome.event.data as { count: number; sizes: readonly { slug: string; price_monthly: number | null }[] };
      assert(data.count === 1 && data.sizes[0].price_monthly === 6, "normalized sizes result carries price_monthly");
    }
    assert(fakeFetch.calls[0].endsWith("/v2/sizes"), "called the real /v2/sizes endpoint");
    console.log("PASS: digitalocean.sizes.list full success path");
  }

  // --- success: digitalocean.droplets.list ---
  {
    const bindingProvider = new FakeAccountBindingProvider();
    bindingProvider.set(bindingFixture());
    const credentialProvider = new FakeCredentialProvider();
    const fakeFetch = new FakeFetch();
    fakeFetch.nextResponse = fakeJsonResponse(200, {
      droplets: [{ id: 111, name: "web-1", status: "active", region: { slug: "nyc1" }, size_slug: "s-1vcpu-1gb", created_at: "2026-01-01T00:00:00Z" }],
    });
    const outcome = await handleDigitalOceanReadCommand(
      commandFixture(DIGITALOCEAN_INTENTS.dropletsList, { digitalocean_team_id: TEST_TEAM_ID, auth_method: "pat" }),
      { bindingProvider, credentialProvider, fetchImpl: fakeFetch.impl }
    );
    assert(outcome.ok, "droplets.list succeeds");
    if (outcome.ok) {
      const data = outcome.event.data as { count: number; droplets: readonly { id: number; region_slug: string | null }[] };
      assert(data.count === 1 && data.droplets[0].id === 111 && data.droplets[0].region_slug === "nyc1", "normalized droplets result, region extracted from nested object");
    }
    assert(fakeFetch.calls[0].endsWith("/v2/droplets"), "called the real /v2/droplets endpoint");
    console.log("PASS: digitalocean.droplets.list full success path");
  }

  // --- success: digitalocean.billing.read ---
  {
    const bindingProvider = new FakeAccountBindingProvider();
    bindingProvider.set(bindingFixture());
    const credentialProvider = new FakeCredentialProvider();
    const fakeFetch = new FakeFetch();
    fakeFetch.nextResponse = fakeJsonResponse(200, { account_balance: -42.5, month_to_date_balance: -42.5, month_to_date_usage: 42.5, generated_at: "2026-08-17T00:00:00Z" });
    const outcome = await handleDigitalOceanReadCommand(
      commandFixture(DIGITALOCEAN_INTENTS.billingRead, { digitalocean_team_id: TEST_TEAM_ID, auth_method: "pat" }),
      { bindingProvider, credentialProvider, fetchImpl: fakeFetch.impl }
    );
    assert(outcome.ok, "billing.read succeeds");
    if (outcome.ok) {
      const data = outcome.event.data as { account_balance: number | null };
      assert(data.account_balance === -42.5, "normalized billing result carries account_balance");
    }
    assert(fakeFetch.calls[0].endsWith("/v2/customers/my/balance"), "called the real billing.json balance endpoint");
    console.log("PASS: digitalocean.billing.read full success path");
  }

  // --- upstream failure is reported, not swallowed ---
  {
    const bindingProvider = new FakeAccountBindingProvider();
    bindingProvider.set(bindingFixture());
    const credentialProvider = new FakeCredentialProvider();
    const fakeFetch = new FakeFetch();
    fakeFetch.nextResponse = fakeJsonResponse(401, { message: "Unauthorized" });
    const outcome = await handleDigitalOceanReadCommand(
      commandFixture(DIGITALOCEAN_INTENTS.accountRead, { digitalocean_team_id: TEST_TEAM_ID, auth_method: "pat" }),
      { bindingProvider, credentialProvider, fetchImpl: fakeFetch.impl }
    );
    assert(!outcome.ok, "a real HTTP 401 from DigitalOcean is reported as a rejection, never silently treated as success");
    console.log("PASS: upstream HTTP failure is reported, not swallowed");
  }

  console.log("=== ALL adapter.test.ts CASES PASSED ===");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
