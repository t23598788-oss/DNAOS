/**
 * หน้าที่: speak the real GitHub REST API — GET only. Three reads:
 * the repository itself, one branch, and one path's metadata inside that
 * branch. Every failure is returned as data (`failed` / `not_found`),
 * never thrown and never swallowed by a catch-all, so a caller can always
 * tell "no HTTP response at all" (transport) from "HTTP 401" from
 * "HTTP 404" from "HTTP 500".
 *
 * READ-ONLY BY CONSTRUCTION: this file's only outbound call is
 * `githubGet`, which uses `./host-runtime`'s `hostFetch` — a function with
 * no `method` and no `body` parameter at all. There is no write path in
 * this capability to accidentally reach (Owner scope decision,
 * 2026-08-14). The GitHub Contents API's PUT/DELETE side is deliberately
 * absent, not merely unused.
 *
 * The API mechanics here are re-derived from what dna-os-deadboard's
 * TASK-172 `engines/infrastructure/githubSync.ts` proved live (headers,
 * the 404-means-"missing OR no access" ambiguity, `/contents` returning an
 * object for a file and an array for a directory). Fresh implementation,
 * zero import from that repo, with one real correction: TASK-172 encoded
 * whole paths with `encodeURIComponent`, turning "a/b.ts" into "a%2Fb.ts";
 * this capability encodes per segment (see ./repo-path.ts).
 *
 * Input: a resolved token (in memory, from ./credential-resolution.ts) and
 * caller-supplied target data.
 * Output: `RepositoryLookup`, `BranchLookup`, `PathLookup`.
 * Dependency ที่อนุญาต: `./adapter-config`, `./host-runtime`,
 * `./repo-path`, `./adapter-contract` (types only).
 * สิ่งที่ห้ามแตะ: **ห้ามใส่ token ลงใน reason string, URL query, หรือ log**
 * — token อยู่ใน Authorization header เท่านั้น. ห้ามเพิ่มฟังก์ชันที่
 * เขียน/ลบข้อมูลบน GitHub ในไฟล์นี้ (รอบนี้ Owner สั่ง read-only) —
 * การเพิ่มต้องเป็นรอบงานใหม่ที่ Owner อนุมัติ. ห้ามคืน "เนื้อหาไฟล์" ออก
 * จากไฟล์นี้ แม้ GitHub จะแนบ `content` มาให้ก็ตาม
 */

import {
  GITHUB_ACCEPT_HEADER,
  GITHUB_API_BASE_URL,
  GITHUB_API_VERSION,
  GITHUB_REQUEST_TIMEOUT_MILLISECONDS,
  GITHUB_USER_AGENT,
  MAX_ERROR_BODY_CHARACTERS,
} from "./adapter-config";
import type { GithubBranchTarget, GithubDirectoryEntry, GithubRepoTarget } from "./adapter-contract";
import { hostFetch } from "./host-runtime";
import { encodeRepoPath } from "./repo-path";

/** Exported 2026-08-14 so ./adapter.test.ts can independently verify the real request headers this capability sends — see ../CHANGE_PLAN_API_VERSION.md. Not used by any other capability (Capability Folder Law ข้อ 9 — this remains an internal helper, only the test file, which lives in this same folder, imports it). */
export function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: GITHUB_ACCEPT_HEADER,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": GITHUB_USER_AGENT,
  };
}

type GithubGetOutcome =
  | { kind: "ok"; http_status: number; body: unknown }
  | { kind: "not_found"; http_status: number; reason: string }
  | { kind: "failed"; http_status: number | null; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

/** GitHub's error bodies are JSON like {"message":"Not Found",...}. Surface the message when there is one, truncated — never the whole body. */
async function describeErrorBody(response: { text(): Promise<string> }): Promise<string> {
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    return `could not read response body (${error instanceof Error ? error.message : String(error)})`;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) {
      const message = stringField(parsed, "message");
      if (message !== null) return message.slice(0, MAX_ERROR_BODY_CHARACTERS);
    }
  } catch {
    // Not JSON — fall through and report the raw body, truncated.
  }
  return raw.slice(0, MAX_ERROR_BODY_CHARACTERS);
}

