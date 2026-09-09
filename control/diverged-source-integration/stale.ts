import { execFileSync } from "node:child_process";

export function readLiveRemoteMainSha(repositoryRoot: string): string | null {
  try {
    const out = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 30_000,
    }).trim();
    const sha = out.split(/\s+/)[0];
    return sha && /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function remoteHeadState(expected: string, live: string | null): "MATCH" | "BASE_STALE" | "REMOTE_HEAD_MOVED" | "UNAVAILABLE" {
  if (!live) return "UNAVAILABLE";
  if (live.toLowerCase() === expected.toLowerCase()) return "MATCH";
  return "REMOTE_HEAD_MOVED";
}

export function newDevelopmentBaseAllowed(proposedBase: string, registeredCanonical: string): boolean {
  return proposedBase.toLowerCase() === registeredCanonical.toLowerCase();
}
