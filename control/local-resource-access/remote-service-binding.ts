/**
 * REMOTE_SERVICE_CAPABILITY_BINDING_V1.
 * Binds only real connections/adapters. Google families stay CONTRACT_ONLY when unconnected.
 * Never stores credential values.
 */

import { listConnections } from "../../connections/connection-registry/contract";
import { findApiCredential } from "../../credentials/registry/api-credential-registry";
import { CREDENTIAL_REF as SCHEMA_READ_REF } from "../../connections/supabase-schema-read/contract";
import { atoms } from "./capability-states";
import { matchingCapabilityBindingPolicy } from "./owner-capability-policy";
import type {
  BindableActionId,
  CapabilityAtomState,
  EverydayActionId,
  RemoteServiceCapabilityBindingV1,
} from "./types";

const GH_REF = "credential://github/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/source-authority";

function enabled(session_id: string | null, ai_identity: string | null, binding_id: string): boolean {
  if (!session_id || !ai_identity) return false;
  const policy = matchingCapabilityBindingPolicy(ai_identity, session_id);
  if (!policy) return false;
  return policy.enabled_binding_ids.includes(binding_id) || policy.enabled_binding_ids.includes("*");
}

function map(action: BindableActionId, canonical: EverydayActionId | null, states: CapabilityAtomState) {
  return { action, canonical, states };
}

function githubConnection(): { connection_id: string; account: string; credential_ref: string | null; status: string } | null {
  const rows = listConnections().filter((row) => row.adapter === "github");
  const connected = [...rows].reverse().find((row) => row.status === "connected") ?? rows[rows.length - 1];
  if (!connected) return null;
  const ref = connected.credential_ref.kind === "keychain_ref" ? connected.credential_ref.ref
    : connected.credential_ref.kind === "env_var" ? `env:${connected.credential_ref.name}` : null;
  return { connection_id: connected.connection_id, account: connected.account_id, credential_ref: ref, status: connected.status };
}

function googleBinding(service_id: string, provider: string, actions: readonly BindableActionId[], owner_enabled: boolean): RemoteServiceCapabilityBindingV1 {
  return {
    schema: "REMOTE_SERVICE_CAPABILITY_BINDING_V1",
    service_id,
    provider,
    connection_id: null,
    account_identity_non_secret: null,
    credential_ref: null,
    availability: "NOT_AVAILABLE",
    capabilities: actions,
    canonical_action_mapping: actions.map((action) => map(action, (action === "CREATE_DRAFT" || action === "SEND" || action === "DOWNLOAD_ATTACHMENT") ? (action === "SEND" ? "SHARE" : action === "CREATE_DRAFT" ? "CREATE" : "DOWNLOAD") : action as EverydayActionId, atoms(true, false, false, false, owner_enabled))),
    data_classes: ["REMOTE_OBJECT"],
    network_destinations: ["https://www.googleapis.com"],
    owner_authority_state: "DENY",
    read_scope: [],
    write_scope: [],
    publish_scope: [],
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
  };
}

