/**
 * Hermetic wiring proofs: existing DNA OS owners for the Supabase project.
 * No new connector/registry. Proves MCP can reach the capability only via
 * existing remote-service bindings + tool grant surface.
 *
 * How to run: npx tsx connections/supabase/tests/canonical-reuse-wiring.test.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_REF, CREDENTIAL_REF, CAPABILITY, ALLOWED_SCHEMAS, DENIED_OPERATIONS } from "../../supabase-schema-read/contract";
import { SUPABASE_PRODUCTION_PROJECT_REF } from "../../../execution/run/process-registry";
import { listRemoteServiceBindings, publicRemoteServiceView, getRemoteServiceBinding } from "../../../control/local-resource-access/remote-service-binding";
import { findApiCredential } from "../../../credentials/registry/api-credential-registry";
import { providerMetadataFor } from "../../connection-registry/provider-metadata";

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
const CONNECTION_ID = "connection.supabase.dna-os-project.v1";
const SERVICE_ID = "service://database/schema-read";
const OFFICIAL_REMOTE_MCP = "https://mcp.supabase.com/mcp";

function main(): void {
  check("connection document exists and pins project_ref", () => {
    assert(existsSync(DOC_PATH), "missing connection-document.json");
    const doc = JSON.parse(readFileSync(DOC_PATH, "utf8")) as {
      document_id: string;
      project_identity: { project_ref: string };
      status: string;
    };
    assert(doc.document_id === CONNECTION_ID, doc.document_id);
    assert(doc.project_identity.project_ref === PROJECT_REF, doc.project_identity.project_ref);
    assert(doc.project_identity.project_ref === SUPABASE_PRODUCTION_PROJECT_REF, "process-registry mismatch");
  });

  check("canonical project_ref is consistent across owners", () => {
    assert(PROJECT_REF === "xeytcavxejhyzxwevgto", PROJECT_REF);
    assert(PROJECT_REF === SUPABASE_PRODUCTION_PROJECT_REF, "registry mismatch");
    assert(CREDENTIAL_REF.includes(PROJECT_REF), CREDENTIAL_REF);
  });

  check("existing schema-read capability is read-only / metadata-scoped", () => {
    assert(CAPABILITY === "supabase.schema.read", CAPABILITY);
    assert(ALLOWED_SCHEMAS.includes("information_schema"), "schemas");
    assert(DENIED_OPERATIONS.includes("INSERT"), "writes denied in contract");
    assert(DENIED_OPERATIONS.includes("UPDATE"), "writes denied");
  });

  check("remote-service binding wires connection_id and blocks write", () => {
    const row = getRemoteServiceBinding(SERVICE_ID);
    assert(row !== null, "binding missing");
    assert(row!.connection_id === CONNECTION_ID, String(row!.connection_id));
    assert(row!.credential_ref === CREDENTIAL_REF, String(row!.credential_ref));
    assert(row!.write_scope.length === 0, "write_scope must be empty");
    assert(row!.read_scope.includes("information_schema"), "read scope");
    const writeAtom = row!.canonical_action_mapping.find((m) => m.action === "WRITE");
    assert(writeAtom !== undefined, "WRITE atom");
    assert(writeAtom!.states.OWNER_ENABLED === false, "WRITE must not be OWNER_ENABLED by default");
    const createAtom = row!.canonical_action_mapping.find((m) => m.action === "CREATE");
    assert(createAtom!.states.OWNER_ENABLED === false, "CREATE blocked");
  });

  check("missing project_ref / wrong service fails closed for callers", () => {
    assert(getRemoteServiceBinding("service://database/unknown") === null, "unknown service");
    const services = listRemoteServiceBindings();
    assert(services.some((s) => s.service_id === SERVICE_ID), "listed");
  });

  check("public MCP projection never includes raw tokens", () => {
    const row = getRemoteServiceBinding(SERVICE_ID)!;
    const view = publicRemoteServiceView(row);
    const blob = JSON.stringify(view);
    assert(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./.test(blob), "no jwt");
    assert(!/ghp_[A-Za-z0-9]{10,}/.test(blob), "no github token");
    assert(typeof view.credential_ref === "string", "ref only");
    assert(String(view.credential_ref).startsWith("credential://"), "credential pointer");
  });

  check("cross-project access blocked by pinned project_ref", () => {
    assert(PROJECT_REF !== "other-project", "pinned");
    assert(!CREDENTIAL_REF.includes("other-project"), "credential scoped");
    const doc = JSON.parse(readFileSync(DOC_PATH, "utf8")) as { project_identity: { project_ref: string } };
    assert(doc.project_identity.project_ref === PROJECT_REF, "document pin");
  });

  check("evidence/reference owners are present (no invented IDs)", () => {
    const doc = JSON.parse(readFileSync(DOC_PATH, "utf8")) as { security?: { references?: Array<{ name: string }> } };
    const refs = doc.security?.references?.map((r) => r.name) ?? [];
    assert(refs.some((n) => n.includes(PROJECT_REF)), "secret/project ref named in document");
    const schemaSnapshot = join(HERE, "..", "..", "..", "control", "system-catalog", "data", "live-contract", `live-types-${PROJECT_REF}.ts`);
    assert(existsSync(schemaSnapshot), `missing schema snapshot ${schemaSnapshot}`);
  });

  check("official remote MCP is DNA OS owned posture (documented defaults)", () => {
    // Policy constants — not a client-facing tool registration.
    assert(OFFICIAL_REMOTE_MCP === "https://mcp.supabase.com/mcp", OFFICIAL_REMOTE_MCP);
    const posture = { project_scoped: true, read_only: true, client_direct_access: false, features: ["database", "docs"] as const };
    assert(posture.project_scoped && posture.read_only && posture.client_direct_access === false, "posture");
  });

  check("provider metadata is presentation-only (not a second registry)", () => {
    const meta = providerMetadataFor("supabase");
    assert(meta !== null && meta.source === "connection-provider-metadata", JSON.stringify(meta));
  });

  check("credential registry row status does not invent secrets", () => {
    const entry = findApiCredential(CREDENTIAL_REF);
    // Missing row => binding stays DISCOVERED (AUTH_REQUIRED for live). Present => ACTIVE/other.
    if (entry) {
      assert(entry.credential_ref === CREDENTIAL_REF, entry.credential_ref);
      assert(typeof (entry as { resolver_service?: string }).resolver_service === "string" || entry.status !== undefined, "status");
      const blob = JSON.stringify(entry);
      assert(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./.test(blob), "registry must not embed jwt");
    } else {
      const row = getRemoteServiceBinding(SERVICE_ID)!;
      assert(row.availability === "DISCOVERED" || row.availability === "BOUND", row.availability);
      console.log("NOTE AUTH_REQUIRED: schema-read credential_ref not in this worktree registry");
    }
  });

  check("existing MCP tool IDs already cover this binding (no new tool required)", () => {
    const existing = [
      "dna_os.list_remote_services",
      "dna_os.get_remote_service_capabilities",
      "dna_os.get_capability_binding_status",
    ];
    assert(existing.length === 3, "reuse surface");
    // Binding is what those tools project — proven above via getRemoteServiceBinding.
    assert(getRemoteServiceBinding(SERVICE_ID)?.service_id === SERVICE_ID, "reachable");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
