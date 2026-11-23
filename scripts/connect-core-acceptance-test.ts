#!/usr/bin/env npx tsx
/**
 * Connect Core — acceptance harness (owner-approved design, 2026-09-20).
 *
 * Proves the core rules of the Connect Core pre-layer against the REAL code, with
 * no network and no live database: a local stub client answers the connector read
 * (the same technique scripts/line-credential-path-test.ts already uses), and
 * source assertions read the real files, the same way scripts/mcp-worker-test.ts
 * asserts properties of the adapter it tests.
 *
 *   1. DISCOVER BEFORE ROW  — a provider that has a Connect contract is visible
 *      before any connectors row exists.
 *   2. IDENTITY IS DECLARED — a connector's provider is never guessed from a
 *      display name: the declared value wins, legacy slug identity is fallback.
 *   3. NO SECRET LEAK       — a canary value planted in the environment never
 *      appears in detect()/prepareConnect()/inspect() output; only FIELD NAMES do.
 *   4. APPROVAL IS A TRUST BOUNDARY — railway's contract requires Owner approval
 *      and the Connect route really refuses without an approved proposal.
 *   5. THE LIFECYCLE IS UNCHANGED — registry/connector-lifecycle.json keeps
 *      exactly its 5 locked stages, and core/connector-loader.ts's Run gate still
 *      rejects missing / unproven / not-enabled connectors.
 *   6. NO PROVIDER SWITCH IN THE CENTRAL ROUTE — resource discovery resolves the
 *      provider through the contract registry, not a hardcoded map.
 *   7. RAILWAY TOKEN CANONICALIZATION — one canonical secret field
 *      (`secret.api_token`) travels Prepare -> Connect -> Register -> Test -> Run;
 *      the lifecycle Test really sends that value as the bearer credential
 *      (proved against a local probe server, no external network), and the
 *      Railway binding reads that one name only.
 *
 * Run: npx tsx scripts/connect-core-acceptance-test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import {
  clearConnectorCache,
  requireConnector,
  ConnectorRejectedError,
  type ConnectorRecord,
} from "@/core/connector-loader";
import { testConnector } from "@/engines/connectors/tester";
import { findContract, listConnectContractIds } from "@/engines/connectors/registry";
import { resolveConnectorProvider, listNormalizedProviders } from "@/app/api/admin/ide/_lib/providerRegistryRuntime";
import { buildDetectDeps } from "@/app/api/admin/connectors/_lib/connectRuntime";
import type { ConnectRuntimeDeps } from "@/engines/connectors/contract";

const ROOT = join(__dirname, "..");

let pass = 0;
let fail = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

function source(relPath: string): string {
  const abs = join(ROOT, relPath);
  return existsSync(abs) ? readFileSync(abs, "utf-8") : "";
}

const PROVIDERS_ROUTE = "app/api/admin/connectors/providers/route.ts";
const CREATE_ROUTE = "app/api/admin/connectors/route.ts";
const APPROVAL_ROUTE = "app/api/admin/connectors/providers/[providerId]/approval-request/route.ts";
const DECIDE_ROUTE = "app/api/gateway/proposals/[id]/decide/route.ts";
const DISCOVER_ROUTE = "app/api/admin/connectors/discover/[slug]/route.ts";
const CATALOG = "app/api/admin/connectors/_lib/catalog.ts";
const GATEWAY_CONNECTORS = "gateway/connectors.ts";
const MIGRATION = "supabase/migrations/20260920000001_integration_gateway_proposals_allow_railway.sql";

/** Stub Supabase client: answers the connectors SELECT the loader performs and
 *  accepts the audit_logs insert, so the REAL loader code path runs. */
