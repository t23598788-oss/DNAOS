/**
 * หน้าที่: compares ONE real source reference against what DNA-OS-BLUEPRINT
 * claims about it, and classifies the difference (Owner, 2026-08-26).
 *
 * It classifies. It does not reconcile. No function in this file edits a
 * document or a source file, and none may be added: a contradiction between
 * the design and the implementation is a decision for the Owner, not something
 * to be smoothed over by whichever side is easier to rewrite.
 *
 * Input: a repo-relative source path + the exported symbol expected there.
 * Output: `ConformanceFinding` per Blueprint claim that cites it.
 * Dependency ที่อนุญาต: ./blueprint-index.ts, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนไฟล์ใดๆ — ทั้งฝั่ง source และฝั่งเอกสาร.
 */

declare const require: any;

import { readBlueprintReferences } from "./blueprint-index";

const fs = require("node:fs");

export type ConformanceStatus =
  | "MATCH"
  | "SOURCE_NEWER_THAN_BLUEPRINT"
  | "BLUEPRINT_NEWER_THAN_SOURCE"
  | "CONTRADICTION"
  | "MISSING_BLUEPRINT_REFERENCE"
  | "MISSING_SOURCE_REFERENCE";

export interface ConformanceFinding {
  status: ConformanceStatus;
  source_path: string;
  symbol: string | null;
  blueprint_document: string | null;
  blueprint_section: string | null;
  blueprint_claim: string | null;
  blueprint_revision: string | null;
  difference: string;
}

/** Does `symbol` really appear within ±3 lines of `line` in `file`? The same tolerance the Blueprint's own claim verifier uses. */
function symbolNearLine(file: string, line: number, symbol: string): boolean {
  if (!fs.existsSync(file)) return false;
  try {
    const lines = String(fs.readFileSync(file, "utf8")).split("\n");
    return lines.slice(Math.max(0, line - 4), line + 3).some((text: string) => text.includes(symbol));
  } catch {
    return false;
  }
}

/**
 * One source reference in, every Blueprint claim about it out, each classified.
 * `MISSING_BLUEPRINT_REFERENCE` is a real result, not an error: it means the
 * implementation exists and the design says nothing about it.
 */
/**
 * A Blueprint line can MENTION one file while making its claim about another
 * (e.g. a sentence about `transport/.../server.ts` that also names
 * `observability/joint-monitor/client.ts`). Classifying those as
 * contradictions produced six false ones on the first run — the claim was
 * never a statement about the queried file. Only claims whose own
 * `[SOURCE: <file>...]` IS the queried file are classified; the rest are
 * counted as co-mentions and reported as such.
 */
function claimIsAboutFile(sourceReference: string, sourcePath: string): boolean {
  const cited = sourceReference.replace(/[`]/g, "").trim().split(/[\s:]/)[0];
  return cited === sourcePath;
}

export function compareSourceToBlueprint(sourcePath: string, symbol: string | null): readonly ConformanceFinding[] {
  const sourceExists = fs.existsSync(sourcePath);
  const read = readBlueprintReferences(sourcePath);

  if (!read.reachable) {
    return [{ status: "MISSING_BLUEPRINT_REFERENCE", source_path: sourcePath, symbol, blueprint_document: null, blueprint_section: null, blueprint_claim: null, blueprint_revision: null, difference: read.reason }];
  }
  if (read.references.length === 0) {
    return [{
      status: sourceExists ? "MISSING_BLUEPRINT_REFERENCE" : "MISSING_SOURCE_REFERENCE",
      source_path: sourcePath, symbol, blueprint_document: null, blueprint_section: null, blueprint_claim: null, blueprint_revision: null,
      difference: sourceExists ? "the source exists and no Blueprint claim cites it" : "neither the source nor any Blueprint claim exists for this reference",
    }];
  }

  const aboutThisFile = read.references.filter((reference) => claimIsAboutFile(reference.source_reference, sourcePath));
  if (aboutThisFile.length === 0) {
    return [{ status: "MISSING_BLUEPRINT_REFERENCE", source_path: sourcePath, symbol, blueprint_document: read.references[0].document_id, blueprint_section: read.references[0].section, blueprint_claim: read.references[0].claim, blueprint_revision: read.references[0].revision, difference: `${read.references.length} Blueprint line(s) mention this path, but none make a [SOURCE:] claim about it` }];
  }

  return aboutThisFile.map((reference) => {
    // The Blueprint writes some claims with the path in backticks
    // (`file.ts:271`) and some without. Stripping them is not interpretation —
    // it is reading the syntax that repository actually uses. Found when an
    // unstripped backtick was passed to readFileSync and threw ENOENT.
    const citedRaw = reference.source_reference.replace(/[`]/g, "").trim();
    const cited = citedRaw.match(/^([^\s:]+):(\d+)(?:-\d+)?\s*(.*)$/);
    if (!sourceExists) {
      return { status: "MISSING_SOURCE_REFERENCE" as const, source_path: sourcePath, symbol, blueprint_document: reference.document_id, blueprint_section: reference.section, blueprint_claim: reference.claim, blueprint_revision: reference.revision, difference: "the Blueprint cites a source file that does not exist" };
    }
    if (!cited) {
      return { status: "MATCH" as const, source_path: sourcePath, symbol, blueprint_document: reference.document_id, blueprint_section: reference.section, blueprint_claim: reference.claim, blueprint_revision: reference.revision, difference: "referenced without a line/symbol claim — nothing line-level to disagree about" };
    }
    const [, citedFile, citedLine, citedSymbol] = cited;
    const wanted = (citedSymbol || symbol || "").split(/\s+/)[0];
    if (!wanted) {
      return { status: "MATCH" as const, source_path: sourcePath, symbol, blueprint_document: reference.document_id, blueprint_section: reference.section, blueprint_claim: reference.claim, blueprint_revision: reference.revision, difference: "no symbol claimed" };
    }
    const stillThere = symbolNearLine(citedFile, Number(citedLine), wanted);
    if (stillThere) {
      return { status: "MATCH" as const, source_path: sourcePath, symbol, blueprint_document: reference.document_id, blueprint_section: reference.section, blueprint_claim: reference.claim, blueprint_revision: reference.revision, difference: `"${wanted}" is at ${citedFile}:${citedLine} as claimed` };
    }
    const citedFileExists = fs.existsSync(citedFile);
    if (!citedFileExists) {
      return { status: "MISSING_SOURCE_REFERENCE" as const, source_path: sourcePath, symbol, blueprint_document: reference.document_id, blueprint_section: reference.section, blueprint_claim: reference.claim, blueprint_revision: reference.revision, difference: `the Blueprint cites ${citedFile}, which does not exist in this repository` };
    }
    const existsElsewhere = String(fs.readFileSync(citedFile, "utf8")).includes(wanted);
    return {
      // The symbol still exists, just not where the document says: the source
      // moved on and the document has not. That is not a contradiction about
      // WHAT the system does — only about where it is written.
      status: existsElsewhere ? ("SOURCE_NEWER_THAN_BLUEPRINT" as const) : ("CONTRADICTION" as const),
      source_path: sourcePath, symbol, blueprint_document: reference.document_id, blueprint_section: reference.section, blueprint_claim: reference.claim, blueprint_revision: reference.revision,
      difference: existsElsewhere
        ? `"${wanted}" is no longer near ${citedFile}:${citedLine} but still exists in that file — the line reference is stale`
        : `"${wanted}" is not in ${citedFile} at all — the design and the implementation disagree about what exists`,
    };
  });
}