export function listRemoteServiceBindings(ai_identity: string | null = null, session_id: string | null = null): readonly RemoteServiceCapabilityBindingV1[] {
  const ghEnabled = enabled(session_id, ai_identity, "service://github/source-authority");
  const gh = githubConnection();
  const ghRef = gh?.credential_ref ?? (findApiCredential(GH_REF) ? GH_REF : null);
  const ghAuth = Boolean(ghRef && findApiCredential(ghRef)?.status === "ACTIVE");
  const github: RemoteServiceCapabilityBindingV1 = {
    schema: "REMOTE_SERVICE_CAPABILITY_BINDING_V1",
    service_id: "service://github/source-authority",
    provider: "github",
    connection_id: gh?.connection_id ?? null,
    account_identity_non_secret: gh?.account ?? null,
    credential_ref: ghRef,
    availability: ghRef ? "BOUND" : "DISCOVERED",
    capabilities: ["SEARCH", "READ", "CREATE", "WRITE", "DOWNLOAD", "UPLOAD", "COMMIT", "PUSH", "PULL_REQUEST", "ISSUE"],
    canonical_action_mapping: [
      map("SEARCH", "SEARCH", atoms(true, false, ghAuth, false, ghEnabled)),
      map("READ", "READ", atoms(true, true, ghAuth, false, ghEnabled)),
      map("CREATE", "CREATE", atoms(true, false, ghAuth, false, ghEnabled)),
      map("WRITE", "WRITE", atoms(true, false, ghAuth, false, ghEnabled)),
      map("DOWNLOAD", "DOWNLOAD", atoms(true, false, ghAuth, false, ghEnabled)),
      map("UPLOAD", "UPLOAD", atoms(true, false, ghAuth, false, ghEnabled)),
      map("COMMIT", null, atoms(true, false, ghAuth, false, ghEnabled)),
      map("PUSH", null, atoms(true, false, ghAuth, false, ghEnabled)),
      map("PULL_REQUEST", null, atoms(true, false, ghAuth, false, ghEnabled)),
      map("ISSUE", null, atoms(true, false, ghAuth, false, ghEnabled)),
    ],
    data_classes: ["REMOTE_OBJECT", "TEXT"],
    network_destinations: ["https://api.github.com"],
    owner_authority_state: ghEnabled ? "ALLOW" : "DENY",
    read_scope: gh?.connection_id ? [gh.connection_id] : [],
    write_scope: [],
    publish_scope: [],
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
  };

  const sbEnabled = enabled(session_id, ai_identity, "service://database/schema-read");
  const sbEntry = findApiCredential(SCHEMA_READ_REF);
  const sbAuth = sbEntry?.status === "ACTIVE";
  const schema: RemoteServiceCapabilityBindingV1 = {
    schema: "REMOTE_SERVICE_CAPABILITY_BINDING_V1",
    service_id: "service://database/schema-read",
    provider: "database-schema",
    connection_id: "connection.supabase.dna-os-project.v1",
    account_identity_non_secret: sbEntry?.account ?? null,
    credential_ref: SCHEMA_READ_REF,
    availability: sbAuth ? "BOUND" : "DISCOVERED",
    capabilities: ["SEARCH", "READ", "CREATE", "WRITE", "DELETE", "EXPORT", "SCHEMA_READ"],
    canonical_action_mapping: [
      map("SEARCH", "SEARCH", atoms(true, false, sbAuth, false, sbEnabled)),
      map("READ", "READ", atoms(true, false, sbAuth, false, sbEnabled)),
      map("CREATE", "CREATE", atoms(true, false, sbAuth, false, false)),
      map("WRITE", "WRITE", atoms(true, false, sbAuth, false, false)),
      map("DELETE", "DELETE", atoms(true, false, sbAuth, false, false)),
      map("EXPORT", "EXPORT", atoms(true, false, sbAuth, false, sbEnabled)),
      map("SCHEMA_READ", null, atoms(true, true, sbAuth, false, sbEnabled)),
    ],
    data_classes: ["STRUCTURED_DATA"],
    network_destinations: ["https://api.supabase.com"],
    owner_authority_state: sbEnabled ? "ALLOW" : "DENY",
    read_scope: ["information_schema", "pg_catalog"],
    write_scope: [],
    publish_scope: [],
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
  };

  return [
    github,
    googleBinding("service://google/drive", "google_drive", ["SEARCH", "READ", "CREATE", "WRITE", "MOVE", "DOWNLOAD", "UPLOAD", "SHARE"], enabled(session_id, ai_identity, "service://google/drive")),
    googleBinding("service://google/gmail", "gmail", ["SEARCH", "READ", "CREATE_DRAFT", "SEND", "DOWNLOAD_ATTACHMENT"], enabled(session_id, ai_identity, "service://google/gmail")),
    googleBinding("service://google/calendar", "google_calendar", ["SEARCH", "READ", "CREATE", "WRITE", "DELETE"], enabled(session_id, ai_identity, "service://google/calendar")),
    googleBinding("service://google/contacts", "google_contacts", ["SEARCH", "READ"], enabled(session_id, ai_identity, "service://google/contacts")),
    schema,
  ];
}

export function getRemoteServiceBinding(service_id: string, ai_identity: string | null = null, session_id: string | null = null): RemoteServiceCapabilityBindingV1 | null {
  return listRemoteServiceBindings(ai_identity, session_id).find((row) => row.service_id === service_id) ?? null;
}

export function publicRemoteServiceView(row: RemoteServiceCapabilityBindingV1): Record<string, unknown> {
  return {
    schema: row.schema,
    service_id: row.service_id,
    provider: row.provider,
    connection_id: row.connection_id,
    account_identity_non_secret: row.account_identity_non_secret,
    credential_ref: row.credential_ref,
    availability: row.availability,
    capabilities: row.capabilities,
    canonical_action_mapping: row.canonical_action_mapping,
    data_classes: row.data_classes,
    network_destinations: row.network_destinations,
    owner_authority_state: row.owner_authority_state,
    read_scope: row.read_scope,
    write_scope: row.write_scope,
    publish_scope: row.publish_scope,
    evidence_policy: row.evidence_policy,
  };
}
