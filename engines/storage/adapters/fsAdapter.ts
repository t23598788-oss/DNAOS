/**
 * Storage Intelligence — filesystem adapter. Read-only: stat, walk, hash.
 * Never writes, moves, or deletes — that authority lives only in trashAdapter.ts.
 */
import { readdirSync, statSync, createReadStream, existsSync } from "fs";
import { createHash } from "crypto";
import { join, extname } from "path";

export interface FsEntry {
  path: string;
  size_bytes: number;
  modified_at: string;
  is_directory: boolean;
}

export function walk(rootPath: string, maxDepth = 4, depth = 0): FsEntry[] {
  if (depth > maxDepth || !existsSync(rootPath)) return [];
  let entries: import("fs").Dirent[];
  try {
    entries = readdirSync(rootPath, { withFileTypes: true, encoding: "utf8" as BufferEncoding });
  } catch {
    return [];
  }
  const out: FsEntry[] = [];
  for (const e of entries) {
    const full = join(rootPath, e.name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    out.push({
      path: full,
      size_bytes: st.size,
      modified_at: st.mtime.toISOString(),
      is_directory: e.isDirectory(),
    });
    if (e.isDirectory()) {
      out.push(...walk(full, maxDepth, depth + 1));
    }
  }
  return out;
}

export function dirSizeBytes(path: string): number {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of walk(path, 20)) {
    if (!e.is_directory) total += e.size_bytes;
  }
  return total;
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export function fileExt(path: string): string {
  return extname(path).toLowerCase();
}

export function daysOld(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}
