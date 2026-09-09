/**
 * Map Owner free-text to a Google Workspace READ intent.
 * Used by the existing submitOwnerCommand forward path — not a second classifier.
 */

import { GOOGLE_WORKSPACE_INTENTS, type GoogleWorkspaceReadIntent } from "./adapter-contract";

export function resolveGoogleWorkspaceReadIntentFromText(text: string): GoogleWorkspaceReadIntent | null {
  const n = text.toLocaleLowerCase();
  if (n.includes("gmail") || (n.includes("mail") && n.includes("message"))) {
    if (/\bsearch\b/.test(n) || n.includes("หา")) return GOOGLE_WORKSPACE_INTENTS.gmailSearch;
    if (/\bread\b/.test(n) || n.includes("เปิด")) return GOOGLE_WORKSPACE_INTENTS.gmailRead;
    return GOOGLE_WORKSPACE_INTENTS.gmailList;
  }
  if (n.includes("calendar") || n.includes("event") || n.includes("ปฏิทิน")) {
    if (n.includes("calendar list") || (n.includes("calendars") && !n.includes("event"))) {
      return GOOGLE_WORKSPACE_INTENTS.calendarList;
    }
    return GOOGLE_WORKSPACE_INTENTS.calendarEventsList;
  }
  if (n.includes("drive") || (n.includes("google") && (n.includes("file") || n.includes("ไฟล์")))) {
    if (/\bfind\b/.test(n) || /\bsearch\b/.test(n) || n.includes("หา")) return GOOGLE_WORKSPACE_INTENTS.driveSearch;
    if (n.includes("content") || n.includes("download")) return GOOGLE_WORKSPACE_INTENTS.driveContent;
    if (n.includes("metadata")) return GOOGLE_WORKSPACE_INTENTS.driveMetadata;
    return GOOGLE_WORKSPACE_INTENTS.driveList;
  }
  if (n.includes("sheet") || n.includes("spreadsheet") || n.includes("ชีต")) {
    if (n.includes("value") || n.includes("range") || n.includes("read") || n.includes("อ่าน")) {
      return GOOGLE_WORKSPACE_INTENTS.sheetsValues;
    }
    return GOOGLE_WORKSPACE_INTENTS.sheetsMetadata;
  }
  return null;
}
