/**
 * Google Workspace documentation/UI drift proofs.
 *
 * Compares docs + Owner connection-summary projection against runtime
 * authorizations.jsonl. Does not call Google or run OAuth.
 *
 * How to run: npx tsx connections/google-workspace/tests/google-workspace-doc-ui-alignment.test.ts
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GOOGLE_AUTHORIZE_SCOPES,
  GOOGLE_CONNECTION_ID,
  GOOGLE_CREDENTIAL_REF,
  GOOGLE_OAUTH_BEGIN_PATH,
  GOOGLE_OAUTH_CALLBACK_PATH,
  WRITE_ENABLED,
} from "../contract";
import {
  assertRuntimeCannotRenderNotConnected,
  CONNECTION_DOCUMENT_ROLE,
  projectGoogleWorkspaceConnectionStatus,
} from "../connection-status-projection";
import { loadConnectionSummaries } from "../../../control/conversation-runtime/connection-summary";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`PASS ${name}${detail ? ` :: ${detail}` : ""}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

function latestRecordFromJsonl(jsonlPath: string, connection_id?: string): Record<string, unknown> | null {
  const text = readFileSync(jsonlPath, "utf8").split("\n").filter((l) => l.trim().length > 0);
  if (text.length === 0) return null;
  const rows = text.map((l) => JSON.parse(l) as Record<string, unknown>);
  const filtered = connection_id ? rows.filter((r) => r.connection_id === connection_id) : rows;
  return filtered.length > 0 ? filtered[filtered.length - 1]! : null;
}

function field(md: string, key: string): string | null {
  const re = new RegExp(`^${key}\\n([^\\n]+)`, "m");
  const m = md.match(re);
  return m ? m[1]!.trim() : null;
}

async function main(): Promise<void> {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const DOC_MD_PATH = join(HERE, "..", "GOOGLE_WORKSPACE_CONNECTION.md");
  const DOC_JSON_PATH = join(HERE, "..", "connection-document.json");
  const authStorePath = join(HERE, "..", "oauth", "data", "authorizations.jsonl");
  const clientConfigPath = join(HERE, "..", "oauth", "data", "oauth-client-config.jsonl");

  const md = readFileSync(DOC_MD_PATH, "utf8");
  const doc = JSON.parse(readFileSync(DOC_JSON_PATH, "utf8")) as {
    document_id?: string;
    document_role?: string;
    status?: string;
    state_source?: string;
    current?: { account_email?: string; google_account_id?: string; credential_ref?: string; write_enabled?: boolean; environment?: string; production_ready?: boolean };
    connection_family?: { google_connection_id?: string; credential_ref?: string };
    boundary_statuses?: Record<string, string>;
    auth?: { begin?: string; callback?: string };
    next_required_connection?: string;
  };

  const rec = latestRecordFromJsonl(authStorePath, GOOGLE_CONNECTION_ID);
  const clientCfg = latestRecordFromJsonl(clientConfigPath);
  const projection = projectGoogleWorkspaceConnectionStatus();
  const { summaries } = loadConnectionSummaries();
  const uiRow = summaries.find((s) => s.connection_id === GOOGLE_CONNECTION_ID);

  ok("runtime record exists", rec !== null);
  ok("runtime state = CONNECTED", rec?.state === "CONNECTED");
  ok("current account = dnaos.tech@gmail.com", rec?.account_email === "dnaos.tech@gmail.com");
  ok("google_account_id matches", rec?.google_account_id === "100151411141238003583");
  ok("credential ref matches source", rec?.credential_ref === GOOGLE_CREDENTIAL_REF);

  ok("connection-document role is DOCUMENTATION_PROJECTION", doc.document_role === CONNECTION_DOCUMENT_ROLE);
  ok("doc.document_id matches contract", doc.document_id === GOOGLE_CONNECTION_ID);
  ok("doc.connection_family ids match", doc.connection_family?.google_connection_id === GOOGLE_CONNECTION_ID && doc.connection_family?.credential_ref === GOOGLE_CREDENTIAL_REF);
  ok("doc.status matches runtime CONNECTED", doc.status === "CONNECTED" && rec?.state === "CONNECTED");
  ok("doc.current.account matches runtime", doc.current?.account_email === rec?.account_email);
  ok("doc.state_source points at authorizations.jsonl", typeof doc.state_source === "string" && doc.state_source.endsWith("authorizations.jsonl"));
  ok("doc write=false environment=TESTING production not ready", doc.current?.write_enabled === false && doc.current?.environment === "TESTING" && doc.current?.production_ready === false);
  ok("doc next = PRODUCTION_READINESS", doc.next_required_connection === "PRODUCTION_READINESS");
  ok("doc routes match source", doc.auth?.begin === `POST ${GOOGLE_OAUTH_BEGIN_PATH}` && (doc.auth?.callback === `GET ${GOOGLE_OAUTH_CALLBACK_PATH}` || doc.auth?.callback === `GET  ${GOOGLE_OAUTH_CALLBACK_PATH}`));

  ok("md CONNECTION field", field(md, "CONNECTION") === GOOGLE_CONNECTION_ID);
  ok("md ACCOUNT field", field(md, "ACCOUNT") === "dnaos.tech@gmail.com");
  ok("md STATE field", field(md, "STATE") === "CONNECTED");
  ok("md WRITE field", field(md, "WRITE") === "false");
  ok("md ENVIRONMENT field", field(md, "ENVIRONMENT") === "TESTING");
  ok("md PRODUCTION field", field(md, "PRODUCTION") === "NOT_READY");
  ok("md CREDENTIAL field", field(md, "CREDENTIAL") === GOOGLE_CREDENTIAL_REF);
  ok("previous account not current in md ACCOUNT", !/^ACCOUNT\ndnaos\.tech@gmail\.com$/m.test(md) ? false : !md.includes("ACCOUNT\nt23598788@gmail.com"));
  ok("md documents AUTH routes", md.includes(`POST ${GOOGLE_OAUTH_BEGIN_PATH}`) && md.includes(`GET  ${GOOGLE_OAUTH_CALLBACK_PATH}`));
  ok("md documents IMPLEMENTATION paths", md.includes("google-oauth.ts") && md.includes("lifecycle.ts") && md.includes("google-oauth-routes.ts"));

  ok("WRITE_ENABLED contract false", WRITE_ENABLED === false);
  ok("client config environment TESTING", clientCfg?.environment === "TESTING");

  const granted = new Set<string>(Array.isArray(rec?.granted_scope) ? (rec!.granted_scope as string[]) : []);
  ok(
    "granted scopes match contract (email ≡ userinfo.email)",
    (() => {
      const hasOpenId = granted.has("openid");
      const hasEmail = granted.has("email") || granted.has("https://www.googleapis.com/auth/userinfo.email");
      return hasOpenId && hasEmail
        && granted.has("https://www.googleapis.com/auth/gmail.readonly")
        && granted.has("https://www.googleapis.com/auth/calendar.calendarlist.readonly")
        && granted.has("https://www.googleapis.com/auth/calendar.events.readonly")
        && granted.has("https://www.googleapis.com/auth/drive.readonly")
        && granted.has("https://www.googleapis.com/auth/spreadsheets.readonly");
    })(),
  );
  ok("no freebusy / write scopes in authorize set", !GOOGLE_AUTHORIZE_SCOPES.some((s) => /freebusy|gmail\.send|gmail\.compose|\/drive$|\/calendar$|\/spreadsheets$/.test(s)));

  ok("runtime projection state CONNECTED", projection.state === "CONNECTED");
  ok("runtime projection account", projection.account_email === "dnaos.tech@gmail.com");
  ok("projection capabilities all CONNECTED", projection.capabilities.gmail === "CONNECTED" && projection.capabilities.calendar === "CONNECTED" && projection.capabilities.drive === "CONNECTED" && projection.capabilities.sheets === "CONNECTED");

  ok("UI summary row exists", uiRow !== undefined);
  ok("UI projection status CONNECTED", uiRow?.status === "CONNECTED");
  ok(
    "runtime CONNECTED cannot render NOT_CONNECTED",
    assertRuntimeCannotRenderNotConnected(String(rec?.state), String(uiRow?.status)).ok
      && uiRow?.status === "CONNECTED",
  );

  const tokenShapes =
    /ya29\./i.test(md)
    || /\baccess[_-]?token\b/i.test(md)
    || /\brefresh[_-]?token\b/i.test(md)
    || /authorization\s*code\b/i.test(md);
  ok("no token/secret patterns in docs", !tokenShapes);
  ok("exactly one CONNECTION block", (md.match(/^CONNECTION$/gm) || []).length === 1);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
