import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { SourceFreezeV1 } from "./types";
import { nowIso } from "./host-runtime";

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 60_000 }).trim();
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function freezeCurrentSource(input: {
  readonly repository_root: string;
  readonly merge_base: string;
  readonly live_remote_main: string;
}): SourceFreezeV1 {
  const source_branch = git(input.repository_root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const source_head = git(input.repository_root, ["rev-parse", "HEAD"]);
  const tracked = execFileSync("git", ["diff", "HEAD"], { cwd: input.repository_root, encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  const porcelain = git(input.repository_root, ["status", "--porcelain"]);
  const untracked = git(input.repository_root, ["ls-files", "--others", "--exclude-standard"]);
  const changed = git(input.repository_root, ["diff", "--name-only", "HEAD"]);
  const tracked_diff_hash = sha(tracked);
  const porcelain_hash = sha(porcelain);
  const untracked_source_manifest_hash = sha(untracked);
  const changed_path_manifest_hash = sha(changed);
  return {
    schema: "CURRENT_SOURCE_FREEZE_V1",
    source_branch,
    source_head,
    merge_base: input.merge_base,
    live_remote_main: input.live_remote_main,
    tracked_diff_hash,
    porcelain_hash,
    untracked_source_manifest_hash,
    changed_path_manifest_hash,
    source_tree_identity: sha(`${source_head}\n${tracked_diff_hash}\n${porcelain_hash}`),
    porcelain_rows: porcelain.split("\n").filter((line) => line.trim().length > 0).length,
    timestamp: nowIso(),
    CURRENT_SOURCE_PRESERVED: true,
  };
}

export function branchHeadUnchanged(input: {
  readonly repository_root: string;
  readonly freeze: SourceFreezeV1;
}): boolean {
  const branch = git(input.repository_root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = git(input.repository_root, ["rev-parse", "HEAD"]);
  return branch === input.freeze.source_branch && head === input.freeze.source_head;
}