function stubDb(rows: ConnectorRecord[]) {
  const chain: any = {
    from: () => chain,
    select: () => chain,
    order: () => chain,
    eq: () => chain,
    limit: () => chain,
    insert: async () => ({ error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
  };
  return chain as never;
}

function fakeConnector(over: Partial<ConnectorRecord>): ConnectorRecord {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Railway",
    slug: "railway",
    auth_type: "token",
    status: "disconnected",
    enabled: false,
    config: {},
    secret: {},
    last_checked_at: null,
    last_error: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...over,
  } as ConnectorRecord;
}

function stubRuntimeDeps(over: Partial<ConnectRuntimeDeps> = {}): ConnectRuntimeDeps {
  return {
    appOrigin: () => null,
    getConnectorSummary: async () => ({
      id: "00000000-0000-0000-0000-000000000001",
      slug: "railway",
      status: "disconnected",
      enabled: false,
      auth_type: "token",
      config: {},
      // No secret stored yet: a fresh connector row has nothing under any name.
      secret_keys: [],
    }),
    getConnectorSummaryByProvider: async () => null,
    runCanonicalTest: async () => ({ status: "disconnected", last_error: null }),
    ...over,
  };
}

async function main() {
  console.log("\nConnect Core — acceptance tests\n" + "=".repeat(60));

  // ── 1. DISCOVER BEFORE ROW ────────────────────────────────────────────────
  console.log("\n1. discover before any connectors row");
  const contractIds = listConnectContractIds();
  check("at least one Connect contract is registered", contractIds.length > 0, `ids=[${contractIds.join(",")}]`);
  check("railway is a registered Connect contract", contractIds.includes("railway"));
  check("github is a registered Connect contract (the second provider)", contractIds.includes("github"), `ids=[${contractIds.join(",")}]`);

  const railway = findContract("railway");
  check("railway contract is resolvable by id", !!railway);

  const detectDeps = buildDetectDeps();
  const railwayArtifacts = railway ? railway.detect(detectDeps) : [];
  check("railway contract detect() returns real workspace artifacts", railwayArtifacts.length >= 3, `count=${railwayArtifacts.length}`);
  check(
    "every detect() artifact cites a real source",
    railwayArtifacts.every((e) => typeof e.source === "string" && e.source.length > 0)
  );

  const normalized = await listNormalizedProviders();
  check("the identity/evidence layer still returns providers", normalized.length > 0, `count=${normalized.length}`);
  const railwayInEvidenceLayer = normalized.some((p) => p.provider_id === "railway");
  check(
    "providers route unions contract-only providers (so a contract-only provider is visible)",
    source(PROVIDERS_ROUTE).includes("listConnectContractIds()") && source(PROVIDERS_ROUTE).includes("findContract("),
    `railway already present in the evidence layer: ${railwayInEvidenceLayer}`
  );

  // ── 2. IDENTITY IS DECLARED ───────────────────────────────────────────────
  console.log("\n2. provider identity is declared, never guessed");
  check("declared config.provider wins over the slug", resolveConnectorProvider({ provider: "railway" }, "railway-abc123") === "railway");
  check("declared value is normalized (trim + lowercase)", resolveConnectorProvider({ provider: "  RAILWAY  " }, "x") === "railway");
  check(
    "legacy rows fall back to the slug identity minus slugify's random suffix",
    resolveConnectorProvider({}, "supabase-management-api-208393") === "supabase-management-api"
  );
  check(
    "contract lookup is exact by id (no substring/fuzzy matching)",
    findContract("railway") !== undefined &&
      findContract("rail-way") === undefined &&
      findContract("railway2") === undefined &&
      findContract("") === undefined
  );
  check("contract lookup normalizes case only (an id variant, not a name guess)", findContract("Railway")?.providerId === "railway");
  check("catalog prefers the declared provider", source(CATALOG).includes("resolveConnectorProvider("));
  check("createConnector stores the declared provider", source(GATEWAY_CONNECTORS).includes("config.provider = input.provider"));

  // ── 3. NO SECRET LEAK ────────────────────────────────────────────────────
  console.log("\n3. no secret value is ever emitted");
  const CANARY = "canary-must-never-leak-7f3a91";
  process.env.RAILWAY_WEBHOOK_SECRET = CANARY;
  const detectJson = JSON.stringify(railway!.detect(buildDetectDeps()));
  check("detect() reports the env var NAME", detectJson.includes("env_var_name:RAILWAY_WEBHOOK_SECRET"));
  check("detect() never emits the env var VALUE", !detectJson.includes(CANARY));
  delete process.env.RAILWAY_WEBHOOK_SECRET;

  const inspectJson = JSON.stringify(await railway!.inspect(stubRuntimeDeps()));
  check("inspect() reports missing secret FIELD names", inspectJson.includes("api_token"));
  check("inspect() never emits a secret value", !inspectJson.includes(CANARY));

  const inspectConfigured = await railway!.inspect(
    stubRuntimeDeps({
      getConnectorSummary: async () => ({
        id: "00000000-0000-0000-0000-000000000001",
        slug: "railway",
        status: "connected",
        enabled: true,
        auth_type: "token",
        config: {},
        secret_keys: ["api_token"],
      }),
    })
  );
  check(
    "inspect() reports CONFIGURED when the canonical field is stored",
    inspectConfigured.credential_status === "CONFIGURED" && inspectConfigured.missing_field_keys.length === 0,
    `status=${inspectConfigured.credential_status} missing=[${inspectConfigured.missing_field_keys.join(",")}]`
  );

  const prepNoOrigin = await railway!.prepareConnect(stubRuntimeDeps());
  check(
    "prepareConnect() requires exactly the one canonical secret field",
    JSON.stringify(prepNoOrigin.required_secret_field_keys) === JSON.stringify(["api_token"]),
    `got=${JSON.stringify(prepNoOrigin.required_secret_field_keys)}`
  );
  check("prepareConnect() never emits the canary", !JSON.stringify(prepNoOrigin).includes(CANARY));
  check("prepareConnect() invents no URL when the app origin is unset", prepNoOrigin.derived.length === 0);

  const prepWithOrigin = await railway!.prepareConnect(stubRuntimeDeps({ appOrigin: () => "https://example.test" }));
  const observe = prepWithOrigin.derived.find((d) => d.key === "observe_url");
  check(
    "prepareConnect() derives the observe URL from the real route path",
    observe?.value === "https://example.test/api/gateway/observe/railway",
    `got=${observe?.value ?? "none"}`
  );
  check("prepareConnect() carries provider-declared defaults", prepWithOrigin.defaults.some((d) => d.key === "base_url"));
  check(
    "prepareConnect() declares approval on the preparation itself",
    prepWithOrigin.approval === railway!.approvalRequirement && prepWithOrigin.provider_id === "railway"
  );

  // ── 4. APPROVAL IS A TRUST BOUNDARY ──────────────────────────────────────
  console.log("\n4. owner approval is a real trust boundary");
  check("railway contract declares OWNER_REQUIRED", railway!.approvalRequirement === "OWNER_REQUIRED");
  const createSrc = source(CREATE_ROUTE);
  check("Connect route compares the contract's approval requirement", createSrc.includes('contract.approvalRequirement === "OWNER_REQUIRED"'));
  check("Connect route reads the real approval record", createSrc.includes("getLatestProposal("));
  check("Connect route fails closed with OWNER_APPROVAL_REQUIRED", createSrc.includes("OWNER_APPROVAL_REQUIRED") && createSrc.includes("403"));
  const approvalSrc = source(APPROVAL_ROUTE);
  check("approval request publishes on the existing Propose Channel", approvalSrc.includes("publish(") && approvalSrc.includes("connect.approval.requested"));
  check("approval request is idempotent", approvalSrc.includes("already_approved") && approvalSrc.includes("already_pending"));
  check("decision reuses the existing decide route (no second approval path)", source(DECIDE_ROUTE).includes("connect.approval.requested"));
  const migration = source(MIGRATION);
  check("migration draft exists", migration.length > 0);
  check("migration draft allows the railway provider", migration.includes("'railway'"));

  // ── 5. THE LIFECYCLE IS UNCHANGED ────────────────────────────────────────
  console.log("\n5. the existing lifecycle is still the only path");
  const lifecycle = JSON.parse(source("registry/connector-lifecycle.json")) as {
    stages?: string[];
    enforced_programmatically_by?: string;
  };
  check(
    "lifecycle still has exactly its 5 locked stages",
    JSON.stringify(lifecycle.stages) === JSON.stringify(["connect", "register", "test", "enable", "run"]),
    `stages=${JSON.stringify(lifecycle.stages)}`
  );
  check(
    "lifecycle still points at its own programmatic guard",
    typeof lifecycle.enforced_programmatically_by === "string" &&
      lifecycle.enforced_programmatically_by.includes("check-connector-lifecycle.sh")
  );

  clearConnectorCache();
  const missing = await requireConnector(stubDb([]), "railway", "connect-core-acceptance-test")
    .then(() => null)
    .catch((e: unknown) => e);
  check(
    "Run gate rejects a connector that was never registered",
    missing instanceof ConnectorRejectedError && String((missing as Error).message).includes("Register")
  );

  clearConnectorCache();
  const unproven = await requireConnector(stubDb([fakeConnector({ status: "disconnected" })]), "railway", "connect-core-acceptance-test")
    .then(() => null)
    .catch((e: unknown) => e);
  check(
    "Run gate rejects a connector that never passed Test",
    unproven instanceof ConnectorRejectedError && String((unproven as Error).message).includes("Test")
  );

  clearConnectorCache();
  const notEnabled = await requireConnector(stubDb([fakeConnector({ status: "connected", enabled: false })]), "railway", "connect-core-acceptance-test")
    .then(() => null)
    .catch((e: unknown) => e);
  check(
    "Run gate rejects a connector that was never Enabled",
    notEnabled instanceof ConnectorRejectedError && String((notEnabled as Error).message).includes("Enable")
  );

  clearConnectorCache();
  const allowed = await requireConnector(stubDb([fakeConnector({ status: "connected", enabled: true })]), "railway", "connect-core-acceptance-test")
    .then((r) => r)
    .catch(() => null);
  check("Run gate allows exactly connected + enabled", allowed !== null && allowed.slug === "railway");

  // ── 6. NO PROVIDER SWITCH IN THE CENTRAL ROUTE ───────────────────────────
  console.log("\n6. no provider switch in the central discovery route");
  const discoverSrc = source(DISCOVER_ROUTE);
  check("the hardcoded provider->function map is gone", !discoverSrc.includes("DISCOVERERS"));
  check(
    "discovery resolves through the contract registry",
    discoverSrc.includes("findContract(") && discoverSrc.includes("discoverResources()")
  );
  check("discovery resolves the provider id, never the raw slug", discoverSrc.includes("resolveConnectorProvider("));

  // ── 7. RAILWAY TOKEN CANONICALIZATION (one field, no duplicate storage) ───
  console.log("\n7. railway uses exactly one canonical secret field");
  const railwayContractSrc = source("engines/connectors/providers/railway.ts");
  const secretFields = prepWithOrigin.fields.filter((f) => f.secret);
  check("the Connect form offers exactly one secret field", secretFields.length === 1, `count=${secretFields.length}`);
  check("that field is the canonical api_token", secretFields[0]?.key === "api_token", `key=${secretFields[0]?.key}`);
  check(
    "no api_key alias is declared anywhere in the preparation",
    !JSON.stringify(prepWithOrigin).includes("api_key")
  );
  check("the railway contract declares no api_key alias at all", !railwayContractSrc.includes('"api_key"'));

  const bindingSrc = source("engines/domains/railway-binding.ts");
  const canonicalReads = (bindingSrc.match(/secret\?\.api_token/g) ?? []).length;
  const aliasReads = (bindingSrc.match(/secret\?\.api_key/g) ?? []).length;
  check(
    "RAILWAY_BINDING_TOKEN_PARITY: the binding reads the canonical field only",
    canonicalReads >= 2 && aliasReads === 0,
    `api_token reads=${canonicalReads}, api_key reads=${aliasReads}`
  );

  const seen: { auth?: string; body?: string } = {};
  const probe = createServer((req, res) => {
    seen.auth = req.headers.authorization;
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      seen.body = raw;
      res.writeHead(200, { "content-type": "application/json" });
      // The Railway-shaped check requires a real data.me.id in the body.
      res.end(JSON.stringify({ data: { me: { id: "probe-service" } } }));
    });
  });
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
  const probePort = (probe.address() as { port: number }).port;
  const RAILWAY_TOKEN = "canary-railway-token-61b2";
  // The URL contains "backboard.railway" on purpose: that is the substring the
  // real tester uses to select its Railway-shaped GraphQL check, so this runs the
  // exact production Test path — only the host is local, no external network.
  const testResult = await testConnector(
    "token",
    { base_url: `http://127.0.0.1:${probePort}/backboard.railway/graphql/v2` },
    { api_token: RAILWAY_TOKEN }
  );
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  check("CONNECT_TEST_TOKEN_PARITY: lifecycle Test accepts api_token with no alias", testResult.ok === true, testResult.error);
  check(
    "CONNECT_TEST_TOKEN_PARITY: lifecycle Test sent that exact value as the bearer credential",
    seen.auth === `Bearer ${RAILWAY_TOKEN}`,
    `got=${seen.auth ?? "none"}`
  );
  check(
    "lifecycle Test used the Railway-shaped GraphQL check (body-level identity)",
    typeof seen.body === "string" && seen.body.includes("me { id }")
  );
  check(
    "the same canonical name is what Prepare asks for",
    prepWithOrigin.required_secret_field_keys[0] === "api_token" && secretFields[0]?.key === "api_token"
  );

  // ── 8. SECOND PROVIDER / PROVIDER NEUTRALITY (STEP 8) ────────────────────
  console.log("\n8. a second provider plugs in through the same contract only");
  const github = findContract("github");
  check("github resolves through the same registry lookup", github?.providerId === "github");
  check(
    "both providers expose the identical contract surface",
    !!railway &&
      !!github &&
      ["providerId", "authModes", "approvalRequirement", "capabilityMetadata", "detect", "inspect", "prepareConnect", "discoverResources", "test"].every(
        (k) => k in railway && k in github
      )
  );
  check(
    "the same central code path yields different behaviour purely from declared facts (no central branch)",
    railway!.authModes[0] === "token" &&
      github!.authModes[0] === "oauth" &&
      railway!.approvalRequirement === "OWNER_REQUIRED" &&
      github!.approvalRequirement === "NONE"
  );
  check(
    "the contract registry selects by data, not by provider branching",
    !/switch\s*\(/.test(
      source("engines/connectors/registry.ts").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")
    ) && !/if\s*\([^)]*(railway|github)/i.test(source("engines/connectors/registry.ts"))
  );
  check("the central discovery route still has no provider map", !source(DISCOVER_ROUTE).includes("DISCOVERERS"));

  const githubArtifacts = github ? github.detect(buildDetectDeps()) : [];
  check("github contract detect() returns real workspace artifacts", githubArtifacts.length >= 3, `count=${githubArtifacts.length}`);

  const githubInspect = await github!.inspect(stubRuntimeDeps());
  check(
    "github inspect() reports the missing config + secret FIELD names",
    githubInspect.missing_field_keys.includes("client_id") && githubInspect.missing_field_keys.includes("client_secret")
  );

  const githubPrep = await github!.prepareConnect(stubRuntimeDeps());
  check(
    "github prepareConnect() declares exactly one secret field",
    JSON.stringify(githubPrep.required_secret_field_keys) === JSON.stringify(["client_secret"])
  );
  check(
    "github prepareConnect() supplies the real declared OAuth defaults",
    githubPrep.defaults.some((d) => d.key === "authorize_url" && d.value === "https://github.com/login/oauth/authorize") &&
      githubPrep.defaults.some((d) => d.key === "test_url" && d.value === "https://api.github.com/user")
  );
  check("github prepareConnect() invents no callback URL before the row exists", githubPrep.derived.length === 0);

  const githubPreparedWithRow = await github!.prepareConnect(
    stubRuntimeDeps({
      getConnectorSummary: async () => ({
        id: "00000000-0000-0000-0000-000000000002",
        slug: "github",
        status: "disconnected",
        enabled: false,
        auth_type: "oauth",
        config: { redirect_uri: "https://example.test/api/connectors/oauth/callback/github-abc123" },
        secret_keys: [],
      }),
    })
  );
  check(
    "github surfaces the real callback URL read-only once the row exists",
    githubPreparedWithRow.derived.some((d) => d.key === "callback_url" && d.value === "https://example.test/api/connectors/oauth/callback/github-abc123")
  );

  const githubDiscovery = await github!.discoverResources();
  check(
    "github discovery answers NOT_SUPPORTED honestly instead of inventing resources",
    githubDiscovery.ok === false && githubDiscovery.code === "NOT_SUPPORTED"
  );

  const githubTestWithRow = await github!.test(stubRuntimeDeps());
  check(
    "github test() fails closed while the stub row is not connected",
    githubTestWithRow.ok === false && String(githubTestWithRow.error).includes("disconnected")
  );
  const githubTestNoRow = await github!.test(stubRuntimeDeps({ getConnectorSummary: async () => null }));
  check(
    "github test() fails closed with no connector row at all",
    githubTestNoRow.ok === false && String(githubTestNoRow.error).includes("connector_not_registered")
  );

  console.log("\n" + "=".repeat(60));
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[connect-core-acceptance-test] failed:", e);
  process.exit(1);
});
