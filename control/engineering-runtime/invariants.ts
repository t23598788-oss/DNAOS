/**
 * หน้าที่: machine-readable source-publication invariants. These are
 * architecture, not prompt instructions. External AI / models / workers
 * cannot override them.
 *
 * Input: none.
 * Output: closed authority and write-path constants.
 * Dependency ที่อนุญาต: none.
 */

export const SOURCE_PUBLICATION_INVARIANTS = {
  ENGINEERING_CODING: "VERIFIED",
  ADMISSION: "VERIFIED",
  LOCAL_INTEGRATION: "VERIFIED",
  DNA_OS_COMMIT: "DNA_OS_ONLY",
  GITHUB_PUBLISH: "DNA_OS_ONLY",
  EXTERNAL_AI_SOURCE_WRITE: "DENIED_BY_ARCHITECTURE",
  DEPLOYMENT: "NOT_WIRED",
  AUTHORITATIVE_GITHUB_WRITE_PATH: "control/engineering-runtime/github-publish-authority.ts#publishDnaOsCommit",
  AUTHORITATIVE_GITHUB_WRITE_PATH_COUNT: 1,
  MODEL_ROLE: "language_and_intent_producer_only",
} as const;

export const EXTERNAL_AI_MAY = [
  "read permitted authoritative knowledge",
  "produce structured Engineering Intent",
  "submit work through DNA OS Tool / Authority",
] as const;

export const EXTERNAL_AI_MAY_NOT = [
  "select repository filesystem paths as authority",
  "write authoritative source directly",
  "commit",
  "push",
  "use GitHub write credentials",
  "deploy",
] as const;
