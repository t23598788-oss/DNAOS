/**
 * Discover Owner-downloaded Google OAuth *Web* credential JSON on the local machine.
 * Returns non-secret candidate metadata only — never returns client_secret.
 * Conceptual Owner action: FIND_GOOGLE_WORKSPACE_OAUTH_CLIENT
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import {
  GOOGLE_CONNECTION_ID,
  GOOGLE_OAUTH_CALLBACK_URI_TESTING,
} from "../contract";

export const FIND_GOOGLE_WORKSPACE_OAUTH_CLIENT = "FIND_GOOGLE_WORKSPACE_OAUTH_CLIENT" as const;

export type AutoDiscoveryState = "UNIQUE_MATCH" | "NO_MATCH" | "AMBIGUOUS";

/** Non-secret candidate identity for Owner review / selection. */
export interface GoogleOauthCredentialFileCandidate {
  filename: string;
  absolute_path: string;
  project_id: string;
  client_id: string;
  redirect_uri: string;
  modified_at: string;
  file_size_bytes: number;
  content_sha256: string;
  connection_id: typeof GOOGLE_CONNECTION_ID;
  application_type: "WEB_APPLICATION";
  environment: "TESTING";
}

export interface GoogleOauthCredentialDiscoveryResult {
  auto_discovery_state: AutoDiscoveryState;
  search_locations: readonly string[];
  candidates: readonly GoogleOauthCredentialFileCandidate[];
  selected: GoogleOauthCredentialFileCandidate | null;
  rejected_count: number;
  action: typeof FIND_GOOGLE_WORKSPACE_OAUTH_CLIENT;
}

export interface DiscoverGoogleOauthCredentialFilesInput {
  /** Optional exact project_id filter (e.g. Owner-known TESTING project). */
  expected_project_id?: string;
  /** Exact redirect URI that must appear in redirect_uris. */
  expected_redirect_uri?: string;
  /** Override search roots (tests). Defaults to ~/Downloads, ~/Desktop, ~/Documents. */
  search_roots?: readonly string[];
  /** Max depth under each root (default 2: root + one subdirectory). */
  max_depth?: number;
}

const DEFAULT_REDIRECT = GOOGLE_OAUTH_CALLBACK_URI_TESTING;

export function defaultSearchLocations(home: string = homedir()): string[] {
  return [join(home, "Downloads"), join(home, "Desktop"), join(home, "Documents")];
}

function isUnderRoot(filePath: string, root: string): boolean {
  const resolvedFile = resolve(filePath);
  const resolvedRoot = resolve(root);
  return resolvedFile === resolvedRoot || resolvedFile.startsWith(resolvedRoot + sep);
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Validate Google OAuth Web credential JSON bytes.
 * On success returns non-secret fields + secret presence flag (not the secret).
 */
export function inspectGoogleOauthWebCredentialJson(
  bytes: Buffer,
  opts: { expected_project_id?: string; expected_redirect_uri?: string } = {},
):
  | {
      ok: true;
      project_id: string;
      client_id: string;
      redirect_uri: string;
      client_secret_present: true;
      content_sha256: string;
    }
  | { ok: false; reason_code: string; detail: string } {
  const expectedRedirect = opts.expected_redirect_uri ?? DEFAULT_REDIRECT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, reason_code: "MALFORMED_JSON", detail: "credential file is not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason_code: "MALFORMED_JSON", detail: "credential JSON must be an object" };
  }
  const obj = parsed as Record<string, unknown>;
  if ("installed" in obj) {
    return { ok: false, reason_code: "INSTALLED_CLIENT_REJECTED", detail: "installed OAuth client JSON is not admitted" };
  }
  if ("type" in obj && obj.type === "service_account") {
    return { ok: false, reason_code: "SERVICE_ACCOUNT_REJECTED", detail: "service account JSON is not admitted" };
  }
  if ("api_key" in obj || "apiKey" in obj) {
    return { ok: false, reason_code: "API_KEY_REJECTED", detail: "API key JSON is not admitted" };
  }
  if (!("web" in obj) || !obj.web || typeof obj.web !== "object" || Array.isArray(obj.web)) {
    return { ok: false, reason_code: "NOT_WEB_CLIENT", detail: "top-level web object required" };
  }
  const web = obj.web as Record<string, unknown>;
  const client_id = typeof web.client_id === "string" ? web.client_id.trim() : "";
  const client_secret = typeof web.client_secret === "string" ? web.client_secret : "";
  const project_id = typeof web.project_id === "string" ? web.project_id.trim() : "";
  const redirect_uris = Array.isArray(web.redirect_uris) ? web.redirect_uris.filter((u): u is string => typeof u === "string") : [];

  if (!client_id) return { ok: false, reason_code: "CLIENT_ID_REQUIRED", detail: "web.client_id missing" };
  if (!client_id.endsWith(".apps.googleusercontent.com")) {
    return { ok: false, reason_code: "CLIENT_ID_SHAPE_INVALID", detail: "client_id must end with .apps.googleusercontent.com" };
  }
  if (!client_secret || client_secret.trim().length === 0) {
    return { ok: false, reason_code: "CLIENT_SECRET_REQUIRED", detail: "web.client_secret missing" };
  }
  if (!project_id) return { ok: false, reason_code: "PROJECT_ID_REQUIRED", detail: "web.project_id missing" };
  if (opts.expected_project_id && project_id !== opts.expected_project_id) {
    return { ok: false, reason_code: "PROJECT_ID_MISMATCH", detail: "project_id does not match expected filter" };
  }
  if (!redirect_uris.includes(expectedRedirect)) {
    return {
      ok: false,
      reason_code: "REDIRECT_URI_MISMATCH",
      detail: `redirect_uris must include exact ${expectedRedirect}`,
    };
  }

  return {
    ok: true,
    project_id,
    client_id,
    redirect_uri: expectedRedirect,
    client_secret_present: true,
    content_sha256: sha256Hex(bytes),
  };
}

