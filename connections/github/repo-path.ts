/**
 * หน้าที่: validate and URL-encode a repository-relative path before it is
 * put into a GitHub API URL. Two separate jobs that both belong to
 * "handling a repo path", kept in their own file because they are pure,
 * separately testable, and are the safety boundary between caller-supplied
 * data and a URL this capability builds.
 *
 * Why encoding is its own function and not `encodeURIComponent(path)`:
 * `encodeURIComponent` turns "/" into "%2F", which destroys the path
 * structure the GitHub Contents API expects. Each SEGMENT is encoded and
 * the separators are kept — the correct behaviour, verified live against
 * the real API (see ./adapter.test.ts).
 *
 * Input: a caller-supplied path string.
 * Output: `RepoPathCheck`, `encodeRepoPath`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามผ่อนกฎให้ ".." หรือ path ที่ขึ้นต้นด้วย "/" ผ่านไป
 * ได้ — เส้นทางนั้นคือทางที่ command หนึ่งจะอ้างออกนอกขอบเขตที่ระบุไว้.
 * ไฟล์นี้ห้ามแตะ filesystem ของเครื่อง — มันตรวจ "path ใน repo ปลายทาง"
 * ไม่ใช่ path ในเครื่อง
 */

export type RepoPathCheck = { ok: true; normalized: string } | { ok: false; reason: string };

const MAX_PATH_CHARACTERS = 1000;
const MAX_SEGMENT_CHARACTERS = 255;

/**
 * @param allowRoot when true, `""` is accepted and means "the repository
 * root directory" (used by read-status, where asking about the root is a
 * real question).
 */
export function checkRepoPath(raw: unknown, options?: { allowRoot?: boolean }): RepoPathCheck {
  if (typeof raw !== "string") {
    return { ok: false, reason: `path must be a string, received ${typeof raw}` };
  }

  const path = raw.trim();

  if (path.length === 0) {
    return options?.allowRoot === true
      ? { ok: true, normalized: "" }
      : { ok: false, reason: "path is empty" };
  }

  if (path.length > MAX_PATH_CHARACTERS) {
    return { ok: false, reason: `path is longer than ${MAX_PATH_CHARACTERS} characters` };
  }

  if (path.startsWith("/")) {
    return { ok: false, reason: `path "${path}" must be repository-relative and must not start with "/"` };
  }

  if (path.includes("\\")) {
    return { ok: false, reason: `path "${path}" contains a backslash — repository paths always use "/"` };
  }

  // Control characters have no legitimate place in a repo path and would corrupt the request URL.
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return { ok: false, reason: `path contains a control character at position ${index}` };
    }
  }

  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      return { ok: false, reason: `path "${path}" has an empty segment (leading, trailing, or doubled "/")` };
    }
    if (segment === "." || segment === "..") {
      return { ok: false, reason: `path "${path}" contains a "${segment}" segment — relative traversal is never allowed` };
    }
    if (segment === ".git") {
      return { ok: false, reason: `path "${path}" targets the ".git" directory, which this adapter never touches` };
    }
    if (segment.length > MAX_SEGMENT_CHARACTERS) {
      return { ok: false, reason: `path "${path}" has a segment longer than ${MAX_SEGMENT_CHARACTERS} characters` };
    }
  }

  return { ok: true, normalized: path };
}

/** Encode each segment, keep the "/" separators. Only ever call this with a `normalized` value from `checkRepoPath`. */
export function encodeRepoPath(normalizedPath: string): string {
  if (normalizedPath.length === 0) return "";
  return normalizedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
