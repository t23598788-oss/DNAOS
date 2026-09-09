/**
 * Sheets read input resolution — reuses Drive readonly search + Sheets metadata.
 * Fail-closed: never invents spreadsheet_id; never invents Sheet1 without metadata proof.
 */

import type { CapabilityResultEvidence } from "../../contracts/command/capability-result";
import { evaluateOwnerCapabilityBinding } from "../../control/local-resource-access/owner-capability-policy";
import { DRIVE_SCOPE, DRIVE_SERVICE_ID, SHEETS_SCOPE, SHEETS_SERVICE_ID } from "./contract";
import {
  GOOGLE_WORKSPACE_OUTCOMES,
  type GoogleWorkspaceOutcomeCode,
  type GoogleWorkspaceReadPayload,
} from "./adapter-contract";
import { apiCallEvidence, ownerPolicyEvidence, scopeCheckEvidence } from "./evidence";
import { hasRequiredScopes } from "./credential-resolution";
import { driveListFiles, sheetsGetSpreadsheet, type GoogleApiResult } from "./google-api";
import type { FetchImpl } from "./host-runtime";
import {
  buildSpreadsheetDriveQuery,
  parseSheetsOwnerText,
  type SheetsOwnerTextParse,
} from "./sheets-owner-text";

type CredentialMeta = {
  present: boolean;
  status: string | null;
  account?: string | null;
  granted_scopes: readonly string[];
};

export interface SheetsCandidate {
  readonly name: string;
  readonly spreadsheet_id: string;
  readonly modified_time: string | null;
}

export type SheetsInputResolution =
  | {
      readonly status: "RESOLVED";
      readonly spreadsheet_id: string;
      readonly range: string;
      readonly resolved_name: string | null;
      readonly evidence: readonly CapabilityResultEvidence[];
      readonly drive_discovery_used: boolean;
    }
  | {
      readonly status: "CLARIFICATION_REQUIRED" | "NOT_FOUND";
      readonly outcome: Exclude<GoogleWorkspaceOutcomeCode, "SUCCESS">;
      readonly reason: string;
      readonly candidates: readonly SheetsCandidate[];
      readonly evidence: readonly CapabilityResultEvidence[];
      readonly drive_discovery_used: boolean;
    }
  | {
      readonly status: "BLOCKED";
      readonly outcome: Exclude<GoogleWorkspaceOutcomeCode, "SUCCESS">;
      readonly reason: string;
      readonly denied_at_stage: "owner_policy" | "scope" | "authenticate" | "route";
      readonly evidence: readonly CapabilityResultEvidence[];
      readonly drive_discovery_used: boolean;
    };

export interface SheetsInputResolutionDeps {
  readonly fetchImpl: FetchImpl;
  readonly accessToken: string;
  readonly evaluateOwnerPolicy?: typeof evaluateOwnerCapabilityBinding;
  readonly readCredentialMeta: () => CredentialMeta;
}

function mergeParse(payload: GoogleWorkspaceReadPayload): SheetsOwnerTextParse {
  const fromText = typeof payload.owner_text === "string" ? parseSheetsOwnerText(payload.owner_text) : parseSheetsOwnerText("");
  return {
    spreadsheet_id:
      (typeof payload.spreadsheet_id === "string" && payload.spreadsheet_id.trim()) || fromText.spreadsheet_id,
    spreadsheet_name:
      (typeof payload.spreadsheet_name === "string" && payload.spreadsheet_name.trim()) || fromText.spreadsheet_name,
    range: (typeof payload.range === "string" && payload.range.trim()) || fromText.range,
    sheet_tab: (typeof payload.sheet_tab === "string" && payload.sheet_tab.trim()) || fromText.sheet_tab,
  };
}

function filesFromDrive(data: unknown): SheetsCandidate[] {
  if (!data || typeof data !== "object") return [];
  const files = (data as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  const out: SheetsCandidate[] = [];
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    const row = f as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string") continue;
    out.push({
      name: row.name,
      spreadsheet_id: row.id,
      modified_time: typeof row.modifiedTime === "string" ? row.modifiedTime : null,
    });
  }
  return out;
}

function pickUniqueByName(candidates: readonly SheetsCandidate[], name: string | null): SheetsCandidate[] {
  if (!name) return [...candidates];
  const n = name.trim().toLocaleLowerCase();
  const exact = candidates.filter((c) => c.name.toLocaleLowerCase() === n);
  if (exact.length > 0) return exact;
  return candidates.filter((c) => c.name.toLocaleLowerCase().includes(n));
}

