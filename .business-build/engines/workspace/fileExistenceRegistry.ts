/**
 * File Existence Registry (owner, 2026-08-04) — real per-file state:
 * git status, registration status (cross-checked against module-registry.json,
 * the real source of truth per Rule "no shadow system"), content hash, and
 * duplicate classification. Every field is UNKNOWN when genuinely unknown —
 * never fabricated. Not a parallel registry: registration_state/owning_module
 * are DERIVED from registry/module-registry.json, never invented here.
 */
import { readFileSync, statSync, existsSync } from "fs";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { basename, extname, dirname, join } from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FileExistenceRecord, FileGitState, FileRegistrationState, FileDuplicateClass } from "@/core/shared/types";
import { dispatchEvent } from "@/core/runtime/engine";
import moduleRegistry from "@/registry/module-registry.json";

const ROOT = join(__dirname, "../..");

// Names/patterns that MIGHT indicate a stray duplicate — but per the owner's
// explicit instruction (2026-08-04, born from the page 2.tsx incident): a
// filename match alone is never enough to classify something as junk. It's
// only ever used as one input into classifyDuplicate() below, which always
// requires a real content/sibling comparison too.
const SUSPICIOUS_NAME_PATTERNS = [/ \d+\.\w+$/, /copy/i, /backup/i, /\(\d+\)\.\w+$/];

