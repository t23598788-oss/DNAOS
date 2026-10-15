/**
 * provider-credentials-test.ts — Connections & Credentials (Provider Settings
 * + Credentials UI) acceptance, structural half (PHASE 11 A–N). Pure
 * source-truth reads of real files: no mocks, no fixtures, no network.
 * Runtime halves (G/K/L/M live behaviour) need Owner login + the migration
 * applied on the target DB — this script proves the wiring, gates, seeds,
 * redaction, audit calls, and the ONE-component/ONE-data-source rule offline.
 *
 * PASS/FAIL per check; exit 1 on any FAIL.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;

function read(p: string): string {
  return readFileSync(join(ROOT, p), "utf8");
}
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const settings = read("app/admin/settings/page.tsx");
const linePage = read("app/admin/line-customers/page.tsx");
const board = read("components/admin/ConnectionsCredentialsBoard.tsx");
const toolBindings = read("app/workspace/_lib/toolBindings.ts");
const migration = read("supabase/migrations/20260924000001_provider_credential_settings.sql");
const getRoute = read("app/api/admin/provider-settings/route.ts");
const putRoute = read("app/api/admin/provider-settings/[providerId]/route.ts");
const rotateRoute = read("app/api/admin/provider-settings/[providerId]/rotate/route.ts");
const reqRoute = read("app/api/admin/provider-settings/[providerId]/request-approval/route.ts");
const metaLib = read("app/api/admin/provider-settings/_lib/providerCredentialMeta.ts");
const connRoute = read("app/api/admin/connectors/[id]/route.ts");
const loader = read("core/connector-loader.ts");
const decideRoute = read("app/api/gateway/proposals/[id]/decide/route.ts");
const proposalStore = read("engines/integration-gateway/evidence/proposalStore.ts");
const lineContract = read("engines/connectors/providers/line.ts");
const railwayContract = read("engines/connectors/providers/railway.ts");
const githubContract = read("engines/connectors/providers/github.ts");
const frameShell = read("app/workspace/WorkspaceFrame.tsx");
const connectorsPage = read("app/admin/connectors/page.tsx");

const BOARD_MODULE = '@/components/admin/ConnectionsCredentialsBoard';

// ── A: Settings page reachability ───────────────────────────────────────────
// OWNER DIRECTIVE 2026-10-15: /admin/settings แสดง Connections & Credentials,
// Supabase SQL Editor / Table Editor / API Keys, Railway/Vercel/GitHub links —
// เป็น Internal System Links ที่ห้ามอยู่ในหน้าจอผู้ใช้ธุรกิจ ฉะนั้น "workspace
// Settings box → /admin/settings" จึงถูกถอดออกจาก surface ผู้ใช้ (หน้าจริงยังอยู่
// และยังเปิดได้จาก Developer Workspace / super_admin เท่านั้น)
check(
  "A. business surface ไม่ผูก /admin/settings อีกแล้ว (owner directive 2026-10-15)",
  !toolBindings.includes('"/admin/settings"'),
);
check("A. Settings page hosts Connections & Credentials section", settings.includes('id="connections-credentials"') && settings.includes("Connections &amp; Credentials"));

// ── B: line-customers → PROVIDER CONTROL → API & Credentials Management ─────
check("B. line-customers tab 'API & Credentials Management'", linePage.includes("API &amp; Credentials Management"));
check("B. line-customers tab bar labeled Provider Control", linePage.includes("Provider Control"));

// ── C: both pages mount the SAME module (one settings system) ───────────────
const importers: string[] = [];
function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p);
    } else if (/\.(ts|tsx)$/.test(name)) {
      const src = readFileSync(p, "utf8");
      if (src.includes(BOARD_MODULE)) importers.push(p.slice(ROOT.length + 1));
    }
  }
}
walk(join(ROOT, "app"));
const expected = ["app/admin/line-customers/page.tsx", "app/admin/settings/page.tsx"].sort();
check("C. board imported by EXACTLY Settings + line-customers", JSON.stringify([...importers].sort()) === JSON.stringify(expected), `got ${JSON.stringify(importers)}`);
check("C. board single data source GET /api/admin/provider-settings", board.includes("/api/admin/provider-settings"));

// ── D/E/F: registry seeds == contract ground truth (LINE / GitHub / Railway) ─
check("D. LINE seed row channel_access_token required+secret", /\('line',\s*'channel_access_token',\s*'Channel Access Token',\s*'secret',\s*true,\s*true/.test(migration));
check("D. LINE contract REQUIRED_SECRET_KEYS matches seed", lineContract.includes('["channel_access_token"]'));
check("D. LINE optional rows channel_secret + channel_id exist", migration.includes("'line', 'channel_secret'") && migration.includes("'line', 'channel_id'"));
check("E. GitHub seed rows client_id (config) + client_secret (secret) required", /\('github',\s*'client_id',\s*'Client ID',\s*'text',\s*true,\s*false/.test(migration) && /\('github',\s*'client_secret',\s*'Client Secret',\s*'secret',\s*true,\s*true/.test(migration));
check("E. GitHub contract REQUIRED keys match seeds", githubContract.includes('["client_id"]') && githubContract.includes('["client_secret"]'));
check("E. GitHub scope read:user matches contract DEFAULT_SCOPE", githubContract.includes('"read:user"') && migration.includes("'read:user'"));
check("F. Railway seed api_token required+secret + config rows", /\('railway',\s*'api_token',\s*'API Token',\s*'secret',\s*true,\s*true/.test(migration) && migration.includes("'railway', 'environment_id'") && migration.includes("'railway', 'service_id'"));
check("F. Railway contract CANONICAL_TOKEN_KEY matches seed", railwayContract.includes('"api_token"'));
check("F. NO per-provider form code in board (schema-driven)", !/===\s*"(line|github|railway)"/.test(board) && board.includes("b.reqs.map("));

// ── G: no secret leak (structural) ───────────────────────────────────────────
check("G. board secret inputs write-only password fields", board.includes('type="password"') && board.includes('autoComplete="new-password"'));
check("G. board treats redacted secret as boolean map only", board.includes("secret: Record<string, boolean>"));
check("G. board shows 'Configured' badge, never a value", board.includes("Configured") && !board.includes("String(conn?.secret") && !board.includes("{conn?.secret") && !board.includes("{conn.secret"));
check("G. GET redacts connectors", getRoute.includes("redactConnectors"));
check("G. PUT + rotate answer with redactConnector only", putRoute.includes("redactConnector(") && rotateRoute.includes("redactConnector("));
check("G. no console.log in mutation routes (values can never print)", !/console\.(log|info|debug)\(/.test(putRoute + rotateRoute + reqRoute));
check("G. no secret in URL/argv anywhere in new routes", !/\?.*secret=/.test(putRoute + rotateRoute + reqRoute + getRoute));

// ── H: update works ──────────────────────────────────────────────────────────
check("H. PUT save route exists + board Save uses PUT", existsSync(join(ROOT, "app/api/admin/provider-settings/[providerId]/route.ts")) && board.includes('method: "PUT"'));
check("H. unknown credential keys refused (no raw jsonb)", metaLib.includes("UNKNOWN_CREDENTIAL_KEY"));

// ── I: rotate with verify + restore-on-fail ──────────────────────────────────
check("I. rotate route exists", existsSync(join(ROOT, "app/api/admin/provider-settings/[providerId]/rotate/route.ts")));
check("I. rotate verifies via existing runConnectorTest", rotateRoute.includes("runConnectorTest"));
check("I. rotate FAIL restores old secret (never destroys)", rotateRoute.includes("updateConnector(connectorId, { secret: oldSecret })"));
check("I. rotate FAIL answers ROTATE_VERIFY_FAILED + restored:true", rotateRoute.includes("ROTATE_VERIFY_FAILED") && rotateRoute.includes("restored: true"));
check("I. rotate PASS bumps version + verified/rotated timestamps", rotateRoute.includes("credential_version: prevVersion + 1") && rotateRoute.includes("last_rotated_at") && rotateRoute.includes("last_verified_at"));

// ── J: test connection reuses canonical test (no test logic in UI) ───────────
check("J. board Test calls EXISTING /api/admin/connectors/[id]/test", board.includes("connectors/${b.connector.id}/test"));
check("J. Verify All loops the same canonical test", board.includes("verifyAll") && board.includes("testProvider(b)"));

// ── K/L: persistence + ordering come from DB ────────────────────────────────
check("K/L. loadSettings orders by sort_order from DB (nulls last)", metaLib.includes('order("sort_order"') && metaLib.includes("nullsFirst: false"));
check("L. board renumbers sort_order via PUT (no local order array)", board.includes("sort_order: (i + 1) * 10") && !board.includes("DEFAULT_ORDER"));

// ── M: audit written for every mutation + approval gate wired ───────────────
for (const action of ["secret_saved", "rotated", "rotate_failed", "disconnected"]) {
  check(`M. lifecycle action '${action}' in audit_logs union`, loader.includes(`"${action}"`));
}
check("M. lifecycle writes actor_user_id (real column)", loader.includes("actor_user_id: detail.actorUserId"));
check("M. PUT save logs audit_logs + provider_credential_events", putRoute.includes('logConnectorLifecycleEvent(db, id, "secret_saved"') && putRoute.includes("insertEvent"));
check("M. rotate logs rotated + rotate_failed (both paths)", rotateRoute.includes('"rotated"') && rotateRoute.includes('"rotate_failed"') && rotateRoute.includes("insertEvent"));
check("M. DELETE logs disconnected + event", connRoute.includes('"disconnected"') && connRoute.includes("insertEvent"));
check("M. events carry actor email + field NAMES only", metaLib.includes("actor: input.actor") && metaLib.includes("field_keys: JSON.stringify"));
check("M. production rotate gated by approved proposal", rotateRoute.includes("assertProviderMutationAllowed") && rotateRoute.includes("OWNER_APPROVAL_REQUIRED"));
check("M. production disconnect gated in DELETE route", connRoute.includes("assertProviderMutationAllowed") && connRoute.includes('"disconnect"'));
check("M. request-approval publishes to ONE propose channel", reqRoute.includes("publish(db, event)") && reqRoute.includes("connector.${k}.requested"));
check("M. decide route approve-only branch covers connector.*", decideRoute.includes('proposal.capability.startsWith("connector.")'));
check("M. proposalStore exposes connector mutation reads", proposalStore.includes("listConnectorMutationProposals"));

// ── N: no duplicate settings architecture ───────────────────────────────────
function filesWith(pattern: RegExp): string[] {
  const out: string[] = [];
  const scan = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === "node_modules" || name === ".next" || name === "migrations") continue;
        scan(p);
      } else if (/\.(ts|tsx)$/.test(name) && pattern.test(readFileSync(p, "utf8"))) {
        out.push(p.slice(ROOT.length + 1));
      }
    }
  };
  scan(join(ROOT, "app"));
  scan(join(ROOT, "components"));
  scan(join(ROOT, "core"));
  scan(join(ROOT, "gateway"));
  scan(join(ROOT, "engines"));
  return out.sort();
}
const META = "app/api/admin/provider-settings/_lib/providerCredentialMeta.ts";
const settingsWriters = filesWith(/\.from\("provider_connection_settings"\)/);
check("N. ONLY the metadata layer writes provider_connection_settings", JSON.stringify(settingsWriters) === JSON.stringify([META]), JSON.stringify(settingsWriters));
const eventsWriters = filesWith(/\.from\("provider_credential_events"\)/);
check("N. ONLY the metadata layer writes provider_credential_events", JSON.stringify(eventsWriters) === JSON.stringify([META]), JSON.stringify(eventsWriters));

// ── PHASE 8 entry points ────────────────────────────────────────────────────
check("PHASE8. ONE chat surface — frame gear → /admin/settings ถูกถอดจากหน้าจอผู้ใช้ธุรกิจ (owner directive 2026-10-15) · หน้าเลขา dashboard เดิมยังถูกตัดออก", !frameShell.includes('router.push("/admin/settings")') && !existsSync(join(ROOT, "app/admin/dashboard/page.tsx")));
check("PHASE8. Setup Provider deep-link preselects connectors page", connectorsPage.includes('get("provider")') && board.includes("/admin/connectors?provider="));
check("PHASE8. Verify All action exists on board", board.includes("Verify All"));

console.log(`\nprovider-credentials: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);