function explainStatus(httpStatus: number, message: string): string {
  if (httpStatus === 401) {
    return `HTTP 401 — GitHub rejected the credential (invalid, expired, or revoked token): ${message}`;
  }
  if (httpStatus === 403) {
    return `HTTP 403 — request forbidden (token permissions, SSO authorization, or rate limit): ${message}`;
  }
  if (httpStatus === 429) {
    return `HTTP 429 — rate limited by GitHub: ${message}`;
  }
  return `HTTP ${httpStatus}: ${message}`;
}

/** The single outbound call of this whole capability. GET only — see the file header. */
async function githubGet(token: string, url: string): Promise<GithubGetOutcome> {
  const attempt = await hostFetch(url, githubHeaders(token), GITHUB_REQUEST_TIMEOUT_MILLISECONDS);

  if (attempt.kind === "transport_error") {
    return { kind: "failed", http_status: null, reason: `no HTTP response from GitHub (network, DNS, TLS, or timeout): ${attempt.reason}` };
  }

  const response = attempt.response;

  if (response.status === 404) {
    const message = await describeErrorBody(response);
    return { kind: "not_found", http_status: 404, reason: message };
  }

  if (!response.ok) {
    const message = await describeErrorBody(response);
    return { kind: "failed", http_status: response.status, reason: explainStatus(response.status, message) };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return {
      kind: "failed",
      http_status: response.status,
      reason: `HTTP ${response.status} but the body was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return { kind: "ok", http_status: response.status, body };
}

function encodeOwnerRepo(target: GithubRepoTarget): string {
  return `${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
}

export type RepositoryLookup =
  | { kind: "found"; http_status: number; default_branch: string | null; visibility: string | null }
  /** GitHub answers 404 both for "does not exist" and for "your token may not see it" — reported as the ambiguity it is. */
  | { kind: "not_found_or_no_access"; http_status: number; reason: string }
  | { kind: "failed"; http_status: number | null; reason: string };

export type AuthenticatedUserLookup =
  | { kind: "found"; http_status: number; login: string }
  | { kind: "failed"; http_status: number | null; reason: string };

/** GET /user — "who does this credential authenticate as". Added for STEP "Build GitHub Authorization Bootstrap / Plug-in Setup" so connections/provider-authorization/ can verify a freshly-issued Device Flow token without duplicating GitHub REST mechanics outside this capability. */
export async function getAuthenticatedUser(token: string): Promise<AuthenticatedUserLookup> {
  const outcome = await githubGet(token, `${GITHUB_API_BASE_URL}/user`);
  if (outcome.kind === "not_found" || outcome.kind === "failed") {
    return { kind: "failed", http_status: outcome.http_status, reason: "reason" in outcome ? outcome.reason : "unexpected not_found for /user" };
  }
  if (!isRecord(outcome.body)) {
    return { kind: "failed", http_status: outcome.http_status, reason: "GitHub returned a /user body that was not a JSON object" };
  }
  const login = stringField(outcome.body, "login");
  if (login === null) return { kind: "failed", http_status: outcome.http_status, reason: "GitHub's /user response had no string 'login' field" };
  return { kind: "found", http_status: outcome.http_status, login };
}

export async function getRepository(token: string, target: GithubRepoTarget): Promise<RepositoryLookup> {
  const outcome = await githubGet(token, `${GITHUB_API_BASE_URL}/repos/${encodeOwnerRepo(target)}`);

  if (outcome.kind === "not_found") {
    return {
      kind: "not_found_or_no_access",
      http_status: outcome.http_status,
      reason: `${target.owner}/${target.repo} returned HTTP 404 — the repository does not exist, OR this credential cannot see it (a fine-grained PAT must have this repository selected). GitHub does not distinguish these two cases, and this adapter does not guess.`,
    };
  }
  if (outcome.kind === "failed") {
    return { kind: "failed", http_status: outcome.http_status, reason: outcome.reason };
  }
  if (!isRecord(outcome.body)) {
    return { kind: "failed", http_status: outcome.http_status, reason: "GitHub returned a repository body that was not a JSON object" };
  }

  return {
    kind: "found",
    http_status: outcome.http_status,
    default_branch: stringField(outcome.body, "default_branch"),
    visibility: stringField(outcome.body, "visibility"),
  };
}

export type BranchLookup =
  | { kind: "found"; http_status: number; head_commit_sha: string | null; head_commit_at: string | null; branch_protected: boolean | null }
  | { kind: "absent"; http_status: number; reason: string }
  | { kind: "failed"; http_status: number | null; reason: string };

export async function getBranch(token: string, target: GithubBranchTarget): Promise<BranchLookup> {
  const url = `${GITHUB_API_BASE_URL}/repos/${encodeOwnerRepo(target)}/branches/${encodeRepoPath(target.branch)}`;
  const outcome = await githubGet(token, url);

  if (outcome.kind === "not_found") {
    return { kind: "absent", http_status: outcome.http_status, reason: `branch "${target.branch}" not found in ${target.owner}/${target.repo}` };
  }
  if (outcome.kind === "failed") {
    return { kind: "failed", http_status: outcome.http_status, reason: outcome.reason };
  }
  if (!isRecord(outcome.body)) {
    return { kind: "failed", http_status: outcome.http_status, reason: "GitHub returned a branch body that was not a JSON object" };
  }

  const commit = outcome.body["commit"];
  let headSha: string | null = null;
  let headAt: string | null = null;
  if (isRecord(commit)) {
    headSha = stringField(commit, "sha");
    const innerCommit = commit["commit"];
    if (isRecord(innerCommit)) {
      const committer = innerCommit["committer"];
      if (isRecord(committer)) headAt = stringField(committer, "date");
    }
  }

  return {
    kind: "found",
    http_status: outcome.http_status,
    head_commit_sha: headSha,
    head_commit_at: headAt,
    branch_protected: booleanField(outcome.body, "protected"),
  };
}

export type PathLookup =
  | { kind: "file"; blob_sha: string; size_bytes: number }
  | { kind: "directory"; entries: GithubDirectoryEntry[] }
  | { kind: "absent" }
  | { kind: "failed"; http_status: number | null; reason: string };

/**
 * Metadata for one repo path on one branch. GitHub's `/contents` response
 * for a small file also carries the file's base64 `content`; this function
 * deliberately drops it — reading content back is NOT_YET_BUILT this round
 * (Owner scope decision), and a result type that cannot hold content
 * cannot leak it.
 */
export async function getPathStatus(token: string, target: GithubBranchTarget, normalizedPath: string): Promise<PathLookup> {
  const encodedPath = encodeRepoPath(normalizedPath);
  const pathSuffix = encodedPath.length > 0 ? `/${encodedPath}` : "";
  const url = `${GITHUB_API_BASE_URL}/repos/${encodeOwnerRepo(target)}/contents${pathSuffix}?ref=${encodeURIComponent(target.branch)}`;
  const outcome = await githubGet(token, url);

  if (outcome.kind === "not_found") {
    return { kind: "absent" };
  }
  if (outcome.kind === "failed") {
    return { kind: "failed", http_status: outcome.http_status, reason: outcome.reason };
  }

  if (Array.isArray(outcome.body)) {
    const entries: GithubDirectoryEntry[] = [];
    for (const rawEntry of outcome.body) {
      if (!isRecord(rawEntry)) continue;
      entries.push({
        name: stringField(rawEntry, "name") ?? "",
        path: stringField(rawEntry, "path") ?? "",
        entry_type: stringField(rawEntry, "type") ?? "unknown",
        blob_sha: stringField(rawEntry, "sha") ?? "",
        size_bytes: numberField(rawEntry, "size") ?? 0,
      });
    }
    return { kind: "directory", entries };
  }

  if (!isRecord(outcome.body)) {
    return { kind: "failed", http_status: outcome.http_status, reason: "GitHub returned a contents body that was neither an object nor an array" };
  }

  const entryType = stringField(outcome.body, "type") ?? "unknown";
  if (entryType !== "file") {
    return {
      kind: "failed",
      http_status: outcome.http_status,
      reason: `path "${normalizedPath}" is of GitHub type "${entryType}" — only "file" and directory listings are understood by this adapter today`,
    };
  }

  return {
    kind: "file",
    blob_sha: stringField(outcome.body, "sha") ?? "",
    size_bytes: numberField(outcome.body, "size") ?? 0,
  };
}