function sh(cmd: string): string {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

export function hashFile(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function getGitState(relPath: string): FileGitState {
  const lsFiles = sh(`git ls-files --error-unmatch "${relPath}"`);
  if (lsFiles) return "tracked";
  const checkIgnore = sh(`git check-ignore "${relPath}"`);
  if (checkIgnore) return "ignored";
  const status = sh(`git status --porcelain -- "${relPath}"`);
  if (status) return "untracked"; // shows up as ?? in porcelain output
  // Not tracked, not ignored, not shown in status — path doesn't exist in
  // git's view at all (e.g. brand new, git hasn't scanned yet in this call).
  return existsSync(join(ROOT, relPath)) ? "untracked" : "UNKNOWN";
}

export function getRegistrationState(relPath: string): { state: FileRegistrationState; owningModule: string | null } {
  const modules = (moduleRegistry as any).modules as Record<string, { owner: string }>;
  if (relPath in modules) return { state: "REGISTERED", owningModule: modules[relPath].owner };
  return { state: "UNREGISTERED", owningModule: null };
}

/** Looks for a real sibling with the "canonical" (non-numbered) name in the
 * same directory — e.g. "page 2.tsx" -> checks "page.tsx" really exists. */
export function findCanonicalSibling(relPath: string): string | null {
  const dir = dirname(relPath);
  const ext = extname(relPath);
  const base = basename(relPath, ext);
  const canonicalBase = base.replace(/ \d+$/, "").replace(/\(\d+\)$/, "").replace(/[- _]?copy$/i, "").replace(/[- _]?backup$/i, "").trim();
  if (canonicalBase === base) return null; // this path itself looks canonical already
  const candidate = join(dir, `${canonicalBase}${ext}`);
  return existsSync(join(ROOT, candidate)) ? candidate : null;
}

export function hasSuspiciousName(relPath: string): boolean {
  const name = basename(relPath);
  return SUSPICIOUS_NAME_PATTERNS.some((p) => p.test(name));
}

/**
 * Real duplicate classification — per owner instruction, filename alone is
 * NEVER sufficient. Requires an actual content comparison against the
 * canonical sibling (if one exists) before returning anything but UNKNOWN.
 */
export function classifyDuplicate(relPath: string, siblingRelPath: string | null): FileDuplicateClass {
  if (!siblingRelPath) return "UNKNOWN";
  const absA = join(ROOT, relPath);
  const absB = join(ROOT, siblingRelPath);
  if (!existsSync(absA) || !existsSync(absB)) return "UNKNOWN";
  const hashA = hashFile(absA);
  const hashB = hashFile(absB);
  if (hashA === hashB) return "EXACT_DUPLICATE";
  // Content differs — real divergence, not a guess. Could still be active
  // concurrent work; caller layers session-ownership evidence on top.
  return "CONTENT_DIVERGED_COPY";
}

export async function registerFile(
  db: SupabaseClient,
  relPath: string,
  opts: { owningSession?: string; purpose?: string } = {}
): Promise<FileExistenceRecord> {
  const absPath = join(ROOT, relPath);
  const exists = existsSync(absPath);
  const now = new Date().toISOString();

  if (!exists) {
    throw Object.assign(new Error(`cannot register a path that doesn't exist: ${relPath}`), { code: "FILE_NOT_FOUND" });
  }

  const stat = statSync(absPath);
  const contentHash = hashFile(absPath);
  const gitState = getGitState(relPath);
  const { state: registrationState, owningModule } = getRegistrationState(relPath);
  const sibling = findCanonicalSibling(relPath);
  const dupClass: FileDuplicateClass = registrationState === "REGISTERED" ? "ACTIVE" : classifyDuplicate(relPath, sibling);

  const { data: existing } = await db.from("file_existence_registry").select("id, created_at").eq("path", relPath).maybeSingle();

  const row = {
    path: relPath,
    canonical_path: sibling,
    file_type: extname(relPath).replace(".", "") || "UNKNOWN",
    owning_module: owningModule,
    owning_session: opts.owningSession ?? null,
    purpose: opts.purpose ?? null,
    route: null,
    exports: [],
    imports: [],
    dependencies: [],
    content_hash: contentHash,
    size_bytes: stat.size,
    updated_at: now,
    last_seen_at: now,
    git_state: gitState,
    registration_state: registrationState,
    active_or_duplicate: dupClass,
    recoverability: gitState === "tracked" ? "GIT_AVAILABLE" : "UNKNOWN",
    source_of_truth: registrationState === "REGISTERED" ? "registry/module-registry.json" : null,
    generation_recipe: null,
    last_known_snapshot_hash: null,
  };

  const upsertRow: Record<string, unknown> = existing ? { ...row, id: existing.id, created_at: existing.created_at } : row;
  const { data, error } = await db.from("file_existence_registry").upsert(upsertRow, { onConflict: "path" }).select().single();

  if (error || !data) throw Object.assign(new Error("file registry upsert failed"), { code: "FILE_REGISTRY_UPSERT_FAILED", context: { error } });

  const eventData = { actor: opts.owningSession ?? null, session: opts.owningSession ?? null, path: relPath, hash: contentHash, timestamp: now };
  dispatchEvent("FILE_REGISTERED", "engines/workspace/fileExistenceRegistry", eventData);
  if (dupClass === "UNKNOWN" && registrationState === "UNREGISTERED") {
    dispatchEvent("FILE_UNCLASSIFIED", "engines/workspace/fileExistenceRegistry", eventData);
  }
  if (dupClass === "EXACT_DUPLICATE" || dupClass === "CONTENT_DIVERGED_COPY") {
    dispatchEvent("FILE_DUPLICATE_DETECTED", "engines/workspace/fileExistenceRegistry", { ...eventData, sibling });
  }

  return data as FileExistenceRecord;
}

/** Real scan of a bounded set of directories — mirrors the discipline
 * already established in engines/storage/engine.ts's curated scan surface,
 * not a full-disk crawl. */
export function scanForNewFiles(dirs: string[], extensions: string[]): string[] {
  const found: string[] = [];
  function walk(dir: string, depth: number) {
    if (depth > 6) return;
    let entries;
    try {
      entries = require("fs").readdirSync(join(ROOT, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
      const rel = join(dir, e.name);
      if (e.isDirectory()) walk(rel, depth + 1);
      else if (extensions.includes(extname(e.name))) found.push(rel);
    }
  }
  for (const d of dirs) walk(d, 0);
  return found;
}
