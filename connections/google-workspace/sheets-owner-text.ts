/**
 * Parse Owner free-text into Sheets read input hints.
 * Does not invent spreadsheet_id or range — only extracts what the Owner stated.
 */

export interface SheetsOwnerTextParse {
  readonly spreadsheet_id: string | null;
  readonly spreadsheet_name: string | null;
  readonly range: string | null;
  readonly sheet_tab: string | null;
}

const SHEETS_MIME = "application/vnd.google-apps.spreadsheet";

export const GOOGLE_SHEETS_MIME_TYPE = SHEETS_MIME;

/** Google Drive / Sheets file ids are long url-safe strings. */
const ID_RE = /\b(?:spreadsheet\s+id|spreadsheet_id|id)\s*[:=]?\s*([a-zA-Z0-9_-]{25,})\b/i;

/** A1 range with optional sheet: Sheet1!A1:D20 or 'My Sheet'!A1:D20 or A1:D20 */
const RANGE_WITH_SHEET_RE = /(?:'([^']+)'|([A-Za-z][A-Za-z0-9_]{0,63}))!([A-Za-z]+\d+(?::[A-Za-z]+\d+)?)/;
const BARE_A1_RE = /\b([A-Za-z]+\d+:[A-Za-z]+\d+)\b/;

const RESERVED_READ_WORDS = new Set(["values", "rows", "cells", "data", "content", "range"]);

export function parseSheetsOwnerText(text: string): SheetsOwnerTextParse {
  const raw = text.trim();
  if (!raw) {
    return { spreadsheet_id: null, spreadsheet_name: null, range: null, sheet_tab: null };
  }

  let spreadsheet_id: string | null = null;
  let spreadsheet_name: string | null = null;
  let range: string | null = null;
  let sheet_tab: string | null = null;

  const idMatch = raw.match(ID_RE);
  if (idMatch?.[1]) spreadsheet_id = idMatch[1];

  // Explicit "range ..." clause wins when present
  const explicitRange = raw.match(/\brange\s*[:=]?\s*('.+?'![A-Za-z0-9:]+|[A-Za-z0-9_]+![A-Za-z0-9:]+|[A-Za-z]+\d+:[A-Za-z]+\d+|[A-Za-z][A-Za-z0-9_]{0,63})\b/i);
  if (explicitRange?.[1]) {
    const r = stripTrailingPunct(explicitRange[1]);
    if (r.includes("!")) {
      range = r.replace(/^'|'$/g, (m, i, s) => (i === 0 || i === s.length - 1 ? "" : m));
      // normalize quotes: 'My Sheet'!A1:B2
      const qm = r.match(/^'([^']+)'!(.+)$/) || r.match(/^([^!]+)!(.+)$/);
      if (qm) {
        sheet_tab = qm[1];
        range = `${qm[1]}!${qm[2]}`;
      }
    } else if (BARE_A1_RE.test(r)) {
      range = r;
    } else if (!RESERVED_READ_WORDS.has(r.toLocaleLowerCase())) {
      sheet_tab = r;
    }
  }

  if (!range) {
    const withSheet = raw.match(RANGE_WITH_SHEET_RE);
    if (withSheet) {
      const tab = (withSheet[1] || withSheet[2] || "").trim();
      if (tab && !RESERVED_READ_WORDS.has(tab.toLocaleLowerCase())) {
        sheet_tab = tab;
        range = `${tab}!${withSheet[3]}`;
      }
    }
  }
  if (!range) {
    const bare = raw.match(BARE_A1_RE);
    if (bare?.[1]) range = bare[1];
  }

  // "Read Sheet1 from spreadsheet <name>" — not "Read values from spreadsheet"
  const fromSheet = raw.match(/\bread\s+([A-Za-z0-9][A-Za-z0-9_-]{0,63})\s+from\s+spreadsheet\s+(.+)$/i);
  if (fromSheet) {
    const tab = fromSheet[1].trim();
    if (!RESERVED_READ_WORDS.has(tab.toLocaleLowerCase())) {
      if (!sheet_tab) sheet_tab = tab;
    }
    if (!spreadsheet_id && !spreadsheet_name) {
      spreadsheet_name = stripTrailingPunct(fromSheet[2]);
    }
  }

  if (!spreadsheet_id && !spreadsheet_name) {
    const nameMatch =
      raw.match(/\bspreadsheet\s+(?!id\b)["']([^"']+)["']/i)
      || raw.match(/\bspreadsheet\s+(?!id\b)([^,.\n]+?)(?:\s*,\s*range\b|\s+range\b|\s*$)/i);
    if (nameMatch?.[1]) {
      const candidate = stripTrailingPunct(nameMatch[1]);
      if (!/^id\b/i.test(candidate) && candidate.length > 0) {
        spreadsheet_name = candidate;
      }
    }
  }

  // "Read A1:D20 from spreadsheet Budget" — name may remain after A1 extraction
  if (!spreadsheet_id && !spreadsheet_name) {
    const a1From = raw.match(/\bfrom\s+spreadsheet\s+(.+)$/i);
    if (a1From?.[1]) spreadsheet_name = stripTrailingPunct(a1From[1]);
  }

  return { spreadsheet_id, spreadsheet_name, range, sheet_tab };
}

function stripTrailingPunct(s: string): string {
  return s.trim().replace(/[.,;:]+$/g, "").trim();
}

export function buildSpreadsheetDriveQuery(spreadsheetName: string | null): string {
  const mime = `mimeType='${SHEETS_MIME}'`;
  const notTrashed = "trashed=false";
  if (!spreadsheetName || spreadsheetName.trim() === "") {
    return `${mime} and ${notTrashed}`;
  }
  const escaped = spreadsheetName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `${mime} and name contains '${escaped}' and ${notTrashed}`;
}
