/**
 * หน้าที่: proves the exact gap `capability-registry.ts`'s own header used
 * to document is fixed — a real Owner command text routes through
 * `../contract.ts`'s `routeOwnerCommand`, reaches `digitalocean`'s
 * `endpoint.kind: "connector"` entry, and gets a REAL (never fake)
 * `AUTH_REQUIRED`-shaped `BLOCKED` result, because no credential
 * binding registry/Vault exists yet — see
 * `../../../connections/digitalocean/production-binding-provider.ts`.
 * Zero network call happens: `handleDigitalOceanReadCommand` fails
 * closed at the binding-resolution stage, before any `hostFetch` call —
 * this test asserts that by construction (no fetch/network host stub is
 * even declared), not by mocking.
 *
 * How to run: npx tsx control/command-router/tests/digitalocean-connector-routing.test.ts
 */

import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";
import { classifyCommand, routeOwnerCommand } from "../contract";
import { getCapability } from "../capability-registry";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const identity: EnvelopeIdentity = {
  identity_id: "identity_test_do_connector_routing",
  acting_as_account_id: "account_test_do_connector_routing",
  acting_as_tenant_id: "tenant_test_do_connector_routing",
  software_id: "software_dna_os_infrastructure",
  kind: "service",
};

function envelope(intent: string, payload: unknown): CommandEnvelope {
  return { command_id: `cmd_${Math.random().toString(36).slice(2)}`, issued_by: identity, intent, payload, issued_at: new Date().toISOString() };
}

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${name} -> ${error instanceof Error ? error.message : String(error)}`);
  }
}

check("capability-registry: digitalocean is CONNECTED via a connector endpoint", () => {
  const cap = getCapability("digitalocean");
  assert(cap !== undefined, "digitalocean capability must be registered");
  assert(cap!.health_status === "CONNECTED", `expected CONNECTED, got ${cap!.health_status}`);
  assert(cap!.endpoint.kind === "connector", `expected endpoint.kind connector, got ${cap!.endpoint.kind}`);
});

check("classifyCommand: free text 'digitalocean' matches exactly one capability", () => {
  const outcome = classifyCommand("digitalocean account status");
  assert(outcome.status === "MATCHED", `expected MATCHED, got ${outcome.status}`);
  if (outcome.status === "MATCHED") assert(outcome.capability.capability_id === "digitalocean", `expected digitalocean, got ${outcome.capability.capability_id}`);
});

async function main(): Promise<void> {
  const result = await routeOwnerCommand(
    envelope("digitalocean.account.read", { digitalocean_team_id: "team_test", auth_method: "pat" }),
    "digitalocean account status",
  );

  check("router reaches the real connector and reports BLOCKED, never a fake COMPLETED", () => {
    assert(result.status === "BLOCKED", `expected BLOCKED (AUTH_REQUIRED), got ${result.status}`);
    assert(result.capability_id === "digitalocean", `expected capability_id digitalocean, got ${result.capability_id}`);
  });

  check("result carries an explicit AUTH_REQUIRED signal, not a silent BLOCKED", () => {
    const hasAuthRequiredEvidence = result.evidence.some((e) => e.note.includes("AUTH_REQUIRED"));
    const hasAuthRequiredWarning = result.warnings.some((w) => w.includes("AUTH_REQUIRED"));
    assert(hasAuthRequiredEvidence || hasAuthRequiredWarning, `expected an AUTH_REQUIRED marker in evidence/warnings, got evidence=${JSON.stringify(result.evidence)} warnings=${JSON.stringify(result.warnings)}`);
  });

  check("no credential/token value leaked anywhere in the result", () => {
    const serialized = JSON.stringify(result);
    assert(!serialized.includes("FAKE-NOT-A-REAL"), "no fake secret token should appear (none was ever supplied)");
    assert(!/[A-Za-z0-9]{40,}/.test(serialized), "no long opaque token-shaped string should appear in the result");
  });

  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("ALL CHECKS PASSED");
  }
}

void main();
