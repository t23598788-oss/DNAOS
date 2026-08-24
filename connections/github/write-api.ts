/**
 * หน้าที่: speak the real GitHub REST API's Contents write endpoint —
 * `PUT /repos/{owner}/{repo}/contents/{path}` — the one write operation
 * STEP "Build Minimal Source Execution to GitHub" explicitly authorizes
 * (create-or-update one file, one commit, on one already-registered
 * branch). No Pull Request, no branch protection change, no release, no
 * GitHub Actions trigger — none of that exists in this file.
 *
 * This is the ONE outbound write call of this whole capability, using
 * `./host-runtime`'s `hostFetchWrite` (PUT-only, added specifically for
 * this — see that file's header). `./github-read-api.ts`'s `getPathStatus`
 * is reused unmodified first, to discover whether the target path already
 * exists (GitHub's Contents API requires the existing blob `sha` to
 * update a file; omitting it when the file already exists returns a 409,
 * which this function also handles honestly rather than guessing).
 *
 * Input: a resolved token (in memory, from ./credential-resolution.ts),
 * caller-supplied target/path/content/message — never a hardcoded
 * owner/repo/branch (see ../../control/source-execution/README.md for
 * where those real values come from: the caller's own resolved target,
 * never a default in this file).
 * Output: `WriteFileResult`.
 * Dependency ที่อนุญาต: `./adapter-config`, `./host-runtime`, `./repo-path`,
 * `./adapter-contract` (types only), `./github-read-api` (`getPathStatus`
 * only, to discover the existing blob sha before an update).
 * สิ่งที่ห้ามแตะ: **ห้ามใส่ token ลงใน reason string, URL, หรือ log** —
 * token อยู่ใน Authorization header เท่านั้น. ห้ามเพิ่ม intent อื่นนอกจาก
 * "create or update one file" ในไฟล์นี้ — ไม่มี delete, ไม่มี PR, ไม่มี
 * branch creation. ห้าม hardcode owner/repo/branch ค่า default ใดๆ.
 */

import {
  GITHUB_API_BASE_URL,
  GITHUB_REQUEST_TIMEOUT_MILLISECONDS,
  MAX_ERROR_BODY_CHARACTERS,
} from "./adapter-config";
import type { GithubBranchTarget } from "./adapter-contract";
import { hostFetchWrite } from "./host-runtime";
import { githubHeaders, getPathStatus } from "./github-read-api";
import { encodeRepoPath } from "./repo-path";

/** Self-contained, module-scoped ambient — same discipline as ./host-runtime.ts's own declarations (no @types/node in this repo). Only `.from(...).toString("base64")` is used. */
declare const Buffer: { from(input: string, encoding: "utf8"): { toString(encoding: "base64"): string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

export type WriteFileResult =
  | { kind: "written"; http_status: number; commit_sha: string; content_sha: string }
  | { kind: "failed"; http_status: number | null; reason: string };

/**
 * Create-or-update one file at `normalizedPath` on `target.branch`, one
 * commit. `normalizedPath` must already have passed `./repo-path.ts`'s
 * `checkRepoPath` — this function does not re-validate it (that is
 * `control/source-execution/`'s job, once, before calling here).
 */
export async function putFileContents(
  token: string,
  target: GithubBranchTarget,
  normalizedPath: string,
  content: string,
  commitMessage: string,
): Promise<WriteFileResult> {
  // Discover whether this path already exists — GitHub requires the
  // existing blob sha to update a file; a fresh create must omit it.
  const existing = await getPathStatus(token, target, normalizedPath);
  if (existing.kind === "failed") {
    return { kind: "failed", http_status: existing.http_status, reason: `could not determine whether "${normalizedPath}" already exists before writing: ${existing.reason}` };
  }
  if (existing.kind === "directory") {
    return { kind: "failed", http_status: null, reason: `"${normalizedPath}" is a directory on GitHub, not a file — refusing to write over it` };
  }
  const existingSha = existing.kind === "file" ? existing.blob_sha : null;

  const encodedPath = encodeRepoPath(normalizedPath);
  const url = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${encodedPath}`;
  const body = JSON.stringify({
    message: commitMessage,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch: target.branch,
    ...(existingSha !== null ? { sha: existingSha } : {}),
  });

  const headers = { ...githubHeaders(token), "Content-Type": "application/json" };
  const attempt = await hostFetchWrite(url, headers, body, GITHUB_REQUEST_TIMEOUT_MILLISECONDS);

  if (attempt.kind === "transport_error") {
    return { kind: "failed", http_status: null, reason: `no HTTP response from GitHub while writing "${normalizedPath}" (network, DNS, TLS, or timeout): ${attempt.reason}` };
  }

  const response = attempt.response;
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const raw = await response.text();
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isRecord(parsed)) {
          const parsedMessage = stringField(parsed, "message");
          if (parsedMessage !== null) message = `HTTP ${response.status}: ${parsedMessage.slice(0, MAX_ERROR_BODY_CHARACTERS)}`;
        }
      } catch {
        message = `HTTP ${response.status}: ${raw.slice(0, MAX_ERROR_BODY_CHARACTERS)}`;
      }
    } catch {
      // Body unreadable — report the bare status.
    }
    return { kind: "failed", http_status: response.status, reason: message };
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch (error) {
    return { kind: "failed", http_status: response.status, reason: `HTTP ${response.status} but the body was not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isRecord(responseBody)) {
    return { kind: "failed", http_status: response.status, reason: "GitHub returned a write response that was not a JSON object" };
  }

  const commit = responseBody["commit"];
  const commitSha = isRecord(commit) ? stringField(commit, "sha") : null;
  const contentInfo = responseBody["content"];
  const contentSha = isRecord(contentInfo) ? stringField(contentInfo, "sha") : null;

  if (commitSha === null || contentSha === null) {
    return { kind: "failed", http_status: response.status, reason: "GitHub's write response did not include both a commit.sha and a content.sha" };
  }

  return { kind: "written", http_status: response.status, commit_sha: commitSha, content_sha: contentSha };
}
