/**
 * Safe category labels from public bundle ids / app names. Never reads user documents.
 */

import type { ApplicationCategory } from "./types";

export function classifyApplicationCategory(bundle_id: string, display_name: string): ApplicationCategory {
  const id = bundle_id.toLowerCase();
  const name = display_name.toLowerCase();
  if (id.includes("finder") || name === "finder.app") return "FILE_MANAGER";
  if (id.includes("textedit") || id.includes("vscode") || id.includes("coteditor")) return "TEXT_EDITOR";
  if (id.includes("preview") && (name.includes("preview") || id.includes("preview"))) return "PDF_READER";
  if (id.includes("photos") || id.includes("preview")) return "IMAGE_VIEWER";
  if (id.includes("safari") || id.includes("chrome") || id.includes("firefox") || id.includes("browser")) return "BROWSER";
  if (id.includes("terminal") || id.includes("iterm") || id.includes("warp")) return "TERMINAL";
  if (id.includes("xcode") || id.includes("cursor") || id.includes("dt.xcode")) return "DEVELOPER_TOOL";
  if (id.includes("tableplus") || id.includes("postgres") || id.includes("sequel")) return "DATABASE_CLIENT";
  if (id.includes("pages") || id.includes("word") || id.includes("pages") || id.includes("iwork.pages") || id.includes("iwork.numbers") || id.includes("keynote")) return "OFFICE_DOCUMENT_APP";
  if (id.includes("mail") || id.includes("messages") || id.includes("slack") || id.includes("discord")) return "COMMUNICATION_APP";
  if (id.includes("music") || id.includes("tv") || id.includes("quicktime") || id.includes("vlc")) return "MEDIA_APP";
  return "OTHER";
}

export function capabilityInvocable(state: {
  readonly DECLARED: boolean;
  readonly ADAPTER_PRESENT: boolean;
  readonly AUTHENTICATION_READY: boolean;
  readonly RUNTIME_VERIFIED: boolean;
  readonly OWNER_ENABLED: boolean;
}): boolean {
  return state.DECLARED && state.ADAPTER_PRESENT && state.AUTHENTICATION_READY && state.RUNTIME_VERIFIED && state.OWNER_ENABLED;
}

export function atoms(
  declared: boolean,
  adapter: boolean,
  auth: boolean,
  verified: boolean,
  enabled: boolean,
): { DECLARED: boolean; ADAPTER_PRESENT: boolean; AUTHENTICATION_READY: boolean; RUNTIME_VERIFIED: boolean; OWNER_ENABLED: boolean } {
  return {
    DECLARED: declared,
    ADAPTER_PRESENT: adapter,
    AUTHENTICATION_READY: auth,
    RUNTIME_VERIFIED: verified,
    OWNER_ENABLED: enabled,
  };
}
