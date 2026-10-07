/**
 * หน้าที่: the READ boundary to DNA-OS-BLUEPRINT — a declared EXTERNAL
 * knowledge source, not a copy (Owner, 2026-08-26).
 *
 * NOTHING FROM THAT REPOSITORY IS COPIED HERE. This file holds a path, a
 * parser for the claim syntax that repository already uses, and read
 * functions. If the external repository is absent, every read reports
 * NO_RUNTIME_CONTRACT — it does not fall back to a cached or embedded copy,
 * because a stale embedded copy is exactly the failure this boundary exists to
 * prevent.
 *
 * READ ONLY. There is no write function in this file and there must not be
 * one: document mutation is a separate, Owner-approved step (AUTO_UPDATE_BLUEPRINT=NO).
 *
 * The claim syntax parsed here is the Blueprint's own, unchanged:
 *   [SOURCE: <repo-relative path>:<line> <symbol>]
 *   [GAP: <id>] · [UNVERIFIABLE: ...] · [AMBIGUOUS: ...]
 * plus `_SOURCE_SYMBOL_INDEX.md`'s symbol table.
 *
 * Input: `DNA_OS_BLUEPRINT_PATH` (env) or the default checkout location; a
 * source reference (repo-relative path, or a symbol name).
 * Output: `BlueprintReference[]` with document_id/path/section/claim/
 * source_reference/revision, or an explicit unreachable status.
 * Dependency ที่อนุญาต: node built-ins only.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามคัดลอกเอกสารจาก DNA-OS-BLUEPRINT เข้ามาในเรโปนี้.
 * - ห้ามเขียนอะไรกลับไปยังเรโปนั้นจากไฟล์นี้.
 * - ห้าม fallback ไปหาสำเนาเก่าเมื่ออ่านของจริงไม่ได้.
 */

declare const require: any;
declare const process: { env: Record<string, string | undefined> };

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DEFAULT_BLUEPRINT_PATH = "/Users/tam/Desktop/DNA-OS-BLUEPRINT";

export interface BlueprintReference {
  document_id: string;
  repository: string;
  path: string;
  section: string;
  claim: string;
  source_reference: string;
  implementation_reference: string | null;
  verification_reference: string | null;
  revision: string;
}

export type BlueprintReadResult =
  | { reachable: true; references: readonly BlueprintReference[]; source: string }
  | { reachable: false; reason: string; source: string };

function blueprintRoot(): string {
  return process.env.DNA_OS_BLUEPRINT_PATH ?? DEFAULT_BLUEPRINT_PATH;
}

/** The external repository's own commit, so a reference can be pinned to the revision it was read from. */
function blueprintRevision(root: string): string {
  try {
    return String(execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" })).trim();
  } catch {
    return "UNKNOWN_REVISION";
  }
}

export function blueprintReadPathStatus(): { reachable: boolean; detail: string } {
  const root = blueprintRoot();
  const docs = path.join(root, "blueprint");
  if (!fs.existsSync(docs)) {
    return { reachable: false, detail: `NO_RUNTIME_CONTRACT: no blueprint/ directory at ${root} (set DNA_OS_BLUEPRINT_PATH)` };
  }
  return { reachable: true, detail: `external knowledge source at ${root} (revision ${blueprintRevision(root)}), read-only` };
}

function listBlueprintDocs(docsDir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
    const full = path.join(docsDir, entry.name);
    if (entry.isDirectory()) out.push(...listBlueprintDocs(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** Nearest preceding markdown heading — the Blueprint's own sectioning, not an invented one. */
function sectionFor(lines: string[], index: number): string {
  for (let i = index; i >= 0; i--) {
    const heading = lines[i].match(/^#{1,4}\s+(.*)$/);
    if (heading) return heading[1].trim();
  }
  return "(no heading)";
}

/**
 * QUERY -> DOCUMENT INDEX. Lookup key: a source reference — a repo-relative
 * path, or a symbol name. Returns every Blueprint claim that cites it.
 */
export function readBlueprintReferences(sourceReference: string): BlueprintReadResult {
  const root = blueprintRoot();
  const docsDir = path.join(root, "blueprint");
  const status = blueprintReadPathStatus();
  if (!status.reachable) return { reachable: false, reason: status.detail, source: root };

  const revision = blueprintRevision(root);
  const references: BlueprintReference[] = [];
  const needle = sourceReference.toLocaleLowerCase();

  for (const file of listBlueprintDocs(docsDir)) {
    const lines = String(fs.readFileSync(file, "utf8")).split("\n");
    lines.forEach((line: string, index: number) => {
      if (!line.toLocaleLowerCase().includes(needle)) return;
      // Only lines that actually carry a claim marker count — a passing mention
      // in prose is not a machine-checkable reference.
      const sourceClaim = line.match(/\[SOURCE:\s*([^\]]+)\]/);
      const unverifiable = line.match(/\[UNVERIFIABLE:\s*([^\]]+)\]/);
      const gap = line.match(/\[GAP:\s*([^\]]+)\]/);
      if (!sourceClaim && !unverifiable && !gap) return;
      references.push({
        document_id: path.basename(file),
        repository: "DNA-OS-BLUEPRINT",
        path: path.relative(root, file),
        section: sectionFor(lines, index),
        claim: line.trim().slice(0, 400),
        source_reference: sourceClaim ? sourceClaim[1].trim() : sourceReference,
        implementation_reference: sourceClaim ? sourceClaim[1].trim().split(/\s+/)[0] : null,
        verification_reference: unverifiable ? `UNVERIFIABLE: ${unverifiable[1].trim()}` : gap ? `GAP: ${gap[1].trim()}` : null,
        revision: `${revision}#L${index + 1}`,
      });
    });
  }

  return { reachable: true, references, source: `${root}/blueprint (revision ${revision})` };
}
