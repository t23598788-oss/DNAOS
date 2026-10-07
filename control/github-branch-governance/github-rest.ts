/**
 * GET-only GitHub REST for branch governance discovery.
 * Does not create rulesets, protection, statuses, or commits.
 */

import {
  GITHUB_ACCEPT_HEADER,
  GITHUB_API_BASE_URL,
  GITHUB_API_VERSION,
  GITHUB_REQUEST_TIMEOUT_MILLISECONDS,
  GITHUB_USER_AGENT,
} from "../../connections/github/adapter-config";
import { githubHeaders } from "../../connections/github/github-read-api";
import { hostFetch } from "../../connections/github/host-runtime";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type GovernanceGet =
  | { kind: "ok"; http_status: number; body: unknown }
  | { kind: "failed"; http_status: number | null; reason: string; plan_feature_unavailable: boolean };

export async function githubGovernanceGet(token: string, path: string): Promise<GovernanceGet> {
  const url = `${GITHUB_API_BASE_URL}${path}`;
  const attempt = await hostFetch(url, githubHeaders(token), GITHUB_REQUEST_TIMEOUT_MILLISECONDS);
  if (attempt.kind === "transport_error") {
    return { kind: "failed", http_status: null, reason: attempt.reason, plan_feature_unavailable: false };
  }
  const response = attempt.response;
  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }
  const message = isRecord(body) && typeof body.message === "string" ? body.message : `HTTP ${response.status}`;
  if (response.status >= 400) {
    const plan = /Upgrade to GitHub Pro|make this repository public to enable this feature/i.test(message);
    return { kind: "failed", http_status: response.status, reason: message, plan_feature_unavailable: plan };
  }
  return { kind: "ok", http_status: response.status, body };
}

export const GOVERNANCE_READ_HEADERS = {
  Accept: GITHUB_ACCEPT_HEADER,
  "X-GitHub-Api-Version": GITHUB_API_VERSION,
  "User-Agent": GITHUB_USER_AGENT,
} as const;
