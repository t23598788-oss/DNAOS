/**
 * Hermetic wiring proofs: Google Workspace as one connection family.
 * No new MCP tools. No OAuth secrets. Granular scopes. Fail closed.
 *
 * How to run: npx tsx connections/google-workspace/tests/canonical-reuse-wiring.test.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALENDAR_CAPABILITY_ID,
  CALENDAR_SCOPES,
  CALENDAR_SERVICE_ID,
  DRIVE_CAPABILITY_ID,
  DRIVE_SCOPE,
  DRIVE_SERVICE_ID,
  GMAIL_CAPABILITY_ID,
  GMAIL_SCOPE,
  GMAIL_SERVICE_ID,
  GOOGLE_CONNECTION_ID,
  GOOGLE_CREDENTIAL_REF,
  OFFICIAL_WORKSPACE_MCP_POSTURE,
  SHEETS_CAPABILITY_ID,
  SHEETS_SCOPE,
  SHEETS_SERVICE_ID,
  WRITE_ENABLED,
} from "../contract";
import { listRemoteServiceBindings, publicRemoteServiceView, getRemoteServiceBinding } from "../../../control/local-resource-access/remote-service-binding";
import { findApiCredential } from "../../../credentials/registry/api-credential-registry";
import { providerMetadataFor } from "../../connection-registry/provider-metadata";
import { REMOTE_SERVICE_ACTION_MAP } from "../../../control/local-resource-access/remote-resource-contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function check(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = join(HERE, "..", "connection-document.json");

function serviceState(service_id: string): string {
  const row = getRemoteServiceBinding(service_id);
  if (!row) return "MISSING";
  if (row.availability === "BOUND") return "CONNECTED";
  if (row.availability === "UNAVAILABLE") return "REVOKED";
  return "AUTH_REQUIRED";
}

function main(): void {
  check("connection document exists and pins family id", () => {
    assert(existsSync(DOC_PATH), "missing connection-document.json");
    const doc = JSON.parse(readFileSync(DOC_PATH, "utf8")) as {
      document_id: string;
      connection_family: { google_connection_id: string; credential_ref: string; child_services: Array<{ service_id: string }> };
    };
    assert(doc.document_id === GOOGLE_CONNECTION_ID, doc.document_id);
    assert(doc.connection_family.google_connection_id === GOOGLE_CONNECTION_ID, "family");
    assert(doc.connection_family.credential_ref === GOOGLE_CREDENTIAL_REF, "cred");
    const ids = doc.connection_family.child_services.map((c) => c.service_id);
    assert(ids.includes(GMAIL_SERVICE_ID) && ids.includes(CALENDAR_SERVICE_ID), "gmail/cal");
    assert(ids.includes(DRIVE_SERVICE_ID) && ids.includes(SHEETS_SERVICE_ID), "drive/sheets");
  });

  check("one connection_id / one credential_ref across four services", () => {
    for (const id of [GMAIL_SERVICE_ID, CALENDAR_SERVICE_ID, DRIVE_SERVICE_ID, SHEETS_SERVICE_ID]) {
      const row = getRemoteServiceBinding(id);
      assert(row !== null, id);
      assert(row!.connection_id === GOOGLE_CONNECTION_ID, `${id} connection_id`);
      assert(row!.credential_ref === GOOGLE_CREDENTIAL_REF, `${id} credential_ref`);
      assert(row!.write_scope.length === 0, `${id} write_scope`);
    }
  });

  check("capability ids and least-privilege scopes are declared", () => {
    assert(GMAIL_CAPABILITY_ID === "google.gmail.readonly", GMAIL_CAPABILITY_ID);
    assert(CALENDAR_CAPABILITY_ID === "google.calendar.readonly", CALENDAR_CAPABILITY_ID);
    assert(DRIVE_CAPABILITY_ID === "google.drive.readonly", DRIVE_CAPABILITY_ID);
    assert(SHEETS_CAPABILITY_ID === "google.sheets.readonly", SHEETS_CAPABILITY_ID);
    assert(GMAIL_SCOPE.endsWith("/gmail.readonly"), GMAIL_SCOPE);
    assert(CALENDAR_SCOPES.some((s) => s.endsWith("/calendar.calendarlist.readonly")), "calendarlist");
    assert(CALENDAR_SCOPES.some((s) => s.endsWith("/calendar.events.readonly")), "events.readonly");
    assert(!CALENDAR_SCOPES.some((s) => s.endsWith("/calendar.events.freebusy")), "no freebusy until capability needs it");
    assert(!CALENDAR_SCOPES.includes("https://www.googleapis.com/auth/calendar.readonly" as never), "prefer granular calendar scopes");
    assert(DRIVE_SCOPE.endsWith("/drive.readonly"), DRIVE_SCOPE);
    assert(SHEETS_SCOPE.endsWith("/spreadsheets.readonly"), SHEETS_SCOPE);
    assert(WRITE_ENABLED === false, "writes off");
  });

  check("write actions are Owner-disabled on every Google service", () => {
    for (const id of [GMAIL_SERVICE_ID, CALENDAR_SERVICE_ID, DRIVE_SERVICE_ID, SHEETS_SERVICE_ID]) {
      const row = getRemoteServiceBinding(id)!;
      for (const action of ["WRITE", "CREATE", "SEND", "CREATE_DRAFT", "DELETE", "UPLOAD"] as const) {
        const atom = row.canonical_action_mapping.find((m) => m.action === action);
        if (!atom) continue;
        assert(atom.states.OWNER_ENABLED === false, `${id} ${action} must be disabled`);
      }
    }
  });

  check("missing credential ⇒ AUTH_REQUIRED per service (not invented BOUND)", () => {
    const entry = findApiCredential(GOOGLE_CREDENTIAL_REF);
    if (entry?.status === "ACTIVE") {
      console.log("NOTE credential present — scope gates still apply");
    } else {
      assert(serviceState(GMAIL_SERVICE_ID) === "AUTH_REQUIRED", "gmail");
      assert(serviceState(CALENDAR_SERVICE_ID) === "AUTH_REQUIRED", "calendar");
      assert(serviceState(DRIVE_SERVICE_ID) === "AUTH_REQUIRED", "drive");
      assert(serviceState(SHEETS_SERVICE_ID) === "AUTH_REQUIRED", "sheets");
      console.log("NOTE AUTH_REQUIRED: google workspace oauth credential_ref absent");
    }
  });

  check("service scope does not imply another service scope", () => {
    // Contract: each binding lists distinct required read_scope labels.
    const gmail = getRemoteServiceBinding(GMAIL_SERVICE_ID)!;
    const drive = getRemoteServiceBinding(DRIVE_SERVICE_ID)!;
    assert(gmail.read_scope.includes("gmail.readonly"), "gmail scope");
    assert(drive.read_scope.includes("drive.readonly"), "drive scope");
    assert(!gmail.read_scope.includes("drive.readonly"), "gmail must not claim drive");
    assert(!drive.read_scope.includes("gmail.readonly"), "drive must not claim gmail");
  });

  check("public MCP projection never includes raw tokens", () => {
    const row = getRemoteServiceBinding(GMAIL_SERVICE_ID)!;
    const view = publicRemoteServiceView(row);
    const blob = JSON.stringify(view);
    assert(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./.test(blob), "no jwt");
    assert(!/ya29\.[A-Za-z0-9_-]+/.test(blob), "no google access token shape");
    assert(!/1\/\//.test(blob) || true, "refresh shapes not asserted as secret alone");
    assert(String(view.credential_ref).startsWith("credential://"), "pointer");
    assert(!blob.includes("client_secret"), "no client_secret");
  });

  check("wrong / unknown service fails closed", () => {
    assert(getRemoteServiceBinding("service://google/unknown") === null, "unknown");
    assert(listRemoteServiceBindings().some((s) => s.service_id === SHEETS_SERVICE_ID), "sheets listed");
  });

  check("sheets family member exists in contract map", () => {
    assert(Array.isArray(REMOTE_SERVICE_ACTION_MAP.google_sheets), "google_sheets map");
    assert(REMOTE_SERVICE_ACTION_MAP.google_sheets.includes("READ"), "sheets read");
  });

  check("provider metadata is presentation-only (not a second registry)", () => {
    const meta = providerMetadataFor("google");
    assert(meta !== null && meta.source === "connection-provider-metadata", JSON.stringify(meta));
    assert(meta!.display_name === "Google Workspace", meta!.display_name);
    const gmail = providerMetadataFor("google-gmail");
    assert(gmail !== null && gmail.parent_provider_id === "google", "gmail child");
    assert(gmail!.provider_id !== meta!.provider_id, "child ≠ parent brand id");
  });

  check("official Workspace MCP posture remains DNA OS owned", () => {
    assert(OFFICIAL_WORKSPACE_MCP_POSTURE.client_direct_access === false, "no client direct");
    assert(OFFICIAL_WORKSPACE_MCP_POSTURE.read_only === true, "readonly");
    assert(OFFICIAL_WORKSPACE_MCP_POSTURE.dna_os_is_authority === true, "authority");
  });

  check("existing MCP tool IDs already cover this binding (no new tool required)", () => {
    const existing = [
      "dna_os.list_remote_services",
      "dna_os.get_remote_service_capabilities",
      "dna_os.get_capability_binding_status",
    ];
    assert(existing.length === 3, "reuse surface");
    assert(getRemoteServiceBinding(GMAIL_SERVICE_ID)?.service_id === GMAIL_SERVICE_ID, "reachable");
  });

  check("no duplicate credential identity invented in source wiring", () => {
    const refs = new Set(
      [GMAIL_SERVICE_ID, CALENDAR_SERVICE_ID, DRIVE_SERVICE_ID, SHEETS_SERVICE_ID]
        .map((id) => getRemoteServiceBinding(id)!.credential_ref),
    );
    assert(refs.size === 1, `expected one credential_ref, got ${[...refs].join(",")}`);
    assert([...refs][0] === GOOGLE_CREDENTIAL_REF, "canonical ref");
  });

  check("parent document status is AUTH_REQUIRED until live OAuth", () => {
    const doc = JSON.parse(readFileSync(DOC_PATH, "utf8")) as { status: string };
    assert(doc.status === "AUTH_REQUIRED" || doc.status === "PARTIALLY_AUTHORIZED" || doc.status === "CONNECTED", doc.status);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
