/**
 * หน้าที่: the GitHub adapter's OWN internal contract — the intents it
 * answers, the payload shapes those intents carry, and the result shapes
 * it puts inside an `EventEnvelope.data`. These types live inside this
 * capability folder on purpose: Capability Folder Law ข้อ 3 (contract ของ
 * ความสามารถหนึ่งอยู่ในโฟลเดอร์ของความสามารถนั้น) and ข้อ 9 — the SHARED
 * contract surface stays exactly as `../../contracts/` already defines it
 * (`CommandEnvelope` in, `EventEnvelope`/`RoutingResult` out); no field
 * was added to any file under `../../contracts/` for this capability, and
 * doing so would be a cross-capability change this round is not
 * authorized to make.
 *
 * SCOPE (Owner, 2026-08-14): this round is CONNECT / TEST / READ STATUS
 * only. There is deliberately no push/write/commit intent, payload, or
 * result type in this file — see NOT_YET_BUILT at the bottom.
 *
 * Input: none (pure type definitions + intent/event-type constants).
 * Output: the types below.
 * Dependency ที่อนุญาต: `../../contracts/connector/connection.ts`,
 * `../../contracts/event/event-envelope.ts`,
 * `../../contracts/command/routing-result.ts`.
 * สิ่งที่ห้ามแตะ: ห้ามให้ result type ใดในไฟล์นี้ถือ "เนื้อหาไฟล์" หรือ
 * ข้อมูลธุรกิจ — ผลลัพธ์ของรอบนี้เป็น metadata ของ source control เท่านั้น
 * (path, blob sha, size, commit sha, HTTP status). ห้ามใส่ field ที่เก็บ
 * token/credential ลงใน payload หรือ result เด็ดขาด — credential เดินทาง
 * ผ่าน `credential_ref` (ชื่อ env var) เท่านั้น
 */

import type { ConnectionRegistration } from "../../contracts/connector/connection";
import type { EventEnvelope } from "../../contracts/event/event-envelope";
import type { RoutingResult } from "../../contracts/command/routing-result";

/** Must equal this folder's own name under `../` — that is how `ConnectionRegistration.adapter` selects this adapter. */
export const GITHUB_ADAPTER_NAME = "github";

/** The complete set of `CommandEnvelope.intent` values this adapter answers today. Anything else is rejected at the "classify" stage. */
export const GITHUB_INTENTS = {
  checkAccess: "connector.github.check_access",
  readStatus: "connector.github.read_status",
} as const;

export type GithubIntent = (typeof GITHUB_INTENTS)[keyof typeof GITHUB_INTENTS];

/** The complete set of `EventEnvelope.event_type` values this adapter emits today. */
export const GITHUB_EVENT_TYPES = {
  accessChecked: "connector.github.access_checked",
  statusRead: "connector.github.status_read",
} as const;

/** Which repository a command is about. Always payload data — never a constant in this capability. */
export interface GithubRepoTarget {
  owner: string;
  repo: string;
}

/** A repository plus the specific branch/ref a status read is about. */
export interface GithubBranchTarget extends GithubRepoTarget {
  branch: string;
}

/** Payload of `connector.github.check_access`: "can this connection's credential actually reach this repo?" */
export interface GithubCheckAccessPayload {
  connection: ConnectionRegistration;
  target: GithubRepoTarget;
}

/** Payload of `connector.github.read_status`: repo + branch status, and optionally the status of specific paths inside it. */
export interface GithubReadStatusPayload {
  connection: ConnectionRegistration;
  target: GithubBranchTarget;
  /** Repo-relative paths to report on. Empty/absent = repo + branch status only. `""` means the repository root. */
  paths?: string[];
}

/**
 * Result of a real access check. `reachable: false` with `http_status: 404`
 * deliberately does NOT claim "the repo does not exist" — GitHub returns
 * 404 both for a repo that does not exist and for one this token may not
 * see (a fine-grained PAT with this repository not selected). That
 * ambiguity is GitHub's, and is reported as ambiguity rather than guessed.
 */
export interface GithubAccessCheckResult {
  owner: string;
  repo: string;
  reachable: boolean;
  /** `null` = no HTTP response at all (DNS/TLS/timeout), which is a different failure from any HTTP status. */
  http_status: number | null;
  default_branch: string | null;
  visibility: string | null;
  reason: string | null;
  /** Format `env:<NAME>` — the credential channel actually used, never the token value. Makes "which credential was used" auditable evidence in the output itself (Owner, 2026-08-14: must read `env:GITHUB_PAT_INFRASTRUCTURE` — this capability accepts no other channel, see ./adapter-config.ts). */
  credential_source: string;
}

/** One directory entry, metadata only — never file content. */
export interface GithubDirectoryEntry {
  name: string;
  path: string;
  /** GitHub's own entry type: "file" | "dir" | "symlink" | "submodule". Passed through, not re-interpreted. */
  entry_type: string;
  blob_sha: string;
  size_bytes: number;
}

/** Status of one requested path. No variant carries file content — reading content back is NOT_YET_BUILT this round. */
export type GithubPathStatus =
  | { path: string; kind: "file"; blob_sha: string; size_bytes: number }
  | { path: string; kind: "directory"; entry_count: number; entries: GithubDirectoryEntry[] }
  | { path: string; kind: "absent" }
  | { path: string; kind: "error"; http_status: number | null; reason: string };

/** Result of a real repository status read. Source-control metadata only. */
export interface GithubRepoStatusResult {
  owner: string;
  repo: string;
  branch: string;
  reachable: boolean;
  http_status: number | null;
  default_branch: string | null;
  visibility: string | null;
  branch_found: boolean;
  head_commit_sha: string | null;
  head_commit_at: string | null;
  branch_protected: boolean | null;
  paths: GithubPathStatus[];
  reason: string | null;
  /** Format `env:<NAME>` — see GithubAccessCheckResult.credential_source. */
  credential_source: string;
}

/** The `ok: false` half of the shared `RoutingResult` — reused as-is, so a rejection from this adapter is the same shape the router already speaks. */
export type GithubRejection = Extract<RoutingResult, { ok: false }>;

/** Every `EventEnvelope.data` this adapter can produce today. */
export type GithubEventData = GithubAccessCheckResult | GithubRepoStatusResult;

/**
 * What `handleGithubCommand` returns: either a real Event describing what
 * happened, or a RoutingResult-shaped rejection carrying a reason and the
 * stage it was denied at. Never a bare boolean, matching
 * `../../contracts/command/routing-result.ts`'s own stated discipline.
 */
export type GithubAdapterOutcome =
  | { ok: true; event: EventEnvelope<GithubEventData> }
  | { ok: false; rejection: GithubRejection };

/**
 * NOT_YET_BUILT (deferred by Owner scope decision 2026-08-14, not
 * forgotten):
 * - push / write / commit (`PUT /repos/{owner}/{repo}/contents/{path}`) —
 *   no intent, no payload type, no code path exists for it in this folder.
 * - reading file CONTENT back ("pull") — this round reports a path's
 *   metadata (type, blob sha, size) only, never its bytes.
 * - recursive directory status — a directory path reports its immediate
 *   entries only, and does not walk subdirectories.
 * - webhooks / event subscription from GitHub inbound.
 */
