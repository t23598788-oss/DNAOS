/**
 * Window Executor — FOCUS / LIST / CAPTURE / OCR
 */

import { runShell, runScript, esc, type MacResult } from "./applescript";
import apps from "./apps.json";

type AppRegistry = Record<string, { macName: string }>;

export async function focus(appName: string): Promise<MacResult> {
  const app = (apps as AppRegistry)[appName];
  if (!app) return { ok: false, error: `Unknown app: ${appName}` };
  return runShell("open", ["-a", app.macName]);
}

export async function list(): Promise<MacResult> {
  const r = await runShell("lsappinfo", ["list"]);
  if (!r.ok) return r;
  const names = (r.data as string).match(/"LSDisplayName"="([^"]+)"/g) ?? [];
  return { ok: true, data: names.map(m => m.replace(/"LSDisplayName"="/, "").replace(/"$/, "")) };
}

export async function capture(savePath?: string): Promise<MacResult> {
  const path = savePath ?? `/tmp/dna-capture-${Date.now()}.png`;
  const r = await runShell("screencapture", ["-x", path]);
  if (r.ok) return { ok: true, data: { path } };
  return { ...r, reason: "Screen Recording permission needed" };
}

export async function captureWindow(appName: string, savePath?: string): Promise<MacResult> {
  const app = (apps as AppRegistry)[appName];
  if (!app) return { ok: false, error: `Unknown app: ${appName}` };

  await focus(appName);
  await new Promise(r => setTimeout(r, 300));

  const path = savePath ?? `/tmp/dna-capture-${Date.now()}.png`;
  const r = await runShell("screencapture", ["-x", "-l", await getWindowId(app.macName), path]);
  if (r.ok) return { ok: true, data: { path, app: appName } };

  // fallback: capture whole screen
  const fb = await runShell("screencapture", ["-x", path]);
  if (fb.ok) return { ok: true, data: { path, app: appName, fallback: true } };
  return { ...fb, reason: "Screen Recording permission needed" };
}

export async function ocr(imagePath: string): Promise<MacResult> {
  // macOS built-in OCR via shortcuts or Vision framework
  const script = `
    use framework "Vision"
    set imgPath to POSIX file "${esc(imagePath)}"
    set img to current application's NSImage's alloc()'s initWithContentsOfFile:(POSIX path of imgPath)
    if img is missing value then return "ERROR: cannot load image"
    set reqHandler to current application's VNRecognizeTextRequest's alloc()'s init()
    reqHandler's setRecognitionLanguages:{"th", "en"}
    set handler to current application's VNImageRequestHandler's alloc()'s initWithData:(img's TIFFRepresentation()) options:(current application's NSDictionary's dictionary())
    handler's performRequests:{reqHandler} |error|:(missing value)
    set results to reqHandler's results()
    set output to ""
    repeat with obs in results
      set output to output & (obs's topCandidates:1)'s firstObject()'s |string|() & linefeed
    end repeat
    return output
  `;
  const r = await runScript(script, 30000);
  if (r.ok) return { ok: true, data: { text: r.data, source: imagePath } };
  return { ok: false, error: (r.error ?? ""), reason: "OCR failed — may need Screen Recording permission" };
}

async function getWindowId(macName: string): Promise<string> {
  try {
    const r = await runScript(`tell application "System Events" to return id of window 1 of process "${esc(macName)}"`);
    return r.ok ? String(r.data) : "0";
  } catch { return "0"; }
}
