/**
 * Google Workspace READ-ONLY runtime adapter.
 *
 * Order (fail-closed, never reversed):
 *   classify → owner capability policy → credential metadata/scope
 *   → credential resolve (Keychain + refresh if needed) → Google API
 *   → normalized result + evidence
 *
 * Owner denied / missing scope ⇒ zero Keychain reads and zero Google API calls.
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { CapabilityResultEvidence } from "../../contracts/command/capability-result";
import type { EventEnvelope } from "../../contracts/event/event-envelope";
import { evaluateOwnerCapabilityBinding } from "../../control/local-resource-access/owner-capability-policy";
import {
  CALENDAR_SCOPES,
  CALENDAR_SERVICE_ID,
  DRIVE_SCOPE,
  DRIVE_SERVICE_ID,
  GMAIL_SCOPE,
  GMAIL_SERVICE_ID,
  GOOGLE_CONNECTION_ID,
  GOOGLE_CREDENTIAL_REF,
  SHEETS_SCOPE,
  SHEETS_SERVICE_ID,
} from "./contract";
import {
  GOOGLE_WORKSPACE_ADAPTER_NAME,
  GOOGLE_WORKSPACE_INTENTS,
  GOOGLE_WORKSPACE_OUTCOMES,
  GOOGLE_WORKSPACE_WRITE_INTENTS,
  type GoogleWorkspaceAdapterOutcome,
  type GoogleWorkspaceDeniedStage,
  type GoogleWorkspaceNormalizedResult,
  type GoogleWorkspaceOutcomeCode,
  type GoogleWorkspaceReadIntent,
  type GoogleWorkspaceReadPayload,
  type GoogleWorkspaceRejection,
  type GoogleWorkspaceService,
  GOOGLE_WORKSPACE_EVENT_TYPES,
} from "./adapter-contract";
import {
  apiCallEvidence,
  credentialMetaEvidence,
  credentialResolvedEvidence,
  normalizedResultEvidence,
  outcomeEvidence,
  ownerPolicyEvidence,
  scopeCheckEvidence,
} from "./evidence";
import {
  createProductionCredentialResolver,
  hasRequiredScopes,
  readGoogleCredentialMetadata,
  type GoogleWorkspaceCredentialResolver,
} from "./credential-resolution";
import { MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE, macLocalAgentExecutionDecision } from "../../contracts/architecture/runtime-node-and-optional-provider";
import {
  calendarListCalendars,
  calendarListEvents,
  driveGetFileContent,
  driveGetFileMetadata,
  driveListFiles,
  gmailGetMessage,
  gmailListMessages,
  gmailSearchMessages,
  sheetsGetSpreadsheet,
  sheetsGetValues,
  type GoogleApiResult,
} from "./google-api";
import { hostFetch, hostNowIso, hostRandomId, type FetchImpl } from "./host-runtime";
import { resolveSheetsValuesInput } from "./sheets-input-resolution";
import { parseSheetsOwnerText } from "./sheets-owner-text";

export interface GoogleWorkspaceAdapterDeps {
  credentialResolver?: GoogleWorkspaceCredentialResolver;
  fetchImpl?: FetchImpl;
  evaluateOwnerPolicy?: typeof evaluateOwnerCapabilityBinding;
  readCredentialMeta?: typeof readGoogleCredentialMetadata;
}

interface IntentSpec {
  service: GoogleWorkspaceService;
  required_scopes: readonly string[];
  event_type: string;
  bindable_action: string;
}

const INTENT_SPECS: Record<GoogleWorkspaceReadIntent, IntentSpec> = {
  [GOOGLE_WORKSPACE_INTENTS.gmailSearch]: {
    service: GMAIL_SERVICE_ID,
    required_scopes: [GMAIL_SCOPE],
    event_type: GOOGLE_WORKSPACE_EVENT_TYPES.gmailSearch,
    bindable_action: "SEARCH",
  },
  [GOOGLE_WORKSPACE_INTENTS.gmailList]: {
    service: GMAIL_SERVICE_ID,
    required_scopes: [GMAIL_SCOPE],
    event_type: GOOGLE_WORKSPACE_EVENT_TYPES.gmailList,
    bindable_action: "READ",
  },
  [GOOGLE_WORKSPACE_INTENTS.gmailRead]: {
    service: GMAIL_SERVICE_ID,
    required_scopes: [GMAIL_SCOPE],
    event_type: GOOGLE_WORKSPACE_EVENT_TYPES.gmailRead,
    bindable_action: "READ",
  },
  [GOOGLE_WORKSPACE_INTENTS.calendarList]: {
    service: CALENDAR_SERVICE_ID,
    required_scopes: [...CALENDAR_SCOPES],
    event_type: GOOGLE_WORKSPACE_EVENT_TYPES.calendarList,
    bindable_action: "READ",
  },
  [GOOGLE_WORKSPACE_INTENTS.calendarEventsList]: {
    service: CALENDAR_SERVICE_ID,
    required_scopes: [...CALENDAR_SCOPES],
    event_type: GOOGLE_WORKSPACE_EVENT_TYPES.calendarEventsList,
    bindable_action: "READ",
  },
  [GOOGLE_WORKSPACE_INTENTS.driveSearch]: {
    service: DRIVE_SERVICE_ID,
    required_scopes: [DRIVE_SCOPE],
    event_type: GOOGLE_WORKSPACE_EVENT_TYPES.driveSearch,
    bindable_action: "SEARCH",
  },
  [GOOGLE_WORKSPACE_INTENTS.driveList]: {
    service: DRIVE_SERVICE_ID,
    required_scopes: [DRIVE_SCOPE],
    event_type: GOOGLE_WORKSPACE_EVENT_TYPES.driveList,
    bindable_action: "READ",
  },
  [GOOGLE_WORKSPACE_INTENTS.driveMetadata]: {
    service: DRIVE_SERVICE_ID,
    required_scopes: [DRIVE_SCOPE],
    event_type: GOOGLE_WORKSPACE_EVENT_TYPES.driveMetadata,
    bindable_action: "READ",
  },
  [GOOGLE_WORKSPACE_INTENTS.driveContent]: {
    service: DRIVE_SERVICE_ID,
    required_scopes: [DRIVE_SCOPE],
    event_type: GOOGLE_WORKSPACE_EVENT_TYPES.driveContent,
    bindable_action: "DOWNLOAD",
  },
  [GOOGLE_WORKSPACE_INTENTS.sheetsMetadata]: {
    service: SHEETS_SERVICE_ID,
    required_scopes: [SHEETS_SCOPE],
    event_type: GOOGLE_WORKSPACE_EVENT_TYPES.sheetsMetadata,
    bindable_action: "READ",
  },
  [GOOGLE_WORKSPACE_INTENTS.sheetsValues]: {
    service: SHEETS_SERVICE_ID,
    required_scopes: [SHEETS_SCOPE],
    event_type: GOOGLE_WORKSPACE_EVENT_TYPES.sheetsValues,
    bindable_action: "READ",
  },
};

function isReadIntent(intent: string): intent is GoogleWorkspaceReadIntent {
  return Object.values(GOOGLE_WORKSPACE_INTENTS).includes(intent as GoogleWorkspaceReadIntent);
}

function isWriteIntent(intent: string): boolean {
  return (GOOGLE_WORKSPACE_WRITE_INTENTS as readonly string[]).includes(intent)
    || /\.(send|create|update|delete|upload|move|share)$/.test(intent)
    || intent.includes(".drafts.")
    || intent.includes(".compose");
}

function asPayload(payload: unknown): GoogleWorkspaceReadPayload {
  if (!payload || typeof payload !== "object") return {};
  return payload as GoogleWorkspaceReadPayload;
}

function reject(
  outcome: Exclude<GoogleWorkspaceOutcomeCode, "SUCCESS">,
  reason: string,
  stage: GoogleWorkspaceDeniedStage,
  evidence: CapabilityResultEvidence[],
  clarification_candidates?: GoogleWorkspaceRejection["clarification_candidates"],
): GoogleWorkspaceAdapterOutcome {
  evidence.push(outcomeEvidence(outcome, reason));
  return {
    ok: false,
    rejection: {
      ok: false,
      outcome,
      reason,
      denied_at_stage: stage,
      ...(clarification_candidates && clarification_candidates.length > 0
        ? { clarification_candidates }
        : {}),
    },
    evidence,
  };
}

function countItems(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (Array.isArray(row.messages)) return row.messages.length;
  if (Array.isArray(row.items)) return row.items.length;
  if (Array.isArray(row.files)) return row.files.length;
  if (Array.isArray(row.events)) return row.events.length;
  if (Array.isArray(row.values)) return row.values.length;
  return null;
}

function normalizeProviderData(intent: GoogleWorkspaceReadIntent, data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const row = data as Record<string, unknown>;
  switch (intent) {
    case GOOGLE_WORKSPACE_INTENTS.gmailSearch:
    case GOOGLE_WORKSPACE_INTENTS.gmailList:
      return {
        messages: Array.isArray(row.messages)
          ? (row.messages as Array<Record<string, unknown>>).map((m) => ({
              id: typeof m.id === "string" ? m.id : null,
              threadId: typeof m.threadId === "string" ? m.threadId : null,
            }))
          : [],
        nextPageToken: typeof row.nextPageToken === "string" ? row.nextPageToken : null,
        resultSizeEstimate: typeof row.resultSizeEstimate === "number" ? row.resultSizeEstimate : null,
      };
    case GOOGLE_WORKSPACE_INTENTS.gmailRead:
      return {
        id: typeof row.id === "string" ? row.id : null,
        threadId: typeof row.threadId === "string" ? row.threadId : null,
        snippet: typeof row.snippet === "string" ? row.snippet : null,
        labelIds: Array.isArray(row.labelIds) ? row.labelIds : [],
        payload: row.payload ?? null,
        internalDate: typeof row.internalDate === "string" ? row.internalDate : null,
      };
    case GOOGLE_WORKSPACE_INTENTS.calendarList:
      return {
        items: Array.isArray(row.items)
          ? (row.items as Array<Record<string, unknown>>).map((c) => ({
              id: typeof c.id === "string" ? c.id : null,
              summary: typeof c.summary === "string" ? c.summary : null,
              primary: c.primary === true,
              accessRole: typeof c.accessRole === "string" ? c.accessRole : null,
            }))
          : [],
      };
    case GOOGLE_WORKSPACE_INTENTS.calendarEventsList:
      return {
        items: Array.isArray(row.items)
          ? (row.items as Array<Record<string, unknown>>).map((e) => ({
              id: typeof e.id === "string" ? e.id : null,
              summary: typeof e.summary === "string" ? e.summary : null,
              start: e.start ?? null,
              end: e.end ?? null,
              status: typeof e.status === "string" ? e.status : null,
            }))
          : [],
      };
    case GOOGLE_WORKSPACE_INTENTS.driveSearch:
    case GOOGLE_WORKSPACE_INTENTS.driveList:
      return {
        files: Array.isArray(row.files)
          ? (row.files as Array<Record<string, unknown>>).map((f) => ({
              id: typeof f.id === "string" ? f.id : null,
              name: typeof f.name === "string" ? f.name : null,
              mimeType: typeof f.mimeType === "string" ? f.mimeType : null,
              modifiedTime: typeof f.modifiedTime === "string" ? f.modifiedTime : null,
            }))
          : [],
        nextPageToken: typeof row.nextPageToken === "string" ? row.nextPageToken : null,
      };
    case GOOGLE_WORKSPACE_INTENTS.driveMetadata:
      return {
        id: typeof row.id === "string" ? row.id : null,
        name: typeof row.name === "string" ? row.name : null,
        mimeType: typeof row.mimeType === "string" ? row.mimeType : null,
        modifiedTime: typeof row.modifiedTime === "string" ? row.modifiedTime : null,
        size: typeof row.size === "string" ? row.size : null,
        webViewLink: typeof row.webViewLink === "string" ? row.webViewLink : null,
      };
    case GOOGLE_WORKSPACE_INTENTS.driveContent:
      return {
        content_text: typeof row.content_text === "string" ? row.content_text : "",
        encoding: typeof row.encoding === "string" ? row.encoding : "utf8",
      };
    case GOOGLE_WORKSPACE_INTENTS.sheetsMetadata:
      return {
        spreadsheetId: typeof row.spreadsheetId === "string" ? row.spreadsheetId : null,
        title: row.properties && typeof row.properties === "object"
          ? (typeof (row.properties as Record<string, unknown>).title === "string"
            ? (row.properties as Record<string, unknown>).title
            : null)
          : null,
        sheets: Array.isArray(row.sheets) ? row.sheets : [],
      };
    case GOOGLE_WORKSPACE_INTENTS.sheetsValues:
      return {
        range: typeof row.range === "string" ? row.range : null,
        majorDimension: typeof row.majorDimension === "string" ? row.majorDimension : null,
        values: Array.isArray(row.values) ? row.values : [],
      };
  }
}

async function executeRead(
  intent: GoogleWorkspaceReadIntent,
  payload: GoogleWorkspaceReadPayload,
  accessToken: string,
  fetchImpl: FetchImpl,
): Promise<GoogleApiResult> {
  const max = typeof payload.max_results === "number" ? payload.max_results : 25;
  switch (intent) {
    case GOOGLE_WORKSPACE_INTENTS.gmailSearch:
      return gmailSearchMessages(fetchImpl, accessToken, payload.q ?? "", max);
    case GOOGLE_WORKSPACE_INTENTS.gmailList:
      return gmailListMessages(fetchImpl, accessToken, max, payload.page_token);
    case GOOGLE_WORKSPACE_INTENTS.gmailRead:
      if (!payload.message_id) {
        return { ok: false, outcome: "PROVIDER_ERROR", reason: "message_id required", http_status: null, endpoint: "(not called)" };
      }
      return gmailGetMessage(fetchImpl, accessToken, payload.message_id);
    case GOOGLE_WORKSPACE_INTENTS.calendarList:
      return calendarListCalendars(fetchImpl, accessToken);
    case GOOGLE_WORKSPACE_INTENTS.calendarEventsList:
      return calendarListEvents(fetchImpl, accessToken, payload.calendar_id ?? "primary", max);
    case GOOGLE_WORKSPACE_INTENTS.driveSearch:
      return driveListFiles(fetchImpl, accessToken, payload.q, max);
    case GOOGLE_WORKSPACE_INTENTS.driveList:
      return driveListFiles(fetchImpl, accessToken, undefined, max);
    case GOOGLE_WORKSPACE_INTENTS.driveMetadata:
      if (!payload.file_id) {
        return { ok: false, outcome: "PROVIDER_ERROR", reason: "file_id required", http_status: null, endpoint: "(not called)" };
      }
      return driveGetFileMetadata(fetchImpl, accessToken, payload.file_id);
    case GOOGLE_WORKSPACE_INTENTS.driveContent:
      if (!payload.file_id) {
        return { ok: false, outcome: "PROVIDER_ERROR", reason: "file_id required", http_status: null, endpoint: "(not called)" };
      }
      return driveGetFileContent(fetchImpl, accessToken, payload.file_id);
    case GOOGLE_WORKSPACE_INTENTS.sheetsMetadata:
      if (!payload.spreadsheet_id) {
        return { ok: false, outcome: "PROVIDER_ERROR", reason: "spreadsheet_id required", http_status: null, endpoint: "(not called)" };
      }
      return sheetsGetSpreadsheet(fetchImpl, accessToken, payload.spreadsheet_id);
    case GOOGLE_WORKSPACE_INTENTS.sheetsValues:
      if (!payload.spreadsheet_id || !payload.range) {
        return { ok: false, outcome: "PROVIDER_ERROR", reason: "spreadsheet_id and range required", http_status: null, endpoint: "(not called)" };
      }
      return sheetsGetValues(fetchImpl, accessToken, payload.spreadsheet_id, payload.range);
  }
}

/**
 * Single public adapter entry for Google Workspace READ V1.
 */
