import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GIT = "/usr/bin/git";
const ALLOWED = new Set([
  "init", "add", "commit", "rev-parse", "remote", "push", "clone", "checkout",
  "hash-object", "log", "status", "config", "update-ref", "show-ref", "ls-remote",
]);

export function git(cwd: string, args: readonly string[]): string {
  const head = args[0];
  if (!head || !ALLOWED.has(head)) {
    throw new Error(`git argv not allowlisted: ${args.join(" ")}`);
  }
  return execFileSync(GIT, args, { cwd, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function initCanonicalFixtureRepo(root: string, marker: string): { sha: string } {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/feature.ts"), `export const FEATURE_MARKER = ${JSON.stringify("BASE")};\n`, "utf8");
  writeFileSync(join(root, "README.md"), `# fixture ${marker}\n`, "utf8");
  git(root, ["init"]);
  git(root, ["config", "user.email", "pipeline-fixture@dna-os.local"]);
  git(root, ["config", "user.name", "DNA OS Pipeline Fixture"]);
  git(root, ["add", "src/feature.ts", "README.md"]);
  git(root, ["commit", "-m", "fixture base"]);
  return { sha: git(root, ["rev-parse", "HEAD"]) };
}

export function initBareRemote(path: string): void {
  mkdirSync(path, { recursive: true });
  git(path, ["init", "--bare"]);
}