function sheetTitlesFromMetadata(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const sheets = (data as { sheets?: unknown }).sheets;
  if (!Array.isArray(sheets)) return [];
  const titles: string[] = [];
  for (const s of sheets) {
    if (!s || typeof s !== "object") continue;
    const props = (s as { properties?: unknown }).properties;
    if (!props || typeof props !== "object") continue;
    const title = (props as { title?: unknown }).title;
    if (typeof title === "string" && title.trim()) titles.push(title);
  }
  return titles;
}

/**
 * Resolve spreadsheet_id + range for a Sheets values.read.
 * Caller must already have allowed Sheets Owner policy and resolved an access token
 * only after Drive/Sheets scope metadata checks inside this function's prerequisites
 * are satisfied by the adapter (token is passed in only after those gates).
 *
 * Drive discovery performs Drive Owner policy + Drive scope checks before any Drive GET.
 * Range resolution may perform Sheets spreadsheets.get after Sheets scope is confirmed.
 */
export async function resolveSheetsValuesInput(
  payload: GoogleWorkspaceReadPayload,
  deps: SheetsInputResolutionDeps,
): Promise<SheetsInputResolution> {
  const evidence: CapabilityResultEvidence[] = [];
  const evaluatePolicy = deps.evaluateOwnerPolicy ?? evaluateOwnerCapabilityBinding;
  const parsed = mergeParse(payload);
  let drive_discovery_used = false;

  let spreadsheet_id = parsed.spreadsheet_id;
  let range = parsed.range;
  let resolved_name: string | null = parsed.spreadsheet_name;

  if (spreadsheet_id && range) {
    evidence.push({
      source: "google-workspace.sheets_input_resolution",
      note: `range_source=owner_explicit spreadsheet_id_source=owner_explicit`,
    });
    return {
      status: "RESOLVED",
      spreadsheet_id,
      range,
      resolved_name,
      evidence,
      drive_discovery_used: false,
    };
  }

  // --- Drive discovery when spreadsheet_id missing ---
  if (!spreadsheet_id) {
    const ai_identity = typeof payload.ai_identity === "string" ? payload.ai_identity : "";
    const session_id = typeof payload.session_id === "string" ? payload.session_id : "";
    const drivePolicy = evaluatePolicy({
      ai_identity,
      session_id,
      binding_id: DRIVE_SERVICE_ID,
      action: "SEARCH",
      remote: true,
    });
    evidence.push(ownerPolicyEvidence(DRIVE_SERVICE_ID, drivePolicy.decision, drivePolicy.reason_code));
    if (drivePolicy.decision !== "ALLOW") {
      return {
        status: "BLOCKED",
        outcome: GOOGLE_WORKSPACE_OUTCOMES.OWNER_DENIED,
        reason: `Owner capability policy denied Drive discovery for Sheets (${drivePolicy.reason_code})`,
        denied_at_stage: "owner_policy",
        evidence,
        drive_discovery_used: false,
      };
    }

    const meta = deps.readCredentialMeta();
    const driveScopeOk = hasRequiredScopes(meta.granted_scopes, [DRIVE_SCOPE]);
    evidence.push(scopeCheckEvidence(DRIVE_SERVICE_ID, [DRIVE_SCOPE], driveScopeOk));
    if (!driveScopeOk) {
      return {
        status: "BLOCKED",
        outcome: GOOGLE_WORKSPACE_OUTCOMES.SCOPE_REQUIRED,
        reason: `missing required Drive scope for spreadsheet name resolution`,
        denied_at_stage: "scope",
        evidence,
        drive_discovery_used: false,
      };
    }

    drive_discovery_used = true;
    const q = buildSpreadsheetDriveQuery(parsed.spreadsheet_name);
    const driveResult: GoogleApiResult = await driveListFiles(deps.fetchImpl, deps.accessToken, q, 25);
    evidence.push(apiCallEvidence(DRIVE_SERVICE_ID, driveResult.endpoint, driveResult.http_status, driveResult.ok));
    if (!driveResult.ok) {
      return {
        status: "BLOCKED",
        outcome: driveResult.outcome,
        reason: `Drive spreadsheet discovery failed: ${driveResult.reason}`,
        denied_at_stage: "route",
        evidence,
        drive_discovery_used,
      };
    }

    let candidates = filesFromDrive(driveResult.data);
    candidates = pickUniqueByName(candidates, parsed.spreadsheet_name);
    evidence.push({
      source: "google-workspace.sheets_input_resolution",
      note: `drive_discovery candidates=${candidates.length} name_hint=${parsed.spreadsheet_name ? "present" : "absent"}`,
    });

    if (candidates.length === 0) {
      return {
        status: "NOT_FOUND",
        outcome: GOOGLE_WORKSPACE_OUTCOMES.NOT_FOUND,
        reason: parsed.spreadsheet_name
          ? `no Google Spreadsheet matched name "${parsed.spreadsheet_name}"`
          : "no Google Spreadsheet files found for Sheets read",
        candidates: [],
        evidence,
        drive_discovery_used,
      };
    }
    if (candidates.length > 1) {
      return {
        status: "CLARIFICATION_REQUIRED",
        outcome: GOOGLE_WORKSPACE_OUTCOMES.CLARIFICATION_REQUIRED,
        reason: `multiple Google Spreadsheets matched; specify spreadsheet_id or a unique name`,
        candidates,
        evidence,
        drive_discovery_used,
      };
    }
    spreadsheet_id = candidates[0].spreadsheet_id;
    resolved_name = candidates[0].name;
  }

  // --- Range resolution ---
  if (range) {
    evidence.push({
      source: "google-workspace.sheets_input_resolution",
      note: `range_source=owner_explicit range=${range}`,
    });
    return {
      status: "RESOLVED",
      spreadsheet_id,
      range,
      resolved_name,
      evidence,
      drive_discovery_used,
    };
  }

  // Need Sheets metadata to prove a tab name or unique sheet — Sheets scope must pass first
  const meta = deps.readCredentialMeta();
  const sheetsScopeOk = hasRequiredScopes(meta.granted_scopes, [SHEETS_SCOPE]);
  evidence.push(scopeCheckEvidence(SHEETS_SERVICE_ID, [SHEETS_SCOPE], sheetsScopeOk));
  if (!sheetsScopeOk) {
    return {
      status: "BLOCKED",
      outcome: GOOGLE_WORKSPACE_OUTCOMES.SCOPE_REQUIRED,
      reason: `missing required Sheets scope after spreadsheet_id resolution`,
      denied_at_stage: "scope",
      evidence,
      drive_discovery_used,
    };
  }

  const metaResult = await sheetsGetSpreadsheet(deps.fetchImpl, deps.accessToken, spreadsheet_id);
  evidence.push(apiCallEvidence(SHEETS_SERVICE_ID, metaResult.endpoint, metaResult.http_status, metaResult.ok));
  if (!metaResult.ok) {
    return {
      status: "BLOCKED",
      outcome: metaResult.outcome,
      reason: `Sheets metadata failed while resolving range: ${metaResult.reason}`,
      denied_at_stage: "route",
      evidence,
      drive_discovery_used,
    };
  }

  const titles = sheetTitlesFromMetadata(metaResult.data);
  if (parsed.sheet_tab) {
    const match = titles.find((t) => t.toLocaleLowerCase() === parsed.sheet_tab!.toLocaleLowerCase());
    if (!match) {
      return {
        status: "CLARIFICATION_REQUIRED",
        outcome: GOOGLE_WORKSPACE_OUTCOMES.CLARIFICATION_REQUIRED,
        reason: `sheet/tab "${parsed.sheet_tab}" not found; available tabs: ${titles.join(", ") || "(none)"}`,
        candidates: [{ name: resolved_name ?? spreadsheet_id, spreadsheet_id, modified_time: null }],
        evidence,
        drive_discovery_used,
      };
    }
    range = match;
    evidence.push({
      source: "google-workspace.sheets_input_resolution",
      note: `range_source=owner_sheet_tab_proven range=${range}`,
    });
    return {
      status: "RESOLVED",
      spreadsheet_id,
      range,
      resolved_name,
      evidence,
      drive_discovery_used,
    };
  }

  if (titles.length === 1) {
    range = titles[0];
    evidence.push({
      source: "google-workspace.sheets_input_resolution",
      note: `range_source=unique_sheet_metadata_proven range=${range}`,
    });
    return {
      status: "RESOLVED",
      spreadsheet_id,
      range,
      resolved_name,
      evidence,
      drive_discovery_used,
    };
  }

  return {
    status: "CLARIFICATION_REQUIRED",
    outcome: GOOGLE_WORKSPACE_OUTCOMES.CLARIFICATION_REQUIRED,
    reason: titles.length === 0
      ? "spreadsheet has no sheets/tabs; provide an explicit range"
      : `multiple sheets/tabs present; provide range or sheet name (tabs: ${titles.join(", ")})`,
    candidates: [{ name: resolved_name ?? spreadsheet_id, spreadsheet_id, modified_time: null }],
    evidence,
    drive_discovery_used,
  };
}
