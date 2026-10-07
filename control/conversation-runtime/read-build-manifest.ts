/**
 * หน้าที่: READ-ONLY access to `./dist/build-manifest.json` (Owner UNLOCK
 * 2026-09-06, PROVE_CONVERSATION_RUNTIME_BUILD_IDENTITY). This is the file
 * the RUNNING program (`./main.ts`, and therefore its compiled
 * `./dist/control/conversation-runtime/main.js`) imports to answer "what
 * source revision was I built from" — never
 * `./build-manifest-writer.ts`, which is a build-time-only script this file
 * does not depend on.
 *
 * The manifest sits at `./dist/build-manifest.json`, one directory above
 * where the COMPILED `main.js` lands
 * (`./dist/control/conversation-runtime/main.js`) — a fixed relative
 * position within the SAME build output tree, unlike the earlier
 * `__dirname`-vs-`process.cwd()` bug (see `control/conversation-read-model/store.ts`'s
 * header): both this file and the manifest it reads are always emitted
 * together under `./dist/`, so `__dirname`-relative navigation between them
 * is correct in every environment this runtime ever runs in.
 *
 * Input: none.
 * Output: `readBuildManifest()` — the parsed `BuildManifest`, or `null` with
 * a stated reason when the manifest is missing/unreadable (e.g. the runtime
 * was started without ever running the build script) — never a guessed or
 * cached value standing in for a real one.
 * Dependency ที่อนุญาต: node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนไฟล์นี้ ห้าม cache ค่าข้าม process, ห้ามเติมค่า
 * default ใดๆ เมื่ออ่าน manifest ไม่ได้.
 */

declare const require: any;
declare const __dirname: string;

const fs = require("node:fs");
const path = require("node:path");

export type SyncState = "IN_SYNC" | "LOCAL_AHEAD" | "REMOTE_AHEAD" | "DIVERGED" | "DIRTY_LOCAL" | "UNKNOWN";

export interface BuildManifest {
  readonly PROGRAM_ID: string;
  readonly BUILD_ID: string;
  readonly BUILD_TIME: string;
  readonly BUILD_HASH: string;
  readonly BUILD_FROM_COMMIT: string | null;
  readonly BUILD_FROM_COMMIT_SOURCE: string;
  readonly BUILD_FROM_COMMIT_DIRTY: boolean;
  readonly BUILD_FROM_COMMIT_REASON: string | null;
  readonly SOURCE_REPOSITORY: string;
  readonly SOURCE_PATH: string;
  /**
   * CONNECT_SOURCE_IDENTITY_AND_GITHUB_PROVENANCE_TO_SELF_KNOWLEDGE (Owner
   * UNLOCK 2026-09-07): captured at BUILD TIME by
   * `./build-manifest-writer.ts` from real `git` reads — never re-derived
   * inside this read-only runtime. `null` means the underlying git command
   * genuinely failed/returned nothing (e.g. no upstream configured), never
   * a guess.
   */
  readonly LOCAL_WORKTREE: string | null;
  readonly BRANCH: string | null;
  readonly REMOTE_PROVIDER: string | null;
  readonly REPOSITORY_ID: string | null;
  readonly REMOTE_TRACKING_REF: string | null;
  readonly REMOTE_TRACKING_HEAD: string | null;
  readonly AHEAD_COUNT: number | null;
  readonly BEHIND_COUNT: number | null;
  readonly LAST_FETCH_AT: string | null;
  readonly SYNC_STATE: SyncState;
}

export type ReadBuildManifestResult =
  | { found: true; manifest: BuildManifest; source: string }
  | { found: false; reason: string; source: string };

export function readBuildManifest(): ReadBuildManifestResult {
  const manifestPath = path.join(__dirname, "..", "..", "build-manifest.json");
  const source = manifestPath;
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as BuildManifest;
    if (typeof manifest.PROGRAM_ID !== "string" || typeof manifest.BUILD_HASH !== "string") {
      return { found: false, reason: "build-manifest.json exists but is missing required fields", source };
    }
    return { found: true, manifest, source };
  } catch (error) {
    return { found: false, reason: `could not read build-manifest.json: ${error instanceof Error ? error.message : String(error)}`, source };
  }
}
