/**
 * Real, conflict-safe file writing for /admin/ide's Editor (owner,
 * 2026-08-05, Phase 2). Used only by PUT /api/admin/ide/file. Every write
 * goes through resolveSafeRelativePath() first (same as every read route),
 * then: binary/mixed-newline files are refused, the on-disk file must
 * still match the hash+mtime the client last read (FILE_CONFLICT
 * otherwise), and the write itself is atomic — content lands in a temp
 * file in the SAME directory, then an fs.rename() swaps it into place, so
 * a crash or concurrent read never observes a half-written file. No
 * create/rename/move/delete — this only ever replaces the bytes of a file
 * that already exists at the given path.
 */
import { promises as fs } from "fs";
import { createHash, randomBytes } from "crypto";
import path from "path";
import { IdeFsError, looksBinary } from "./fsSecurity";

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface NewlineInfo {
  hadBOM: boolean;
  style: "LF" | "CRLF";
}

/**
 * Detects BOM and newline style from real on-disk bytes — never guessed.
 * A file with both bare-LF and CRLF line endings present is genuinely
 * ambiguous to preserve correctly; per instruction, that's reported rather
 * than silently normalized.
 */
export function detectNewlineInfo(buf: Buffer): NewlineInfo | null {
  const hadBOM = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const text = buf.toString("utf-8");
  let sawCRLF = false;
  let sawBareLF = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      if (i > 0 && text[i - 1] === "\r") sawCRLF = true;
      else sawBareLF = true;
    }
  }
  if (sawCRLF && sawBareLF) return null; // ambiguous — mixed line endings
  return { hadBOM, style: sawCRLF ? "CRLF" : "LF" };
}

/**
 * Re-applies the ORIGINAL file's BOM/newline style to client-submitted
 * content. Client content always arrives as plain \n (browser textareas
 * normalize on read) with no BOM — this reconstructs what should actually
 * land on disk, so editing one line of a CRLF file doesn't silently
 * rewrite every line ending in the file.
 */
const BOM_CHAR = String.fromCharCode(0xfeff);
export function applyNewlineInfo(content: string, info: NewlineInfo): string {
  let out = content.replace(/\r\n/g, "\n");
  if (out.startsWith(BOM_CHAR)) out = out.slice(1);
  if (info.style === "CRLF") out = out.replace(/\n/g, "\r\n");
  if (info.hadBOM) out = BOM_CHAR + out;
  return out;
}

/**
 * Atomic write: content → temp file in the same directory → fs.rename()
 * into place. Temp file is always cleaned up on failure. Never writes
 * through the target path directly, so a reader never sees partial
 * content and a crash mid-write never corrupts the original file.
 *
 * originalMode (owner, 2026-08-06, Real Editor Write Path Step 1): the
 * rename swaps in a brand-new inode, which would otherwise silently reset
 * permissions to the process umask default — real file mode is preserved
 * by chmod'ing the temp file to match the ORIGINAL file's real mode
 * (caller passes `(await fs.stat(absPath)).mode`) before the rename.
 */
export async function writeFileAtomic(absPath: string, buf: Buffer, originalMode?: number): Promise<void> {
  const dir = path.dirname(absPath);
  const tmpPath = path.join(dir, `.${path.basename(absPath)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await fs.writeFile(tmpPath, buf);
    if (originalMode !== undefined) await fs.chmod(tmpPath, originalMode & 0o777);
    await fs.rename(tmpPath, absPath);
  } catch (e) {
    await fs.unlink(tmpPath).catch(() => {});
    throw new IdeFsError("WRITE_FAILED", (e instanceof Error ? e.message : "") || "write failed");
  }
}

export { looksBinary };