export async function handleGoogleWorkspaceReadCommand(
  command: CommandEnvelope,
  deps: GoogleWorkspaceAdapterDeps = {},
): Promise<GoogleWorkspaceAdapterOutcome> {
  const evidence: CapabilityResultEvidence[] = [];
  const fetchImpl = deps.fetchImpl ?? hostFetch;
  const evaluatePolicy = deps.evaluateOwnerPolicy ?? evaluateOwnerCapabilityBinding;
  const readMeta = deps.readCredentialMeta ?? readGoogleCredentialMetadata;

  evidence.push({
    source: GOOGLE_WORKSPACE_ADAPTER_NAME,
    note: `connection_id=${GOOGLE_CONNECTION_ID} credential_ref=${GOOGLE_CREDENTIAL_REF} intent=${command.intent}`,
  });

  // 1. classify — write/unknown fail closed BEFORE host/auth gate
  if (isWriteIntent(command.intent) && !isReadIntent(command.intent)) {
    return reject(
      GOOGLE_WORKSPACE_OUTCOMES.UNSUPPORTED_ACTION,
      `write-class intent "${command.intent}" is not supported in Google Workspace READ-ONLY V1`,
      "classify",
      evidence,
    );
  }
  if (!isReadIntent(command.intent)) {
    return reject(
      GOOGLE_WORKSPACE_OUTCOMES.UNSUPPORTED_ACTION,
      `intent "${command.intent}" is not a registered Google Workspace read intent`,
      "classify",
      evidence,
    );
  }

  // 2. host/credential availability (after classification only)
  if (!deps.credentialResolver) {
    const node = macLocalAgentExecutionDecision({ current_node: "CORE_NODE" });
    if (!node.execute) {
      return reject(
        GOOGLE_WORKSPACE_OUTCOMES.AUTH_REQUIRED,
        `${MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE}: required_node=MAC_LOCAL_AGENT current_node=${node.current_node} execution_attempted=false — Keychain resolver not invoked`,
        "authenticate",
        evidence,
      );
    }
  }
  const resolver = deps.credentialResolver ?? createProductionCredentialResolver();

  const intent = command.intent;
  const spec = INTENT_SPECS[intent];
  const payload = asPayload(command.payload);
  let credentialResolved = false;
  let networkCalled = false;

  // 3. Owner capability policy — DENY ⇒ zero credential resolution, zero network
  const ai_identity = typeof payload.ai_identity === "string" ? payload.ai_identity : "";
  const session_id = typeof payload.session_id === "string" ? payload.session_id : "";
  const policy = evaluatePolicy({
    ai_identity,
    session_id,
    binding_id: spec.service,
    action: spec.bindable_action,
    remote: true,
  });
  evidence.push(ownerPolicyEvidence(spec.service, policy.decision, policy.reason_code));
  if (policy.decision !== "ALLOW") {
    return reject(
      GOOGLE_WORKSPACE_OUTCOMES.OWNER_DENIED,
      `Owner capability policy denied binding ${spec.service} (${policy.reason_code})`,
      "owner_policy",
      evidence,
    );
  }

  // Sheets values may need Drive discovery / metadata before a values.get.
  // Every scope needed by the planned calls is validated before Keychain:
  // owner policy → metadata → Drive scope? → Sheets scope → credential → APIs.
  const ownerTextParse = parseSheetsOwnerText(typeof payload.owner_text === "string" ? payload.owner_text : "");
  const hintedId =
    (typeof payload.spreadsheet_id === "string" && payload.spreadsheet_id.trim())
    || ownerTextParse.spreadsheet_id;
  const hintedRange =
    (typeof payload.range === "string" && payload.range.trim())
    || ownerTextParse.range;
  const sheetsValuesNeedsInputResolution =
    intent === GOOGLE_WORKSPACE_INTENTS.sheetsValues && (!hintedId || !hintedRange);
  const sheetsNeedsDriveDiscovery =
    intent === GOOGLE_WORKSPACE_INTENTS.sheetsValues && !hintedId;

  // Sheets name resolution also requires Drive Owner authority. Prove that
  // before reading even non-secret credential metadata.
  if (sheetsNeedsDriveDiscovery) {
    const drivePolicy = evaluatePolicy({
      ai_identity,
      session_id,
      binding_id: DRIVE_SERVICE_ID,
      action: "SEARCH",
      remote: true,
    });
    evidence.push(ownerPolicyEvidence(DRIVE_SERVICE_ID, drivePolicy.decision, drivePolicy.reason_code));
    if (drivePolicy.decision !== "ALLOW") {
      return reject(
        GOOGLE_WORKSPACE_OUTCOMES.OWNER_DENIED,
        `Owner capability policy denied Drive discovery for Sheets (${drivePolicy.reason_code})`,
        "owner_policy",
        evidence,
      );
    }
  }

  // Read non-secret registry metadata once. For Sheets values, required scopes
  // are validated before the ACTIVE credential-state gate and before Keychain.
  const meta = readMeta();

  if (sheetsNeedsDriveDiscovery) {
    const driveScopeOk = hasRequiredScopes(meta.granted_scopes, [DRIVE_SCOPE]);
    evidence.push(scopeCheckEvidence(DRIVE_SERVICE_ID, [DRIVE_SCOPE], driveScopeOk));
    if (!driveScopeOk) {
      return reject(
        GOOGLE_WORKSPACE_OUTCOMES.SCOPE_REQUIRED,
        `missing required Drive scope for spreadsheet name resolution`,
        "scope",
        evidence,
      );
    }
    const sheetsScopeOk = hasRequiredScopes(meta.granted_scopes, [SHEETS_SCOPE]);
    evidence.push(scopeCheckEvidence(SHEETS_SERVICE_ID, [SHEETS_SCOPE], sheetsScopeOk));
    if (!sheetsScopeOk) {
      return reject(
        GOOGLE_WORKSPACE_OUTCOMES.SCOPE_REQUIRED,
        `missing required Sheets scope after spreadsheet_id resolution`,
        "scope",
        evidence,
      );
    }
  } else if (intent === GOOGLE_WORKSPACE_INTENTS.sheetsValues) {
    const sheetsScopeOk = hasRequiredScopes(meta.granted_scopes, [SHEETS_SCOPE]);
    evidence.push(scopeCheckEvidence(SHEETS_SERVICE_ID, [SHEETS_SCOPE], sheetsScopeOk));
    if (!sheetsScopeOk) {
      return reject(
        GOOGLE_WORKSPACE_OUTCOMES.SCOPE_REQUIRED,
        `missing required Sheets scope after spreadsheet_id resolution`,
        "scope",
        evidence,
      );
    }
  }

  evidence.push(credentialMetaEvidence(GOOGLE_CREDENTIAL_REF, meta.status, meta.present));
  if (!meta.present || meta.status !== "ACTIVE") {
    return reject(
      GOOGLE_WORKSPACE_OUTCOMES.AUTH_REQUIRED,
      `ACTIVE credential required at ${GOOGLE_CREDENTIAL_REF}`,
      "authenticate",
      evidence,
    );
  }

  // Preserve existing Gmail/Calendar/Drive and Sheets metadata behavior.
  if (intent !== GOOGLE_WORKSPACE_INTENTS.sheetsValues) {
    const scopeOk = hasRequiredScopes(meta.granted_scopes, spec.required_scopes);
    evidence.push(scopeCheckEvidence(spec.service, spec.required_scopes, scopeOk));
    if (!scopeOk) {
      return reject(
        GOOGLE_WORKSPACE_OUTCOMES.SCOPE_REQUIRED,
        `missing required scope(s) for ${spec.service}`,
        "scope",
        evidence,
      );
    }
  }

  // 4–5. Resolve credential (Keychain + refresh when needed)
  const cred = await resolver.resolveAccessToken();
  credentialResolved = true;
  evidence.push(credentialResolvedEvidence(
    cred.ok ? cred.credential_source : GOOGLE_CREDENTIAL_REF,
    cred.ok,
    cred.ok ? cred.refreshed : false,
  ));
  if (!cred.ok) {
    return reject(
      cred.outcome,
      cred.reason,
      "authenticate",
      evidence,
    );
  }

  let effectivePayload: GoogleWorkspaceReadPayload = payload;
  if (sheetsValuesNeedsInputResolution) {
    const resolved = await resolveSheetsValuesInput(payload, {
      fetchImpl,
      accessToken: cred.access_token,
      evaluateOwnerPolicy: evaluatePolicy,
      readCredentialMeta: readMeta,
      scopesAlreadyValidated: true,
    });
    for (const e of resolved.evidence) evidence.push(e);
    if (resolved.status !== "RESOLVED") {
      if (resolved.status === "CLARIFICATION_REQUIRED" || resolved.status === "NOT_FOUND") {
        networkCalled = resolved.drive_discovery_used;
        return reject(
          resolved.outcome,
          resolved.reason,
          "input_resolution",
          evidence,
          resolved.candidates,
        );
      }
      if (resolved.status === "BLOCKED") {
        networkCalled = resolved.drive_discovery_used;
        return reject(resolved.outcome, resolved.reason, resolved.denied_at_stage, evidence);
      }
      throw new Error(`unhandled Sheets input resolution status: ${String((resolved as { status?: unknown }).status)}`);
    }
    networkCalled = resolved.drive_discovery_used;
    effectivePayload = {
      ...payload,
      spreadsheet_id: resolved.spreadsheet_id,
      range: resolved.range,
      spreadsheet_name: resolved.resolved_name ?? payload.spreadsheet_name,
    };
  }

  // 6. Google API
  const api = await executeRead(intent, effectivePayload, cred.access_token, fetchImpl);
  networkCalled = networkCalled || api.endpoint !== "(not called)";
  evidence.push(apiCallEvidence(spec.service, api.endpoint, api.http_status, api.ok));
  if (!api.ok) {
    return reject(api.outcome, api.reason, "route", evidence);
  }

  const normalized = normalizeProviderData(intent, api.data);
  const itemCount = countItems(normalized);
  evidence.push(normalizedResultEvidence(spec.service, intent, itemCount));
  evidence.push(outcomeEvidence(GOOGLE_WORKSPACE_OUTCOMES.SUCCESS, `credential_resolved=${credentialResolved} network_called=${networkCalled}`));

  const result: GoogleWorkspaceNormalizedResult = {
    provider: "google_workspace",
    service: spec.service,
    action: intent,
    account_identity_non_secret: cred.account_identity_non_secret,
    command_id: command.command_id,
    correlation_id: command.command_id,
    data: normalized,
    credential_source: cred.credential_source,
    http_status: api.http_status,
    fetched_at: hostNowIso(),
  };

  const event: EventEnvelope<GoogleWorkspaceNormalizedResult> = {
    event_id: `evt_${hostRandomId()}`,
    concerns: command.issued_by,
    event_type: spec.event_type,
    data: result,
    occurred_at: hostNowIso(),
    caused_by_command_id: command.command_id,
  };

  return { ok: true, outcome: "SUCCESS", event, evidence };
}

/** Test helper — proves gate order without importing private locals. */
export function googleWorkspaceWriteIntents(): readonly string[] {
  return GOOGLE_WORKSPACE_WRITE_INTENTS;
}
