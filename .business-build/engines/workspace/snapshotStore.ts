/**
 * Content-addressed snapshot store (File Existence Intelligence, owner
 * 2026-08-04). Snapshots live on disk under .dna-os/snapshots/<sha256>/,
 * never inside the DB (file_snapshots only stores metadata + the path).
 *
 * Secret policy: reuses the existing forbidden-hardcode-patterns.json
 * (Hardcode Governance, engines/governance/hardcode-decision-engine.ts's own
 * source of truth for what a secret looks like) rather than inventing a
 * second secret-detection ruleset. If a file's content matches, the snapshot
 * record is still created (so the fact that a secret file EXISTED and WHEN
 * is auditable) but content is never written to disk — is_secret=true,
 * storage_path points to nothing real.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FileSnapshotRecord } from "@/core/shared/types";
import forbiddenPatterns from "@/registry/hardcode-governance/forbidden-hardcode-patterns.json";
import { dispatchEvent } from "@/core/runtime/engine";

const ROOT = join(__dirname, "../..");
const SNAPSHOT_DIR = join(ROOT, ".dna-os", "snapshots");

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function contentLooksLikeSecret(content: string): boolean {
  for (const entry of (forbiddenPatterns as any).entries) {
    try {
      if (new RegExp(entry.pattern).test(content)) return true;
    } catch {
      // malformed pattern in the registry — never crash the snapshot path over it
    }
  }
  return false;
}

export interface CreateSnapshotOpts {
  sessionId?: string;
  command?: string;
  reason?: string;
  relatedModule?: string;
  registryReferences?: string[];
}

export async function createSnapshot(
  db: SupabaseClient,
  originalPath: string,
  content: string,
  opts: CreateSnapshotOpts = {}
): Promise<FileSnapshotRecord> {
  const hash = sha256(content);
  const isSecret = contentLooksLikeSecret(content);
  const dir = join(SNAPSHOT_DIR, hash);
  let storagePath = join(dir, "content");

  if (!isSecret) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(storagePath, content, "utf-8");
  } else {
    storagePath = "REDACTED_SECRET_NEVER_WRITTEN_TO_DISK";
  }

  const record: FileSnapshotRecord = {
    content_hash: hash,
    original_path: originalPath,
    size_bytes: Buffer.byteLength(content, "utf-8"),
    created_at: new Date().toISOString(),
    session_id: opts.sessionId ?? null,
    command: opts.command ?? null,
    reason: opts.reason ?? null,
    related_module: opts.relatedModule ?? null,
    registry_references: opts.registryReferences ?? [],
    storage_path: storagePath,
    is_secret: isSecret,
  };

  await db.from("file_snapshots").upsert({
    content_hash: record.content_hash,
    original_path: record.original_path,
    size_bytes: record.size_bytes,
    session_id: record.session_id,
    command: record.command,
    reason: record.reason,
    related_module: record.related_module,
    registry_references: record.registry_references,
    storage_path: record.storage_path,
    is_secret: record.is_secret,
  });

  if (!isSecret) {
    writeFileSync(join(dir, "metadata.json"), JSON.stringify(record, null, 2), "utf-8");
  }

  dispatchEvent("FILE_SNAPSHOT_CREATED", "engines/workspace/snapshotStore", {
    actor: opts.sessionId ?? null, session: opts.sessionId ?? null, command: opts.command ?? null,
    path: originalPath, hash: hash, timestamp: record.created_at,
  });

  return record;
}

export async function restoreSnapshot(db: SupabaseClient, contentHash: string): Promise<{ ok: boolean; content?: string; reason?: string }> {
  const { data } = await db.from("file_snapshots").select("*").eq("content_hash", contentHash).maybeSingle();
  if (!data) return { ok: false, reason: "no snapshot record found for this hash" };
  if (data.is_secret) return { ok: false, reason: "snapshot content was never written to disk (secret content policy) — cannot restore automatically" };
  const contentPath = join(SNAPSHOT_DIR, contentHash, "content");
  if (!existsSync(contentPath)) return { ok: false, reason: `snapshot metadata exists but content file missing at ${contentPath}` };
  const content = readFileSync(contentPath, "utf-8");
  dispatchEvent("FILE_RESTORED", "engines/workspace/snapshotStore", { path: data.original_path, hash: contentHash, timestamp: new Date().toISOString() });
  return { ok: true, content };
}

export function snapshotExistsOnDisk(contentHash: string): boolean {
  return existsSync(join(SNAPSHOT_DIR, contentHash, "content"));
}
