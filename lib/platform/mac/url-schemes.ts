/**
 * URL Scheme Executor — OPEN_URL
 */

import { runShell, type MacResult } from "./applescript";

export async function open(url: string): Promise<MacResult> {
  return runShell("open", [url]);
}

const schemes: Record<string, string> = {
  line: "line://",
  whatsapp: "whatsapp://",
  telegram: "tg://",
  slack: "slack://",
  vscode: "vscode://",
  xcode: "xcode://",
  figma: "figma://",
  maps: "maps://",
};

export async function openByScheme(app: string, path?: string): Promise<MacResult> {
  const scheme = schemes[app.toLowerCase()];
  if (!scheme) return { ok: false, error: `No URL scheme for: ${app}`, reason: "ไม่อยู่ในรายการ" };
  return open(scheme + (path ?? ""));
}
