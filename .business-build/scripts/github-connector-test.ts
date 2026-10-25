/**
 * GitHub Connections Rail Regression Suite (TASK-073, capability #62
 * STEP 7 — /admin/ide Connections rail, GitHub minimal slice, 2026-08-10).
 *
 * Real, honest verification of exactly what CAN be verified without real
 * Owner-supplied GitHub OAuth App credentials (GITHUB_OAUTH_CLIENT_ID /
 * GITHUB_OAUTH_CLIENT_SECRET are not configured in this environment — see
 * scripts/register-github-oauth-connector.ts's own SKIP path, exercised
 * for real below, not mocked):
 *
 *   (a) commandSurfaceRuntime.ts really recognizes the new CONNECT_PROVIDER
 *       intent for real Thai/English example phrases (and does NOT
 *       misfire on unrelated existing intents or unknown provider names).
 *   (b) components/ide-shell/IDEWorkspace.tsx's new ConnectionsPanel is
 *       structurally wired correctly (ToolId union, TOOLS array, LeftPanel
 *       case, real fetch of /api/admin/connectors/catalog, real Connect/
 *       Test action wiring) — a source-text structural trace, matching
 *       this repo's existing plain-assertion test convention (no
 *       component-testing framework is installed — see package.json).
 *   (c) scripts/register-github-oauth-connector.ts is run for REAL (as a
 *       real child process, exactly as an Owner/CI would run it) and
 *       genuinely SKIPs because the real credentials are genuinely absent
 *       — never mocked, never a fabricated "it would have worked" claim.
 *   (d) engines/connectors/tester.ts's new GitHub-specific check
 *       (testGithubUser, reached via testConnector("oauth", ...) when
 *       config.test_url includes "api.github.com") is real, executable
 *       code — verified with a MOCKED global.fetch (a fake token, fake
 *       responses; explicitly never a live api.github.com call, per this
 *       task's "no real, costly, or external-side-effect call" rule) —
 *       and that it does NOT change behavior for every other existing
 *       OAuth provider's generic test_url path (e.g. TikTok's).
 *
 * Run: npx tsx scripts/github-connector-test.ts
 */
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import { randomUUID } from "crypto";
import { handleOwnerCommand } from "../app/api/admin/ide/_lib/commandSurfaceRuntime";
import { testConnector } from "../engines/connectors/tester";

const ROOT = path.join(__dirname, "..");
const ACTOR = "github-connector-regression-suite@dnaos.local";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }
function freshOwner(): string { return `github-connector-test-owner-${randomUUID()}`; }

/** Real, temporary global.fetch replacement — restored in a finally block
 * every time. Never touches the real network; used only to prove the
 * GitHub-specific code path in engines/connectors/tester.ts branches and
 * validates response shape correctly, per this task's explicit
 * "structural verification only, mocked/fake token" allowance. */
async function withMockedFetch<T>(handler: (url: string, init?: RequestInit) => Promise<Response> | Response, fn: () => Promise<T>): Promise<T> {
  const real = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = async (url: string, init?: RequestInit) => handler(url, init);
  try {
    return await fn();
  } finally {
    global.fetch = real;
  }
}

