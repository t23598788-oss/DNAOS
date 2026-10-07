/**
 * หน้าที่: answer "has this exact commit already been verified?" by reading the
 * verification records this capability itself wrote — nothing more.
 *
 * WHY IT IS SEPARATE FROM ./resolver.ts: `runPostCommitVerification` RUNS the
 * checks, and running them needs a task_id and a persisted SUCCEEDED
 * source-execution record for the artifact. A later reader — a reload deciding
 * whether it may act unattended — has a commit sha and nothing else, and must
 * not be able to trigger a verification just by asking about one. This file is
 * read-only: it can report a verdict that already exists and can never produce
 * one.
 *
 * Input: a commit sha (and the repo it must exist in).
 * Output: `findVerificationForCommit`.
 * Dependency ที่อนุญาต: ../agent-gateway/contract.ts (evidence read), ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้ามให้ไฟล์นี้รัน check, สร้าง record, หรือคืน VERIFIED
 * ที่ไม่ได้อ่านมาจาก record จริง.
 */
import { execFileSync } from "node:child_process";
import { loadAllEvidence } from "../agent-gateway/contract";
import type { PostCommitVerificationResult } from "./types";

/**
 * The evidence store holds real verifications AND test fixtures — measured
 * 2026-08-26: of 10 distinct commit_sha values across 208
 * post_commit_verification records, exactly ONE is a commit that exists in this
 * repository. The rest are fixture values like "sha-b", and some are
 * well-formed 40-hex strings that are not commits at all.
 *
 * That is fine for a store whose readers ask "what happened for task X". It is
 * not fine for a reader asking "may I restart a live service unattended",
 * because a fixture sha that happened to collide with a real HEAD would hand
 * out authority. So the sha is checked against git itself before any record for
 * it is returned: a verdict is only about a commit that exists.
 */
function isRealCommit(sha: string, repoRoot: string): boolean {
  if (!/^[0-9a-f]{40}$/.test(sha)) return false;
  try {
    execFileSync("/usr/bin/git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repoRoot, stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

/**
 * The most recent verification record for this commit, or null. A commit with
 * several records — a re-run after a fix — is answered by its LAST one, the
 * same way the task store answers with the latest record for a task.
 */
export function findVerificationForCommit(commitSha: string, repoRoot: string = process.cwd()): PostCommitVerificationResult | null {
  if (!isRealCommit(commitSha, repoRoot)) return null;
  const matches = loadAllEvidence()
    .filter((e) => e.kind === "post_commit_verification")
    .map((e) => e.payload as PostCommitVerificationResult)
    .filter((p) => p !== null && typeof p === "object" && p.commit_sha === commitSha);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}
