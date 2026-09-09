/**
 * Canonical connection summary — machine enums only. Human labels stay
 * out of the projection. Large connection documents are not dumped into
 * the primary Owner answer.
 *
 * Google Workspace status is overlaid from runtime authorization state
 * (authorizations.jsonl), not from documentation alone.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectGoogleWorkspaceConnectionStatus } from "../../connections/google-workspace/connection-status-projection";
import { GOOGLE_CONNECTION_ID } from "../../connections/google-workspace/contract";

export const CONNECTION_STATUS_ENUMS = [
  "VERIFIED",
  "CONNECTED",
  "NOT_VERIFIED",
  "BLOCKED",
  "NOT_WIRED",
  "DENIED_BY_ARCHITECTURE",
] as const;

export type ConnectionStatusEnum = typeof CONNECTION_STATUS_ENUMS[number];

export const HUMAN_CONNECTION_STATUS_TH: Readonly<Record<ConnectionStatusEnum, string>> = {
  VERIFIED: "ตรวจสอบแล้ว",
  CONNECTED: "เชื่อมต่อแล้ว",
  NOT_VERIFIED: "ยังไม่ตรวจสอบ",
  BLOCKED: "ถูกบล็อก",
  NOT_WIRED: "ยังไม่ต่อสาย",
  DENIED_BY_ARCHITECTURE: "สถาปัตยกรรมห้าม",
};

const ENUM_SET = new Set<string>(CONNECTION_STATUS_ENUMS);

export function canonicalizeConnectionStatus(value: unknown): ConnectionStatusEnum {
  if (typeof value !== "string") return "NOT_VERIFIED";
  if (ENUM_SET.has(value)) return value as ConnectionStatusEnum;
  return "NOT_VERIFIED";
}

export interface ConnectionBoundaryRef {
  readonly source: string;
  readonly destination: string;
  readonly status: ConnectionStatusEnum;
}

export interface ConnectionSummaryV1 {
  readonly connection_id: string;
  readonly system: string;
  readonly status: ConnectionStatusEnum;
  readonly verification: ConnectionStatusEnum | string;
  readonly verified_boundaries: readonly string[];
  readonly blocked_boundaries: readonly string[];
  readonly not_wired_boundaries: readonly string[];
  readonly next_missing_boundary: string | null;
  readonly evidence_ref: string;
}

interface ConnectionIndexEntry {
  readonly connection_id?: unknown;
  readonly name?: unknown;
  readonly status?: unknown;
  readonly verification_level?: unknown;
  readonly human_document_path?: unknown;
  readonly machine_record_path?: unknown;
  readonly destination_system?: unknown;
  readonly boundary_statuses?: unknown;
}

interface ConnectionDocument {
  readonly document_id?: unknown;
  readonly status?: unknown;
  readonly verification_level?: unknown;
  readonly boundary_statuses?: unknown;
  readonly boundaries?: unknown;
}

const CONNECTION_INDEX_PATH = "connections/connection-index/index.json";

function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function classifyBoundaryLabel(label: string, status: ConnectionStatusEnum): "verified" | "blocked" | "not_wired" | "other" {
  if (status === "VERIFIED" || status === "CONNECTED") return "verified";
  if (status === "BLOCKED") return "blocked";
  if (status === "NOT_WIRED" || status === "DENIED_BY_ARCHITECTURE") return "not_wired";
  return "other";
}

function edgesFromDocument(document: ConnectionDocument, entry: ConnectionIndexEntry): ConnectionBoundaryRef[] {
  const edges: ConnectionBoundaryRef[] = [];
  if (Array.isArray(document.boundaries)) {
    for (const row of document.boundaries) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const boundary = row as Record<string, unknown>;
      edges.push({
        source: typeof boundary.source === "string" ? boundary.source : "unknown",
        destination: typeof boundary.destination === "string" ? boundary.destination : "unknown",
        status: canonicalizeConnectionStatus(boundary.verification_status ?? boundary.output_result),
      });
    }
  }
  const projected = (document.boundary_statuses && typeof document.boundary_statuses === "object" && !Array.isArray(document.boundary_statuses)
    ? document.boundary_statuses
    : entry.boundary_statuses && typeof entry.boundary_statuses === "object" && !Array.isArray(entry.boundary_statuses)
      ? entry.boundary_statuses
      : null) as Record<string, unknown> | null;
  if (projected) {
    for (const [label, value] of Object.entries(projected)) {
      if (edges.some((edge) => `${edge.source} → ${edge.destination}` === label)) continue;
      edges.push({ source: label, destination: "", status: canonicalizeConnectionStatus(value) });
    }
  }
  return edges;
}

export function summarizeConnection(entry: ConnectionIndexEntry, document: ConnectionDocument, machinePath: string): ConnectionSummaryV1 {
  const edges = edgesFromDocument(document, entry);
  const verified_boundaries: string[] = [];
  const blocked_boundaries: string[] = [];
  const not_wired_boundaries: string[] = [];
  for (const edge of edges) {
    const label = edge.destination ? `${edge.source} → ${edge.destination}` : edge.source;
    const bucket = classifyBoundaryLabel(label, edge.status);
    if (bucket === "verified") verified_boundaries.push(label);
    else if (bucket === "blocked") blocked_boundaries.push(label);
    else if (bucket === "not_wired") not_wired_boundaries.push(label);
  }
  const next = edges.find((edge) => edge.status === "NOT_WIRED");
  const next_missing_boundary = next
    ? (next.destination ? `${next.source} → ${next.destination}` : next.source)
    : (not_wired_boundaries[0] ?? null);
  return {
    connection_id: String(document.document_id ?? entry.connection_id ?? "unknown"),
    system: String(entry.destination_system ?? entry.name ?? document.document_id ?? "unknown"),
    status: canonicalizeConnectionStatus(document.status ?? entry.status),
    verification: typeof entry.verification_level === "string"
      ? entry.verification_level
      : canonicalizeConnectionStatus(document.verification_level),
    verified_boundaries,
    blocked_boundaries,
    not_wired_boundaries,
    next_missing_boundary,
    evidence_ref: machinePath,
  };
}

function googleWorkspaceRuntimeSummary(): ConnectionSummaryV1 {
  const projection = projectGoogleWorkspaceConnectionStatus();
  // Hard gate: runtime CONNECTED must never project as NOT_CONNECTED / not-connected vocab.
  const status: ConnectionStatusEnum =
    projection.state === "CONNECTED" ? "CONNECTED" : "NOT_VERIFIED";
  const verified: string[] = [];
  const notWired: string[] = [];
  for (const [label, value] of Object.entries(projection.capabilities)) {
    const name = `google.${label}.readonly`;
    if (value === "CONNECTED") verified.push(name);
    else notWired.push(name);
  }
  return {
    connection_id: GOOGLE_CONNECTION_ID,
    system: "Google Workspace",
    status,
    verification: projection.state,
    verified_boundaries: verified,
    blocked_boundaries: ["Write operations"],
    not_wired_boundaries: notWired,
    next_missing_boundary: projection.production_ready ? null : "PRODUCTION_READINESS",
    evidence_ref: projection.evidence_ref,
  };
}

export function loadConnectionSummaries(cwd = process.cwd()): {
  readonly summaries: readonly ConnectionSummaryV1[];
  readonly source: string;
} {
  const source = CONNECTION_INDEX_PATH;
  const index = readJson(join(cwd, CONNECTION_INDEX_PATH)) as { entries?: unknown } | null;
  const entries = Array.isArray(index?.entries) ? index.entries as ConnectionIndexEntry[] : [];
  const summaries: ConnectionSummaryV1[] = [];
  for (const entry of entries) {
    if (typeof entry.machine_record_path !== "string") continue;
    const document = readJson(join(cwd, entry.machine_record_path)) as ConnectionDocument | null;
    if (!document) continue;
    // Skip stale Google docs from index — runtime overlay is authoritative.
    if (String(document.document_id ?? entry.connection_id) === GOOGLE_CONNECTION_ID) continue;
    summaries.push(summarizeConnection(entry, document, entry.machine_record_path));
  }
  summaries.push(googleWorkspaceRuntimeSummary());
  return { summaries, source };
}

export function renderConnectionSummariesForOwner(summaries: readonly ConnectionSummaryV1[], localize: boolean): string {
  if (summaries.length === 0) return "ไม่ทราบ (UNKNOWN — ไม่มีหลักฐานในทะเบียน): ไม่พบ authoritative Connection Index หรือ connection document";
  const lines = summaries.map((row) => {
    const status = localize ? HUMAN_CONNECTION_STATUS_TH[row.status] : row.status;
    const next = row.next_missing_boundary ?? "none";
    return `${row.connection_id} | system=${row.system} | status=${status} | verification=${row.verification} | next_missing_boundary=${next}`;
  });
  return `Connection Index สรุป ${summaries.length} รายการ (รายละเอียดอยู่ใน evidence_refs):\n${lines.join("\n")}`;
}

export function queryConnectionBoundary(
  summaries: readonly ConnectionSummaryV1[],
  source: string,
  destination: string,
): ConnectionStatusEnum | "NOT_FOUND" {
  const needle = `${source} → ${destination}`;
  for (const row of summaries) {
    for (const label of [...row.verified_boundaries, ...row.blocked_boundaries, ...row.not_wired_boundaries]) {
      if (label === needle || label.includes(needle)) {
        if (row.not_wired_boundaries.includes(label)) return "NOT_WIRED";
        if (row.blocked_boundaries.includes(label)) return "BLOCKED";
        if (row.verified_boundaries.includes(label)) return "VERIFIED";
      }
    }
  }
  return "NOT_FOUND";
}
