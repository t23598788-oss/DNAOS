/**
 * หน้าที่: the DNA OS startup/setup check — inspect required developer
 * tools + provider connections + authorization, and report exactly what's
 * missing. Never forces a fresh login when an existing credential is
 * still valid (a CONNECTED record with a `connected` ConnectionRegistration
 * is left untouched — this file only READS state, never re-triggers
 * authorization itself).
 *
 * Input: none (reads real local git + the real stores).
 * Output: `runGithubBootstrapCheck`, `BootstrapCheckResult`.
 * Dependency ที่อนุญาต: ./types.ts, ./store.ts, ./plugin-status.ts,
 * ../connection-registry/contract.ts.
 */

import type { BootstrapCheckResult, BootstrapRequirement } from "./types";
import { discoverGitRemote, buildConnectionId } from "../connection-registry/contract";
import { buildGithubPluginStatus } from "./plugin-status";

const GITHUB_ADAPTER = "github";
const GITHUB_CONNECTION_TYPE = "SOURCE_AUTHORITY";

export async function runGithubBootstrapCheck(cwd: string): Promise<BootstrapCheckResult> {
  const requirements: BootstrapRequirement[] = [];

  const discovered = await discoverGitRemote(cwd);
  requirements.push({
    requirement: "local git repository with a GitHub remote",
    satisfied: discovered.ok,
    detail: discovered.ok ? `${discovered.value.owner}/${discovered.value.repository}@${discovered.value.branch}` : `${discovered.reason}: ${discovered.detail}`,
    owner_action: discovered.ok ? null : "run this from inside a real git repository with a GitHub 'origin' remote",
  });

  if (!discovered.ok) {
    return { ready: false, requirements };
  }

  const connectionId = buildConnectionId({ adapter: GITHUB_ADAPTER, connection_type: GITHUB_CONNECTION_TYPE, target: discovered.value });
  const status = buildGithubPluginStatus(connectionId);

  requirements.push({
    requirement: "GitHub integration authorized",
    satisfied: status.plugin_status === "READY",
    detail: `login_status=${status.login_status}, plugin_status=${status.plugin_status}, authorization_status=${status.authorization_status}`,
    owner_action: status.plugin_status === "READY" ? null : "เชื่อมต่อ GitHub",
  });

  return { ready: requirements.every((r) => r.satisfied), requirements };
}
