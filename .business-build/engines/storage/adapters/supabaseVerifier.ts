/**
 * Storage Intelligence — Supabase Storage verification adapter.
 *
 * Honest limitation, stated per Rule 100 (must record what's real): this repo
 * has no existing convention mapping a local file path to a specific Supabase
 * Storage bucket+object (no manifest table, no naming contract). Until one
 * exists, verifyLocalFileBackedUp() can only return { verified: false } for
 * every local file — it does NOT guess. What IS real and working here:
 * verifyObjectExists(), which checks a real bucket+path against Supabase
 * Storage (existence, size, checksum via ETag) — usable the moment a caller
 * (this engine or another) actually knows which object corresponds to which
 * local file.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseObjectVerification {
  verified: boolean;
  bucket: string;
  path: string;
  exists: boolean;
  size_bytes: number | null;
  checksum: string | null;
  readable: boolean;
  reason: string;
}

export async function verifyObjectExists(
  supabase: SupabaseClient,
  bucket: string,
  objectPath: string,
  expectedSha256?: string
): Promise<SupabaseObjectVerification> {
  const dir = objectPath.includes("/") ? objectPath.slice(0, objectPath.lastIndexOf("/")) : "";
  const name = objectPath.includes("/") ? objectPath.slice(objectPath.lastIndexOf("/") + 1) : objectPath;

  const { data: listData, error: listErr } = await supabase.storage.from(bucket).list(dir, { search: name });
  if (listErr || !listData || listData.length === 0) {
    return {
      verified: false,
      bucket,
      path: objectPath,
      exists: false,
      size_bytes: null,
      checksum: null,
      readable: false,
      reason: listErr ? `list error: ${listErr.message}` : "object not found in bucket",
    };
  }
  const entry = listData.find((f) => f.name === name);
  if (!entry) {
    return {
      verified: false,
      bucket,
      path: objectPath,
      exists: false,
      size_bytes: null,
      checksum: null,
      readable: false,
      reason: "object not found in bucket listing",
    };
  }

  const { data: dl, error: dlErr } = await supabase.storage.from(bucket).download(objectPath);
  const readable = !dlErr && !!dl;

  const etag = (entry.metadata as Record<string, unknown> | undefined)?.eTag as string | undefined;
  const checksum = etag ? etag.replace(/"/g, "") : null;
  const sizeMatches = expectedSha256 ? undefined : undefined; // no local hash comparison without a manifest — see file header

  const verified = readable && !!entry && (!expectedSha256 || checksum === expectedSha256);

  return {
    verified,
    bucket,
    path: objectPath,
    exists: true,
    size_bytes: (entry.metadata as Record<string, unknown> | undefined)?.size as number ?? null,
    checksum,
    readable,
    reason: verified
      ? "object exists, readable, checksum matched (or none required)"
      : expectedSha256 && checksum !== expectedSha256
        ? "checksum mismatch — do not treat local copy as redundant"
        : "object exists but not confirmed readable",
  };
}

/** No manifest convention exists yet — always returns unverified, never guesses. */
export async function verifyLocalFileBackedUp(_localPath: string): Promise<SupabaseObjectVerification> {
  return {
    verified: false,
    bucket: "",
    path: "",
    exists: false,
    size_bytes: null,
    checksum: null,
    readable: false,
    reason: "no local-file-to-Supabase-object mapping convention exists in this codebase — classification stays UNKNOWN, never guessed",
  };
}