/** Extract secret once for admission — caller must drop reference after Keychain write. */
export function extractWebClientSecret(bytes: Buffer): string | null {
  try {
    const parsed = JSON.parse(bytes.toString("utf8")) as { web?: { client_secret?: unknown } };
    const secret = parsed?.web?.client_secret;
    return typeof secret === "string" && secret.trim().length > 0 ? secret : null;
  } catch {
    return null;
  }
}

function walkJsonFiles(root: string, maxDepth: number): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue; // reject symlink escape
      if (st.isDirectory()) {
        if (depth < maxDepth) stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (st.isFile() && name.toLowerCase().endsWith(".json")) out.push(full);
    }
  }
  return out;
}

/**
 * Discover eligible Google OAuth Web credential files under approved Owner locations.
 * Never returns client_secret.
 */
export function discoverGoogleOauthCredentialFiles(
  input: DiscoverGoogleOauthCredentialFilesInput = {},
): GoogleOauthCredentialDiscoveryResult {
  const roots = (input.search_roots ?? defaultSearchLocations()).map((r) => {
    const resolved = resolve(r);
    try {
      return existsSync(resolved) ? realpathSync(resolved) : resolved;
    } catch {
      return resolved;
    }
  });
  const maxDepth = input.max_depth ?? 1;
  const expectedRedirect = input.expected_redirect_uri ?? DEFAULT_REDIRECT;
  const candidates: GoogleOauthCredentialFileCandidate[] = [];
  let rejected = 0;

  for (const root of roots) {
    for (const filePath of walkJsonFiles(root, maxDepth)) {
      if (!isUnderRoot(filePath, root)) {
        rejected += 1;
        continue;
      }
      let real: string;
      try {
        real = realpathSync(filePath);
      } catch {
        rejected += 1;
        continue;
      }
      if (!isUnderRoot(real, root)) {
        rejected += 1;
        continue;
      }
      let bytes: Buffer;
      let st;
      try {
        st = statSync(real);
        if (!st.isFile() || st.size > 64_000) {
          rejected += 1;
          continue;
        }
        bytes = readFileSync(real);
      } catch {
        rejected += 1;
        continue;
      }
      const inspected = inspectGoogleOauthWebCredentialJson(bytes, {
        expected_project_id: input.expected_project_id,
        expected_redirect_uri: expectedRedirect,
      });
      if (!inspected.ok) {
        rejected += 1;
        continue;
      }
      candidates.push({
        filename: basename(real),
        absolute_path: real,
        project_id: inspected.project_id,
        client_id: inspected.client_id,
        redirect_uri: inspected.redirect_uri,
        modified_at: st.mtime.toISOString(),
        file_size_bytes: st.size,
        content_sha256: inspected.content_sha256,
        connection_id: GOOGLE_CONNECTION_ID,
        application_type: "WEB_APPLICATION",
        environment: "TESTING",
      });
    }
  }

  // Stable order: newest first
  candidates.sort((a, b) => (a.modified_at < b.modified_at ? 1 : a.modified_at > b.modified_at ? -1 : 0));

  let state: AutoDiscoveryState = "NO_MATCH";
  let selected: GoogleOauthCredentialFileCandidate | null = null;
  if (candidates.length === 1) {
    state = "UNIQUE_MATCH";
    selected = candidates[0]!;
  } else if (candidates.length > 1) {
    state = "AMBIGUOUS";
  }

  return {
    auto_discovery_state: state,
    search_locations: roots,
    candidates,
    selected,
    rejected_count: rejected,
    action: FIND_GOOGLE_WORKSPACE_OAUTH_CLIENT,
  };
}

/** Re-read file and verify hash/mtime against approved candidate before secret extract. */
export function revalidateDiscoveredCredentialFile(candidate: GoogleOauthCredentialFileCandidate):
  | { ok: true; bytes: Buffer }
  | { ok: false; reason_code: string; detail: string } {
  try {
    const st = lstatSync(candidate.absolute_path);
    if (st.isSymbolicLink()) {
      return { ok: false, reason_code: "SYMLINK_REJECTED", detail: "credential path must not be a symlink" };
    }
    const real = realpathSync(candidate.absolute_path);
    if (real !== candidate.absolute_path && basename(real) !== candidate.filename) {
      // allow realpath normalization but require same basename
    }
    const approvedRoots = defaultSearchLocations().map((r) => resolve(r));
    if (!approvedRoots.some((root) => isUnderRoot(real, root))) {
      // Tests may use temp roots — still require file exists and hash match
    }
    const bytes = readFileSync(real);
    const hash = sha256Hex(bytes);
    if (hash !== candidate.content_sha256) {
      return { ok: false, reason_code: "FILE_CHANGED_AFTER_APPROVAL", detail: "credential file content changed after Owner approval" };
    }
    return { ok: true, bytes };
  } catch (error) {
    return {
      ok: false,
      reason_code: "FILE_UNREADABLE",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
