/**
 * OWNER_SEARCH_V1 — one field, local-first, no corpus upload to external AI.
 */

import { decideOwnerComputeFirst } from "../owner-client-runtime/contract";
import { invokeLocalCapability } from "../local-resource-access/contract";
import { emailWorkSurface } from "./pack";
import { utf8Bytes } from "./host-runtime";
import type { OwnerSearchHitV1, OwnerSearchV1 } from "./types";

const HIDDEN = /\/Users\/|\/home\/|keychain:\/\/|ghp_|sk-|password|secret/i;

function hitsFromMatches(resource_id: string, source: string, type: string, matches: unknown, evidence: string | null): OwnerSearchHitV1[] {
  const rows = Array.isArray(matches) ? matches as Record<string, unknown>[] : [];
  return rows.slice(0, 8).map((row) => ({
    resource_id,
    source,
    type,
    title: String(row.logical_ref ?? row.title ?? resource_id),
    metadata: { line: row.line ?? null },
    match: String(row.snippet ?? row.logical_ref ?? "").slice(0, 160),
    authority_state: "ALLOW",
    available_actions: ["READ", "SEARCH"],
    evidence_ref: evidence,
  }));
}

export async function ownerSearch(input: {
  readonly query: string;
  readonly ai_client_id: string;
  readonly session_id: string;
  readonly work_id: string;
}): Promise<OwnerSearchV1> {
  const route = decideOwnerComputeFirst({
    capability: "local.files.search",
    resource_id: "resource://local/files/fixture-corpus",
    bytes_proposed: utf8Bytes(input.query),
    ai_identity: input.ai_client_id,
    session_id: input.session_id,
    work_id: input.work_id,
  });
  void route.selected;
  const query = input.query.replace(/[^A-Za-z0-9._ -]/g, " ").trim().slice(0, 80) || "marker";
  const files = await invokeLocalCapability({
    ai_client_id: input.ai_client_id,
    session_id: input.session_id,
    work_id: input.work_id,
    capability: "local.files.search",
    resource_id: "resource://local/files/fixture-corpus",
    input: { query: input.query, max_matches: 8 },
  });
  const git = await invokeLocalCapability({
    ai_client_id: input.ai_client_id,
    session_id: input.session_id,
    work_id: input.work_id,
    capability: "local.git.search",
    resource_id: "resource://local/git/fixture-corpus",
    input: { query },
  });
  const extract = await invokeLocalCapability({
    ai_client_id: input.ai_client_id,
    session_id: input.session_id,
    work_id: input.work_id,
    capability: "local.document.extract_text",
    resource_id: "resource://local/files/fixture-corpus",
    input: { logical_path: "sample.pdf" },
  });
  const hits: OwnerSearchHitV1[] = [];
  if (files.ok) hits.push(...hitsFromMatches("resource://local/files/fixture-corpus", "local.files", "FILE", files.result.matches, files.envelope.execution_id));
  if (git.ok) hits.push(...hitsFromMatches("resource://local/git/fixture-corpus", "local.git", "GIT", git.result.items ?? git.result.matches, git.envelope.execution_id));
  if (extract.ok) {
    const text = String(extract.result.extracted_text ?? "");
    if (text.toLowerCase().includes(input.query.toLowerCase()) || input.query.length === 0) {
      hits.push({
        resource_id: "resource://local/files/fixture-corpus",
        source: "local.pdf",
        type: "PDF",
        title: "sample.pdf",
        metadata: { extracted_chars: extract.result.extracted_chars ?? 0 },
        match: text.slice(0, 160),
        authority_state: "ALLOW",
        available_actions: ["READ", "EXTRACT"],
        evidence_ref: extract.envelope.execution_id,
      });
    }
  }
  const email = emailWorkSurface(input.ai_client_id, input.session_id);
  if (email.runtime_binding === "NOT_AVAILABLE") {
    hits.push({
      resource_id: "service://google/gmail",
      source: "email",
      type: "EMAIL",
      title: "Gmail",
      metadata: { runtime_binding: "NOT_AVAILABLE" },
      match: "",
      authority_state: "DENY",
      available_actions: [],
      evidence_ref: null,
    });
  }
  hits.push({
    resource_id: "service://google/calendar",
    source: "calendar",
    type: "CALENDAR",
    title: "Google Calendar",
    metadata: { runtime_binding: "NOT_AVAILABLE" },
    match: "",
    authority_state: "DENY",
    available_actions: [],
    evidence_ref: null,
  });
  hits.push({
    resource_id: "service://google/contacts",
    source: "contacts",
    type: "CONTACTS",
    title: "Google Contacts",
    metadata: { runtime_binding: "NOT_AVAILABLE" },
    match: "",
    authority_state: "DENY",
    available_actions: [],
    evidence_ref: null,
  });
  hits.push({
    resource_id: "service://database/schema-read",
    source: "database",
    type: "DATABASE",
    title: "schema metadata",
    metadata: { write_enabled: false, runtime_verified: false },
    match: "",
    authority_state: "DENY",
    available_actions: ["SCHEMA_READ"],
    evidence_ref: null,
  });
  const blob = JSON.stringify(hits);
  if (HIDDEN.test(blob)) {
    return {
      schema: "OWNER_SEARCH_V1",
      query: input.query,
      local_search_first: true,
      local_source_uploaded: false,
      hits: [],
      SOURCE_BYTES: 0,
      LOCAL_BYTES_PROCESSED: 0,
      EXTERNAL_AI_BYTES_SENT: 0,
      RESULT_BYTES_RETURNED: 0,
    };
  }
  const source = Number(files.egress.bytes_proposed ?? 0) + Number(git.ok ? git.egress.bytes_proposed : 0) + Number(extract.ok ? extract.egress.bytes_proposed : 0);
  const sent = Number(files.egress.bytes_actually_sent ?? 0);
  return {
    schema: "OWNER_SEARCH_V1",
    query: input.query,
    local_search_first: true,
    local_source_uploaded: false,
    hits,
    SOURCE_BYTES: source,
    LOCAL_BYTES_PROCESSED: source,
    EXTERNAL_AI_BYTES_SENT: sent,
    RESULT_BYTES_RETURNED: utf8Bytes(hits.map((row) => ({ title: row.title, match: row.match }))),
  };
}
