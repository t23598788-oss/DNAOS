/**
 * หน้าที่: real tests for the pure functions in ../expiry-policy.ts,
 * ../scope-policy.ts, ../rotation-policy.ts, ../credential-reference.ts —
 * plain assert-based, matching this repo's `npx tsx <file>` convention
 * (see e.g. ../../../execution/run/tests/executor.test.ts).
 *
 * How to run: npx tsx credentials/provider-accounts/digitalocean/tests/policies.test.ts
 */

import { deriveBindingStatus } from "../expiry-policy";
import { scopeSatisfies } from "../scope-policy";
import { canAutoRotate } from "../rotation-policy";
import { isVaultReference } from "../credential-reference";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function run(): Promise<void> {
  console.log("=== credentials/provider-accounts/digitalocean/tests/policies.test.ts ===");

  // --- expiry-policy.ts ---
  {
    const now = new Date("2026-08-17T00:00:00Z");
    assert(
      deriveBindingStatus({ expires_at: undefined, revoked_at: undefined, last_verified: "2026-08-01T00:00:00Z" }, now) === "active",
      "no expiry + verified => active"
    );
    assert(
      deriveBindingStatus({ expires_at: undefined, revoked_at: undefined, last_verified: undefined }, now) === "unverified",
      "no expiry + never verified => unverified"
    );
    assert(
      deriveBindingStatus({ expires_at: "2026-09-01T00:00:00Z", revoked_at: undefined, last_verified: "2026-08-01T00:00:00Z" }, now) === "active",
      "expires far in future => active"
    );
    assert(
      deriveBindingStatus({ expires_at: "2026-08-20T00:00:00Z", revoked_at: undefined, last_verified: "2026-08-01T00:00:00Z" }, now) === "expiring_soon",
      "expires within 7-day window => expiring_soon"
    );
    assert(
      deriveBindingStatus({ expires_at: "2026-08-01T00:00:00Z", revoked_at: undefined, last_verified: "2026-08-01T00:00:00Z" }, now) === "expired",
      "expires_at in the past => expired"
    );
    assert(
      deriveBindingStatus({ expires_at: "2026-09-01T00:00:00Z", revoked_at: "2026-08-10T00:00:00Z", last_verified: "2026-08-01T00:00:00Z" }, now) === "revoked",
      "revoked_at set => revoked, even with future expiry"
    );
    console.log("PASS: deriveBindingStatus covers active/unverified/expiring_soon/expired/revoked");
  }

  // --- scope-policy.ts ---
  {
    assert(scopeSatisfies({ granted_scopes: ["droplet:read"] }, "droplet:read"), "exact scope match satisfies");
    assert(!scopeSatisfies({ granted_scopes: ["droplet:read"] }, "droplet:create"), "unrelated scope does not satisfy");
    assert(scopeSatisfies({ granted_scopes: ["api:write"] }, "kubernetes:delete"), "api:write alias satisfies anything");
    assert(scopeSatisfies({ granted_scopes: ["api:read"] }, "app:read"), "api:read alias satisfies any :read scope");
    assert(!scopeSatisfies({ granted_scopes: ["api:read"] }, "app:create"), "api:read alias does NOT satisfy a :create scope");
    console.log("PASS: scopeSatisfies honors exact match + DigitalOcean's two real alias scopes only");
  }

  // --- rotation-policy.ts ---
  {
    assert(
      canAutoRotate({ auth_method: "oauth2", refresh_reference: { uri: "vault://digitalocean/team-001/refresh-token" } }),
      "oauth2 with a refresh_reference can auto-rotate"
    );
    assert(!canAutoRotate({ auth_method: "oauth2", refresh_reference: undefined }), "oauth2 without a refresh_reference cannot auto-rotate");
    assert(
      !canAutoRotate({ auth_method: "pat", refresh_reference: { uri: "vault://digitalocean/team-001/control-token" } }),
      "pat can never auto-rotate, even if a reference is (incorrectly) present"
    );
    assert(!canAutoRotate({ auth_method: "spaces_key", refresh_reference: undefined }), "spaces_key cannot auto-rotate");
    console.log("PASS: canAutoRotate is true only for oauth2 with a real refresh_reference");
  }

  // --- credential-reference.ts ---
  {
    assert(isVaultReference({ uri: "vault://digitalocean/team-001/control-token" }), "a real vault:// uri is a valid VaultReference");
    assert(!isVaultReference({ uri: "https://example.com/token" }), "a non-vault:// uri is rejected");
    assert(!isVaultReference("dop_v1_liveTokenValue"), "a bare string (a literal token, the exact mistake this guards against) is rejected");
    assert(!isVaultReference(undefined), "undefined is not a VaultReference");
    console.log("PASS: isVaultReference rejects anything that isn't a real vault:// locator");
  }

  console.log("=== ALL policies.test.ts CASES PASSED ===");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
