/**
 * Local filesystem adapter — scoped search/metadata/read plus contained create/copy/move/rename/delete.
 * Never force-deletes. Never follows symlink escapes. Never accepts absolute Owner paths.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { resourceAbsoluteRoot } from "./resource-registry";
import { classifyLocalFile, fileKind, logicalRef, resolveLogicalPath, resolveLogicalTarget, withinWriteScope } from "./path-scope";
import { recordTransferIntegrity, type TransferOpResult } from "./transfer-integrity";
import type { LocalResourceV1 } from "./types";

function walkFiles(root: string, rel = ""): string[] {
  const here = rel ? join(root, rel) : root;
  const out: string[] = [];
  for (const name of readdirSync(here)) {
    if (name === ".git") continue;
    const childRel = rel ? `${rel}/${name}` : name;
    const abs = join(root, childRel);
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...walkFiles(root, childRel));
    else out.push(childRel);
  }
  return out;
}

export function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export function filesSearch(resource: LocalResourceV1, query: string, maxMatches = 20): { ok: true; matches: readonly Record<string, unknown>[]; files_read_count: number } | { ok: false; reason_code: string } {
  const root = resourceAbsoluteRoot(resource);
  if (!root) return { ok: false, reason_code: "RESOURCE_HAS_NO_ROOT" };
  const needle = query.slice(0, 200);
  const matches: Record<string, unknown>[] = [];
  let files_read_count = 0;
  for (const rel of walkFiles(root)) {
    if (classifyLocalFile(rel) === "CREDENTIAL" || classifyLocalFile(rel) === "SECRET") continue;
    const abs = join(root, rel);
    const text = readFileSync(abs, "utf8");
    files_read_count += 1;
    if (!text.includes(needle) && !rel.includes(needle)) continue;
    const lineNo = text.split("\n").findIndex((line) => line.includes(needle)) + 1;
    matches.push({
      logical_ref: logicalRef(resource.resource_id, rel),
      line: lineNo > 0 ? lineNo : null,
      snippet: text.split("\n").find((line) => line.includes(needle))?.slice(0, 160) ?? rel,
    });
    if (matches.length >= maxMatches) break;
  }
  return { ok: true, matches, files_read_count };
}

export function folderList(resource: LocalResourceV1, logicalPath = ""): { ok: true; items: readonly Record<string, unknown>[] } | { ok: false; reason_code: string } {
  const resolved = logicalPath ? resolveLogicalPath(resource, logicalPath) : (() => {
    const root = resourceAbsoluteRoot(resource);
    if (!root) return { ok: false as const, reason_code: "RESOURCE_HAS_NO_ROOT" as const };
    return { ok: true as const, abs: root, logical: "", existed: true };
  })();
  if (!resolved.ok) return { ok: false, reason_code: resolved.reason_code };
  if (!statSync(resolved.abs).isDirectory()) return { ok: false, reason_code: "NOT_A_FOLDER" };
  const items = readdirSync(resolved.abs).filter((name) => name !== ".git").map((name) => {
    const childLogical = resolved.logical ? `${resolved.logical}/${name}` : name;
    return { logical_ref: logicalRef(resource.resource_id, childLogical), name, kind: fileKind(join(resolved.abs, name)) };
  });
  return { ok: true, items };
}

export function filesMetadata(resource: LocalResourceV1, logicalPath: string): { ok: true; metadata: Record<string, unknown> } | { ok: false; reason_code: string } {
  const resolved = resolveLogicalPath(resource, logicalPath);
  if (!resolved.ok) return { ok: false, reason_code: resolved.reason_code };
  const st = statSync(resolved.abs);
  return {
    ok: true,
    metadata: {
      logical_ref: logicalRef(resource.resource_id, resolved.logical),
      kind: fileKind(resolved.abs),
      bytes: st.size,
      sha256: st.isFile() ? sha256File(resolved.abs) : null,
      modified_at: st.mtime.toISOString(),
      classification: classifyLocalFile(resolved.logical),
      data_class: classifyDataClass(resolved.logical, resolved.abs),
    },
  };
}

function classifyDataClass(logical: string, abs: string): string {
  const lower = logical.toLowerCase();
  if (statSync(abs).isDirectory()) return "FOLDER";
  if (lower.endsWith(".pdf")) return "PDF";
  if (/\.(png|jpe?g|gif|webp)$/.test(lower)) return "IMAGE";
  if (/\.(json|csv|tsv)$/.test(lower)) return "STRUCTURED_DATA";
  if (/\.(md|txt|rtf)$/.test(lower)) return "TEXT";
  if (/\.(docx?|pages)$/.test(lower)) return "DOCUMENT";
  return "FILE";
}

export function filesReadRange(resource: LocalResourceV1, logicalPath: string, start = 0, length = 4096): { ok: true; payload: Record<string, unknown>; files_read_count: 1 } | { ok: false; reason_code: string } {
  const resolved = resolveLogicalPath(resource, logicalPath);
  if (!resolved.ok) return { ok: false, reason_code: resolved.reason_code };
  if (classifyLocalFile(resolved.logical) === "SECRET" || classifyLocalFile(resolved.logical) === "CREDENTIAL") {
    return { ok: false, reason_code: "SECRET_EGRESS_DENIED" };
  }
  if (statSync(resolved.abs).isDirectory()) return { ok: false, reason_code: "NOT_A_FILE" };
  const buf = readFileSync(resolved.abs);
  const slice = buf.subarray(Math.max(0, start), Math.max(0, start) + Math.min(length, 8192));
  return {
    ok: true,
    files_read_count: 1,
    payload: {
      logical_ref: logicalRef(resource.resource_id, resolved.logical),
      start,
      length: slice.length,
      text: slice.toString("utf8"),
      source_bytes: buf.length,
    },
  };
}

export function fileCreate(resource: LocalResourceV1, logicalPath: string, content: string): { ok: true; payload: Record<string, unknown> } | { ok: false; reason_code: string } {
  const dest = resolveLogicalTarget(resource, logicalPath, { must_exist: false });
  if (!dest.ok) return { ok: false, reason_code: dest.reason_code };
  if (!withinWriteScope(resource, dest.abs)) return { ok: false, reason_code: "WRITE_SCOPE_DENIED" };
  if (existsSync(dest.abs)) return { ok: false, reason_code: "DESTINATION_EXISTS" };
  mkdirSync(dirname(dest.abs), { recursive: true });
  writeFileSync(dest.abs, content, { flag: "wx" });
  return {
    ok: true,
    payload: {
      logical_ref: logicalRef(resource.resource_id, dest.logical),
      bytes: Buffer.byteLength(content),
      sha256: sha256File(dest.abs),
      side_effects: ["CREATE_FILE"],
    },
  };
}

export function folderCreate(resource: LocalResourceV1, logicalPath: string): { ok: true; payload: Record<string, unknown> } | { ok: false; reason_code: string } {
  const dest = resolveLogicalTarget(resource, logicalPath, { must_exist: false });
  if (!dest.ok) return { ok: false, reason_code: dest.reason_code };
  if (!withinWriteScope(resource, dest.abs)) return { ok: false, reason_code: "WRITE_SCOPE_DENIED" };
  if (existsSync(dest.abs)) return { ok: false, reason_code: "DESTINATION_EXISTS" };
  mkdirSync(dest.abs, { recursive: true });
  return { ok: true, payload: { logical_ref: logicalRef(resource.resource_id, dest.logical), side_effects: ["CREATE_FOLDER"] } };
}

export function fileCopy(source: LocalResourceV1, dest: LocalResourceV1, sourceLogical: string, destLogical: string): TransferOpResult {
  const src = resolveLogicalPath(source, sourceLogical);
  if (!src.ok) return { ok: false, reason_code: src.reason_code };
  const dst = resolveLogicalTarget(dest, destLogical, { must_exist: false });
  if (!dst.ok) return { ok: false, reason_code: dst.reason_code };
  if (!withinWriteScope(dest, dst.abs)) return { ok: false, reason_code: "WRITE_SCOPE_DENIED" };
  if (!statSync(src.abs).isFile()) return { ok: false, reason_code: "NOT_A_FILE" };
  if (existsSync(dst.abs)) return { ok: false, reason_code: "DESTINATION_EXISTS" };
  mkdirSync(dirname(dst.abs), { recursive: true });
  const source_hash = sha256File(src.abs);
  copyFileSync(src.abs, dst.abs);
  const destination_hash = sha256File(dst.abs);
  const bytes = statSync(dst.abs).size;
  const verified = source_hash === destination_hash && bytes === statSync(src.abs).size;
  const record = recordTransferIntegrity({
    source_resource_id: source.resource_id,
    destination_resource_id: dest.resource_id,
    source_logical: src.logical,
    destination_logical: dst.logical,
    source_hash,
    destination_hash,
    bytes_transferred: bytes,
    transfer_kind: "LOCAL",
    verified,
    side_effects: ["COPY_FILE"],
  });
  if (!verified) {
    unlinkSync(dst.abs);
    return { ok: false, reason_code: "TRANSFER_INTEGRITY_FAILED", record };
  }
  return { ok: true, record };
}

export function fileMove(source: LocalResourceV1, dest: LocalResourceV1, sourceLogical: string, destLogical: string): TransferOpResult {
  const src = resolveLogicalPath(source, sourceLogical);
  if (!src.ok) return { ok: false, reason_code: src.reason_code };
  const dst = resolveLogicalTarget(dest, destLogical, { must_exist: false });
  if (!dst.ok) return { ok: false, reason_code: dst.reason_code };
  if (!withinWriteScope(source, src.abs) || !withinWriteScope(dest, dst.abs)) return { ok: false, reason_code: "WRITE_SCOPE_DENIED" };
  if (!statSync(src.abs).isFile()) return { ok: false, reason_code: "NOT_A_FILE" };
  if (existsSync(dst.abs)) return { ok: false, reason_code: "DESTINATION_EXISTS" };
  mkdirSync(dirname(dst.abs), { recursive: true });
  const source_hash = sha256File(src.abs);
  const bytes = statSync(src.abs).size;
  renameSync(src.abs, dst.abs);
  const destination_hash = sha256File(dst.abs);
  const verified = source_hash === destination_hash && !existsSync(src.abs);
  const record = recordTransferIntegrity({
    source_resource_id: source.resource_id,
    destination_resource_id: dest.resource_id,
    source_logical: src.logical,
    destination_logical: dst.logical,
    source_hash,
    destination_hash,
    bytes_transferred: bytes,
    transfer_kind: "LOCAL",
    verified,
    side_effects: ["MOVE_FILE"],
  });
  if (!verified) return { ok: false, reason_code: "TRANSFER_INTEGRITY_FAILED", record };
  return { ok: true, record };
}

export function fileRename(resource: LocalResourceV1, sourceLogical: string, destLogical: string): TransferOpResult {
  return fileMove(resource, resource, sourceLogical, destLogical);
}

export function fileDelete(resource: LocalResourceV1, logicalPath: string): { ok: true; payload: Record<string, unknown> } | { ok: false; reason_code: string } {
  const resolved = resolveLogicalPath(resource, logicalPath);
  if (!resolved.ok) return { ok: false, reason_code: resolved.reason_code };
  if (!withinWriteScope(resource, resolved.abs)) return { ok: false, reason_code: "WRITE_SCOPE_DENIED" };
  const st = lstatSync(resolved.abs);
  if (st.isDirectory()) return { ok: false, reason_code: "DIRECTORY_DELETE_NOT_ALLOWED" };
  if (st.isSymbolicLink()) return { ok: false, reason_code: "SYMLINK_DELETE_DENIED" };
  const before = { sha256: sha256File(resolved.abs), bytes: st.size, logical: resolved.logical };
  unlinkSync(resolved.abs);
  return {
    ok: true,
    payload: {
      logical_ref: logicalRef(resource.resource_id, resolved.logical),
      before,
      after: { exists: existsSync(resolved.abs) },
      force: false,
      side_effects: ["DELETE_FILE"],
    },
  };
}
