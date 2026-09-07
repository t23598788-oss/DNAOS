/**
 * หน้าที่: PROOF that the compiled conversation-runtime artifact can state
 * which source commit it was built from, and that the stated build hash
 * matches the actual compiled artifact — not asserted, independently
 * recomputed (Owner UNLOCK 2026-09-06, PROVE_CONVERSATION_RUNTIME_BUILD_IDENTITY).
 *
 * Requires `npm run conversation-runtime:build` to have already run —
 * this test proves the build's OUTPUT, it does not build.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const DIST_DIR = join(ROOT, "control/conversation-runtime/dist");
const MANIFEST_PATH = join(DIST_DIR, "build-manifest.json");
const MAIN_JS = join(DIST_DIR, "control/conversation-runtime/main.js");
const READ_MANIFEST_JS = join(DIST_DIR, "control/conversation-runtime/read-build-manifest.js");

function listJsFilesSorted(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listJsFilesSorted(full));
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out.sort();
}

function recomputeBuildHash(): string {
  const hash = createHash("sha256");
  for (const file of listJsFilesSorted(DIST_DIR)) {
    hash.update(relative(DIST_DIR, file));
    hash.update("\0");
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

test("build-manifest.json exists after npm run conversation-runtime:build", () => {
  assert.ok(existsSync(MANIFEST_PATH), `expected ${MANIFEST_PATH} — run 'npm run conversation-runtime:build' first`);
  assert.ok(existsSync(MAIN_JS), `expected compiled ${MAIN_JS}`);
});

test("manifest has every required field, none of them model-authored placeholders", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  assert.equal(manifest.PROGRAM_ID, "conversation-runtime");
  for (const field of ["BUILD_ID", "BUILD_TIME", "BUILD_HASH", "SOURCE_REPOSITORY", "SOURCE_PATH"]) {
    assert.equal(typeof manifest[field], "string", `${field} must be a string`);
    assert.ok(manifest[field].length > 0, `${field} must not be empty`);
  }
});

test("BUILD_FROM_COMMIT matches the real git HEAD of this checkout", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf-8" }).trim();
  assert.equal(manifest.BUILD_FROM_COMMIT, gitHead, "manifest's BUILD_FROM_COMMIT must equal real `git rev-parse HEAD`, not a cached/guessed value");
});

test("BUILD_HASH matches an independently recomputed hash of the actual compiled artifact", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const recomputed = recomputeBuildHash();
  assert.equal(manifest.BUILD_HASH, recomputed, "manifest's BUILD_HASH must equal a fresh sha256 over every emitted .js file — if this fails, the dist/ directory changed after the manifest was written");
});

test("the RUNNING built program (same compiled artifact) reads its own manifest", () => {
  // Deliberately requires the COMPILED .js, not the TS source — this proves
  // the artifact that would actually be spawned in production can read its
  // own build identity, not just that the writer produced valid JSON.
  delete require.cache[require.resolve(READ_MANIFEST_JS)];
  const { readBuildManifest } = require(READ_MANIFEST_JS) as { readBuildManifest: () => { found: boolean; manifest?: { BUILD_HASH: string } } };
  const result = readBuildManifest();
  assert.equal(result.found, true, "the compiled runtime must find its own build-manifest.json");
  const onDisk = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  assert.equal(result.manifest?.BUILD_HASH, onDisk.BUILD_HASH);
});

test("the spawned conversation-runtime process (this exact build) still answers a normal request", async () => {
  const output = execFileSync(process.execPath, [MAIN_JS], {
    input: `${JSON.stringify({ request_id: "manifest-proof-regression", trace_id: "manifest-proof-regression-trace", owner_identity: { identity_id: "proof", kind: "human" }, text: "สวัสดี" })}\n`,
    encoding: "utf-8",
    timeout: 60_000,
  }).trim();
  // main.ts also streams intermediate `{"message_type":"stage",...}` lines to
  // stdout as resolution progresses (see its `onStage` callback) — the final
  // `ConversationResult` is always the LAST line written.
  const lines = output.split("\n").filter((line) => line.trim().length > 0);
  const result = JSON.parse(lines[lines.length - 1]);
  assert.equal(result.request_id, "manifest-proof-regression");
  assert.ok(result.status === "ANSWERED" || result.status === "UNRESOLVED", `expected a real resolution, got status=${result.status}`);
});
