/**
 * หน้าที่: identify the registered DNA OS GitHub SOURCE_AUTHORITY target
 * whose source publication must pass through DNA OS GitHub Publish
 * Authority — never GitHub Contents, never a worker, never a caller-chosen
 * owner/repo.
 *
 * Input: a GitHub owner/repo pair.
 * Output: whether Contents/source-execution write is closed for that target.
 * Dependency ที่อนุญาต: ../../software/repository-registry/contract.ts.
 * สิ่งที่ห้ามแตะ: never invent a GitHub destination. never log credentials.
 */

import { listOperationalRepositories } from "../../software/repository-registry/contract";

export const DNA_OS_PUBLISH_AUTHORITY_REQUIRED = "DNA_OS_PUBLISH_AUTHORITY_REQUIRED" as const;

/**
 * True when this owner/repo is an ACTIVE operational repository with a
 * registered GitHub connection_id. Contents API and executeSource must
 * refuse that target; DNA OS git-push of an admitted commit is the only
 * remaining source-publication door.
 */
export function isRegisteredGithubSourceAuthorityTarget(target: { readonly owner: string; readonly repo: string }): boolean {
  const matches = listOperationalRepositories().filter(
    (row) =>
      row.status === "ACTIVE" &&
      row.connection_id !== null &&
      row.connection_id.length > 0 &&
      row.owner === target.owner &&
      row.repository === target.repo &&
      row.source_authority.includes("github.com"),
  );
  return matches.length === 1;
}
