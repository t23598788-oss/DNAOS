/**
 * หน้าที่: the deterministic classification rules Repository Discovery
 * evaluates against — pure functions over `relative_path`/`file_name`/
 * `extension` only, no filesystem access, no AI, no guessing a file's
 * purpose from its name beyond fixed, well-known conventions (exact
 * filenames like `package.json`, exact directory segments like `tests`,
 * exact extensions like `.md`). Evaluated in one fixed priority order —
 * see `classifyFile()` — so the same input always produces the same
 * `FileKind`, every run.
 *
 * Input: none (pure data + one classification function).
 * Output: `classifyFile`, `isHidden`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never add a rule that inspects file content — classification
 * here is path/name/extension only, matching this round's read-only,
 * non-mutating discovery scope.
 */

import type { FileKind } from "./types";

const TEMP_EXTENSIONS = new Set(["tmp", "temp", "swp", "swo", "bak", "orig"]);
const SOURCE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "sh"]);
const DOCUMENTATION_EXTENSIONS = new Set(["md", "mdx"]);
const DATA_EXTENSIONS = new Set(["json", "jsonl", "csv", "yaml", "yml"]);
const CONFIG_FILENAMES = new Set(["package.json", "tsconfig.json", ".gitignore", ".npmrc", ".nvmrc"]);
const GENERATED_FILENAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

export function isHidden(fileName: string): boolean {
  return fileName.startsWith(".");
}

function isTemp(fileName: string, extension: string): boolean {
  if (fileName === ".DS_Store") return true;
  if (TEMP_EXTENSIONS.has(extension)) return true;
  if (fileName.startsWith("~$")) return true;
  if (fileName.startsWith(".#")) return true;
  if (fileName.endsWith("~")) return true;
  return false;
}

/** software/registry-database/data/runs/** are mechanically-emitted, per-process historical snapshots — generated output, distinct from the live canonical/ state (RUNTIME_DATA). */
function isGenerated(fileName: string, relativePath: string): boolean {
  if (GENERATED_FILENAMES.has(fileName)) return true;
  if (relativePath.includes("/data/runs/")) return true;
  return false;
}

/** Any real "data" directory segment (e.g. control/agent-gateway/data/, software/registry-database/data/canonical/, connections/os-ui/data/) plus this repo's two other known live-state roots — local-runtime/ and audit/ — never a name guess, always an exact segment match. */
function isRuntimeData(relativePath: string): boolean {
  if (relativePath.includes("/data/runs/")) return false; // GENERATED, not live RUNTIME_DATA — see isGenerated above
  const segments = relativePath.split("/");
  if (segments.includes("data")) return true;
  if (segments[0] === "local-runtime") return true;
  if (segments[0] === "audit") return true;
  return false;
}

function isMigration(relativePath: string, extension: string): boolean {
  return extension === "sql" && relativePath.includes("/migrations/");
}

function isTest(relativePath: string, fileName: string): boolean {
  const segments = relativePath.split("/");
  if (segments.includes("tests") || segments.includes("test")) return true;
  if (/\.(test|spec)\./.test(fileName)) return true;
  return false;
}

function isDocumentation(extension: string): boolean {
  return DOCUMENTATION_EXTENSIONS.has(extension);
}

function isConfig(fileName: string, extension: string): boolean {
  if (CONFIG_FILENAMES.has(fileName)) return true;
  if (fileName.startsWith(".env")) return true;
  if (/\.config\.(js|ts|mjs|cjs|json)$/.test(fileName)) return true;
  if (fileName.startsWith(".eslintrc")) return true;
  return extension === "json" && fileName === "tsconfig.json";
}

function isSourceCode(extension: string): boolean {
  return SOURCE_EXTENSIONS.has(extension);
}

function isData(extension: string): boolean {
  return DATA_EXTENSIONS.has(extension);
}

/**
 * Fixed priority order — first matching rule wins, every call, same
 * input -> same output:
 * TEMP -> GENERATED -> RUNTIME_DATA -> MIGRATION -> TEST -> DOCUMENTATION
 * -> CONFIG -> SOURCE_CODE -> DATA -> UNKNOWN.
 */
export function classifyFile(relativePath: string, fileName: string, extension: string): FileKind {
  if (isTemp(fileName, extension)) return "TEMP";
  if (isGenerated(fileName, relativePath)) return "GENERATED";
  if (isRuntimeData(relativePath)) return "RUNTIME_DATA";
  if (isMigration(relativePath, extension)) return "MIGRATION";
  if (isTest(relativePath, fileName)) return "TEST";
  if (isDocumentation(extension)) return "DOCUMENTATION";
  if (isConfig(fileName, extension)) return "CONFIG";
  if (isSourceCode(extension)) return "SOURCE_CODE";
  if (isData(extension)) return "DATA";
  return "UNKNOWN";
}
