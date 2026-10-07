/**
 * หน้าที่: turn a `CommandEnvelope.payload` (typed `unknown` by
 * `../../contracts/command/command-envelope.ts`, on purpose) into a
 * checked, typed payload — or into a reason why it is not one. Real
 * runtime validation, not a cast: everything crossing this boundary comes
 * from outside this capability, so nothing about its shape is assumed.
 *
 * Input: an unknown payload.
 * Output: `PayloadCheck<T>` for each intent this adapter answers.
 * Dependency ที่อนุญาต: `../../contracts/connector/connection.ts`,
 * `./adapter-contract`, `./adapter-config`, `./repo-path`.
 * สิ่งที่ห้ามแตะ: ห้ามใช้ `as` cast แทนการตรวจจริงในไฟล์นี้ — ถ้าตรวจไม่ได้
 * ต้องคืน reason ไม่ใช่ปล่อยผ่าน. ห้ามยอมรับ payload ที่มี field ชื่อ
 * token/secret/credential ค่าจริง — credential เดินทางผ่านชื่อ env var
 * ใน `credential_ref` เท่านั้น
 */

import type { ConnectionRegistration } from "../../contracts/connector/connection";
import { MAX_STATUS_PATHS_PER_COMMAND } from "./adapter-config";
import type { GithubBranchTarget, GithubCheckAccessPayload, GithubReadStatusPayload, GithubRepoTarget } from "./adapter-contract";
import { checkRepoPath } from "./repo-path";

export type PayloadCheck<T> = { ok: true; value: T } | { ok: false; reason: string };

const CONNECTION_STATUSES = ["disconnected", "connecting", "connected", "error"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A payload may legitimately carry a connection whose `credential_ref` is
 * `{ kind: "not_yet_built" }` — that is a structurally VALID registration
 * that simply has no credential yet. It is rejected later, at the
 * authenticate stage (see ./credential-resolution.ts), not here, so the
 * two failures stay distinguishable in the RoutingResult.
 */
export function checkConnectionRegistration(raw: unknown): PayloadCheck<ConnectionRegistration> {
  if (!isRecord(raw)) return { ok: false, reason: "payload.connection is missing or is not an object" };

  const connectionId = nonEmptyString(raw, "connection_id");
  if (connectionId === null) return { ok: false, reason: "payload.connection.connection_id is missing or empty" };

  const accountId = nonEmptyString(raw, "account_id");
  if (accountId === null) return { ok: false, reason: "payload.connection.account_id is missing or empty" };

  const softwareId = nonEmptyString(raw, "software_id");
  if (softwareId === null) return { ok: false, reason: "payload.connection.software_id is missing or empty" };

  const adapter = nonEmptyString(raw, "adapter");
  if (adapter === null) return { ok: false, reason: "payload.connection.adapter is missing or empty" };

  const status = raw["status"];
  if (typeof status !== "string" || !CONNECTION_STATUSES.includes(status as (typeof CONNECTION_STATUSES)[number])) {
    return { ok: false, reason: `payload.connection.status must be one of ${CONNECTION_STATUSES.join(" | ")}` };
  }

  const credentialRef = raw["credential_ref"];
  if (!isRecord(credentialRef)) return { ok: false, reason: "payload.connection.credential_ref is missing or is not an object" };

  const refKind = credentialRef["kind"];
  let resolvedRef: ConnectionRegistration["credential_ref"];
  if (refKind === "env_var") {
    const name = nonEmptyString(credentialRef, "name");
    if (name === null) return { ok: false, reason: 'payload.connection.credential_ref.kind is "env_var" but credential_ref.name is missing or empty' };
    resolvedRef = { kind: "env_var", name };
  } else if (refKind === "not_yet_built") {
    resolvedRef = { kind: "not_yet_built" };
  } else {
    return { ok: false, reason: `payload.connection.credential_ref.kind must be "env_var" or "not_yet_built", received ${JSON.stringify(refKind)}` };
  }

  return {
    ok: true,
    value: {
      connection_id: connectionId,
      account_id: accountId,
      software_id: softwareId,
      adapter,
      credential_ref: resolvedRef,
      status: status as ConnectionRegistration["status"],
    },
  };
}

function checkRepoTarget(raw: unknown): PayloadCheck<GithubRepoTarget> {
  if (!isRecord(raw)) return { ok: false, reason: "payload.target is missing or is not an object" };

  const owner = nonEmptyString(raw, "owner");
  if (owner === null) return { ok: false, reason: "payload.target.owner is missing or empty" };
  if (owner.includes("/")) return { ok: false, reason: `payload.target.owner "${owner}" must be a single name, not a path` };

  const repo = nonEmptyString(raw, "repo");
  if (repo === null) return { ok: false, reason: "payload.target.repo is missing or empty" };
  if (repo.includes("/")) return { ok: false, reason: `payload.target.repo "${repo}" must be a single name, not "owner/repo"` };

  return { ok: true, value: { owner, repo } };
}

function checkBranchTarget(raw: unknown): PayloadCheck<GithubBranchTarget> {
  const repoTarget = checkRepoTarget(raw);
  if (!repoTarget.ok) return repoTarget;

  const record = raw as Record<string, unknown>;
  const branch = nonEmptyString(record, "branch");
  if (branch === null) {
    // No default branch is ever assumed — guessing "main" would make this adapter silently read a branch the caller never named.
    return { ok: false, reason: "payload.target.branch is missing or empty — this adapter never assumes a default branch" };
  }
  const branchCheck = checkRepoPath(branch);
  if (!branchCheck.ok) return { ok: false, reason: `payload.target.branch is not a usable ref: ${branchCheck.reason}` };

  return { ok: true, value: { ...repoTarget.value, branch: branchCheck.normalized } };
}

export function checkCheckAccessPayload(raw: unknown): PayloadCheck<GithubCheckAccessPayload> {
  if (!isRecord(raw)) return { ok: false, reason: "payload is missing or is not an object" };

  const connection = checkConnectionRegistration(raw["connection"]);
  if (!connection.ok) return connection;

  const target = checkRepoTarget(raw["target"]);
  if (!target.ok) return target;

  return { ok: true, value: { connection: connection.value, target: target.value } };
}

export function checkReadStatusPayload(raw: unknown): PayloadCheck<GithubReadStatusPayload> {
  if (!isRecord(raw)) return { ok: false, reason: "payload is missing or is not an object" };

  const connection = checkConnectionRegistration(raw["connection"]);
  if (!connection.ok) return connection;

  const target = checkBranchTarget(raw["target"]);
  if (!target.ok) return target;

  const rawPaths = raw["paths"];
  if (rawPaths === undefined) {
    return { ok: true, value: { connection: connection.value, target: target.value } };
  }
  if (!Array.isArray(rawPaths)) {
    return { ok: false, reason: "payload.paths must be an array of strings when present" };
  }
  if (rawPaths.length > MAX_STATUS_PATHS_PER_COMMAND) {
    return { ok: false, reason: `payload.paths has ${rawPaths.length} entries — one command may ask about at most ${MAX_STATUS_PATHS_PER_COMMAND}` };
  }

  const paths: string[] = [];
  for (let index = 0; index < rawPaths.length; index += 1) {
    // "" is allowed here and means the repository root — a real question to ask about a repo's status.
    const pathCheck = checkRepoPath(rawPaths[index], { allowRoot: true });
    if (!pathCheck.ok) return { ok: false, reason: `payload.paths[${index}] is invalid: ${pathCheck.reason}` };
    paths.push(pathCheck.normalized);
  }

  return { ok: true, value: { connection: connection.value, target: target.value, paths } };
}