async function main() {
  // ---- (a) CONNECT_PROVIDER intent recognition ----
  await test('Intent: "เชื่อม GitHub" resolves to CONNECT_PROVIDER with providerHint "github"', async () => {
    const r = await handleOwnerCommand("เชื่อม GitHub", ACTOR, freshOwner());
    assert(r.intent === "CONNECT_PROVIDER", `expected CONNECT_PROVIDER, got ${r.intent}`);
    assert(r.providerHint === "github", `expected providerHint "github", got ${r.providerHint}`);
    assert(r.status === "OWNER_ACTION_REQUIRED", `expected OWNER_ACTION_REQUIRED, got ${r.status}`);
    assert(r.detail.includes("/api/connectors/oauth/authorize/github"), "expected the detail to point at the real, existing OAuth authorize route, not a fabricated one");
  });

  await test('Intent: "connect github" (English) also resolves to CONNECT_PROVIDER', async () => {
    const r = await handleOwnerCommand("connect github", ACTOR, freshOwner());
    assert(r.intent === "CONNECT_PROVIDER", `expected CONNECT_PROVIDER, got ${r.intent}`);
    assert(r.providerHint === "github", `expected providerHint "github", got ${r.providerHint}`);
  });

  await test('Intent: "เปิด GitHub" also resolves to CONNECT_PROVIDER (not shadowed by เปิดไฟล์)', async () => {
    const r = await handleOwnerCommand("เปิด GitHub", ACTOR, freshOwner());
    assert(r.intent === "CONNECT_PROVIDER", `expected CONNECT_PROVIDER, got ${r.intent}`);
    assert(r.providerHint === "github", `expected providerHint "github", got ${r.providerHint}`);
  });

  await test('Intent: "open GitHub" (English "open") also resolves to CONNECT_PROVIDER', async () => {
    const r = await handleOwnerCommand("open GitHub", ACTOR, freshOwner());
    assert(r.intent === "CONNECT_PROVIDER", `expected CONNECT_PROVIDER, got ${r.intent}`);
  });

  await test("Regression: \"เปิดไฟล์ README.md\" still resolves to OPEN_FILE_HINT — CONNECT_PROVIDER never shadows the existing OPEN_FILE_HINT pattern", async () => {
    const r = await handleOwnerCommand("เปิดไฟล์ README.md", ACTOR, freshOwner());
    assert(r.intent === "OPEN_FILE_HINT", `expected OPEN_FILE_HINT, got ${r.intent}`);
    assert(r.hintTargetPath === "README.md", `expected the real literal path, got ${r.hintTargetPath}`);
  });

  await test("Honesty: an unknown provider name (not in the real, explicit allow-list) is never guessed as CONNECT_PROVIDER", async () => {
    const r = await handleOwnerCommand("connect dropbox", ACTOR, freshOwner());
    assert(r.intent !== "CONNECT_PROVIDER", `expected NOT CONNECT_PROVIDER for an unrecognized provider, got ${r.intent}`);
  });

  await test("Every CONNECT_PROVIDER invocation still produces a real, non-empty COMMAND_INVOCATION evidence artifact", async () => {
    const r = await handleOwnerCommand("เชื่อม GitHub", ACTOR, freshOwner());
    assert(typeof r.evidenceArtifactId === "string" && r.evidenceArtifactId.length > 0, "expected a real, non-empty evidenceArtifactId");
  });

  // ---- (b) ConnectionsPanel structural wiring (no component-testing
  // framework installed in this repo — verified via source-text trace,
  // same convention scripts/command-surface-test.ts already uses) ----
  const ideWorkspaceSrc = readFileSync(path.join(ROOT, "components/ide-shell/IDEWorkspace.tsx"), "utf-8");

  await test('IDEWorkspace.tsx: ToolId union includes "connections"', () => {
    assert(/type ToolId = [^;]*"connections"/.test(ideWorkspaceSrc), 'expected "connections" to be a real member of the ToolId union');
  });

  await test('IDEWorkspace.tsx: TOOLS array registers a real "connections" entry (Activity Bar)', () => {
    assert(/\{\s*id:\s*"connections"\s*,\s*label:\s*"Connections"/.test(ideWorkspaceSrc), "expected a real { id: \"connections\", label: \"Connections\" } TOOLS entry");
  });

  await test('IDEWorkspace.tsx: LeftPanel renders <ConnectionsPanel /> for tool === "connections"', () => {
    assert(/tool === "connections" && <ConnectionsPanel/.test(ideWorkspaceSrc), "expected a real LeftPanel case rendering ConnectionsPanel");
  });

  await test("IDEWorkspace.tsx: ConnectionsPanel fetches the real, existing GET /api/admin/connectors/catalog endpoint (no new registry)", () => {
    const fnMatch = ideWorkspaceSrc.match(/function ConnectionsPanel\(\)[\s\S]*?\n\}\n/);
    assert(!!fnMatch, "expected to find the real ConnectionsPanel function body");
    const body = fnMatch![0];
    assert(body.includes('"/api/admin/connectors/catalog"'), "expected a real fetch of the existing catalog endpoint");
    assert(body.includes("entry.healthStatus"), "expected the real CatalogEntry.healthStatus field to be rendered");
    assert(body.includes("entry.capabilities"), "expected the real CatalogEntry.capabilities field to be rendered");
    assert(body.includes("entry.logo"), "expected the real CatalogEntry.logo field to be rendered");
    assert(body.includes("entry.product"), "expected the real CatalogEntry.product field to be rendered");
  });

  await test("IDEWorkspace.tsx: ConnectionsPanel's Connect action links to the existing, real OAuth authorize route (no parallel OAuth flow)", () => {
    assert(ideWorkspaceSrc.includes("/api/connectors/oauth/authorize/${entry.slug}"), "expected a real href to the existing generic OAuth authorize route, keyed by the real connector slug");
  });

  await test("IDEWorkspace.tsx: ConnectionsPanel's Test action posts to the existing, real [id]/test route (no new test mechanism)", () => {
    assert(ideWorkspaceSrc.includes("/api/admin/connectors/${entry.connectorId}/test"), "expected a real POST to the existing per-connector test route");
  });

  await test("Purely additive: the existing ExplorerPanel/TreeNode implementation is untouched (still present, still the real workspace-tree fetch)", () => {
    assert(ideWorkspaceSrc.includes('fetchIde<TreeResponse>(`/api/admin/ide/tree'), "expected the existing real Explorer tree fetch to still be present, unmodified in shape");
  });

  await test("CommandSurfaceBar real client-side navigation: CONNECT_PROVIDER opens the Connections tool (no server call for the navigation itself)", () => {
    assert(ideWorkspaceSrc.includes('body.result.intent === "CONNECT_PROVIDER"'), "expected a real client check for the CONNECT_PROVIDER intent");
    assert(ideWorkspaceSrc.includes("onOpenConnections()"), "expected the real callback that switches activeTool to \"connections\" to be invoked");
  });

  // ---- (c) Registration script — run for REAL as a child process; must
  // genuinely SKIP because GITHUB_OAUTH_CLIENT_ID/SECRET are genuinely
  // absent from .env.local in this environment. This is a real
  // subprocess run, not a mock — but it makes zero external network
  // calls because the SKIP check happens before any such call. ----
  await test("scripts/register-github-oauth-connector.ts really SKIPs when GITHUB_OAUTH_CLIENT_ID/SECRET are absent (real subprocess run, real .env.local)", () => {
    const envKeys = (() => {
      try {
        return readFileSync(path.join(ROOT, ".env.local"), "utf8")
          .split("\n")
          .filter((l) => l.includes("=") && !l.startsWith("#"))
          .map((l) => l.slice(0, l.indexOf("=")));
      } catch {
        return [];
      }
    })();
    // Precondition check, not the thing under test — if a future session
    // adds real GitHub credentials, this test must fail loudly (not
    // silently pass on a stale assumption) rather than misreport SKIP as
    // still-expected behavior.
    assert(
      !envKeys.includes("GITHUB_OAUTH_CLIENT_ID") && !envKeys.includes("GITHUB_OAUTH_CLIENT_SECRET"),
      "GITHUB_OAUTH_CLIENT_ID/SECRET are now present in .env.local — this test's SKIP assumption is stale, update it (do NOT assert SKIP once real credentials exist)"
    );

    const output = execFileSync("npx", ["tsx", "scripts/register-github-oauth-connector.ts"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    assert(output.includes("SKIP github"), `expected a real, honest "SKIP github" line in the script's own output, got:\n${output}`);
    assert(!output.includes("REGISTERED"), `expected NO "REGISTERED" line (must never fabricate a connector row without real credentials), got:\n${output}`);
  });

  // ---- (d) engines/connectors/tester.ts GitHub-specific check — real
  // code, verified with a MOCKED fetch (fake token, fake HTTP responses).
  // Never a live api.github.com call. ----
  const FAKE_TOKEN = "fake-token-for-structural-verification-only-never-real";
  const githubConfig = { test_url: "https://api.github.com/user" };

  await test("tester.ts: real GitHub check accepts a real-shaped GET /user response (has \"login\")", async () => {
    const result = await withMockedFetch(
      async () => new Response(JSON.stringify({ login: "octocat", id: 1 }), { status: 200 }),
      () => testConnector("oauth", githubConfig, { access_token: FAKE_TOKEN })
    );
    assert(result.ok === true, `expected ok:true for a real-shaped GitHub user response, got ${JSON.stringify(result)}`);
  });

  await test("tester.ts: real GitHub check REJECTS a 200 response missing \"login\" — guards against a false positive", async () => {
    const result = await withMockedFetch(
      async () => new Response(JSON.stringify({ unexpected: "shape" }), { status: 200 }),
      () => testConnector("oauth", githubConfig, { access_token: FAKE_TOKEN })
    );
    assert(result.ok === false, "expected ok:false for a 200 response that isn't really GitHub's user shape");
    assert(!!result.error && result.error.includes("login"), `expected the error to mention the missing "login" field, got ${result.error}`);
  });

  await test("tester.ts: real GitHub check reports a real HTTP error status honestly", async () => {
    const result = await withMockedFetch(
      async () => new Response("", { status: 401 }),
      () => testConnector("oauth", githubConfig, { access_token: FAKE_TOKEN })
    );
    assert(result.ok === false, "expected ok:false for HTTP 401");
    assert(!!result.error && result.error.includes("401"), `expected the real HTTP status in the error, got ${result.error}`);
  });

  await test("tester.ts: real GitHub check handles a non-JSON response honestly (never crashes, never fabricates ok:true)", async () => {
    const result = await withMockedFetch(
      async () => new Response("not json", { status: 200 }),
      () => testConnector("oauth", githubConfig, { access_token: FAKE_TOKEN })
    );
    assert(result.ok === false, "expected ok:false for a non-JSON 200 response");
  });

  await test("tester.ts: no access_token still fails honestly before any fetch — GitHub branch doesn't bypass the existing authorize gate", async () => {
    let fetchCalled = false;
    const result = await withMockedFetch(
      async () => { fetchCalled = true; return new Response("{}", { status: 200 }); },
      () => testConnector("oauth", githubConfig, {})
    );
    assert(result.ok === false, "expected ok:false with no access_token");
    assert(!fetchCalled, "expected zero fetch calls when there is no access_token yet — the existing pre-check must still run first");
  });

  await test("tester.ts: the GitHub-specific branch does NOT change behavior for a different provider's generic test_url (e.g. TikTok's real endpoint shape)", async () => {
    const tiktokConfig = { test_url: "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,follower_count" };
    const result = await withMockedFetch(
      async () => new Response(JSON.stringify({ data: { user: { open_id: "x" } } }), { status: 200 }),
      () => testConnector("oauth", tiktokConfig, { access_token: FAKE_TOKEN })
    );
    // Generic path: any HTTP 200 is ok:true, no body-shape check (unlike
    // the new GitHub-specific branch) — proves the new branch is real and
    // scoped, not a blanket rewrite of testOAuth()'s existing behavior.
    assert(result.ok === true, `expected the existing generic OAuth path to still just check res.ok for non-GitHub providers, got ${JSON.stringify(result)}`);
  });

  console.log("\n=== GitHub Connections Rail Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
