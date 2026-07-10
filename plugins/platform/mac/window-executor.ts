/**
 * Window Executor — โฟกัส/แสดงรายการ/จับภาพ/OCR หน้าต่าง macOS
 */

import { runScript, runShell } from "./applescript";
import { esc } from "./applescript";

export async function focus(appName: string): Promise<void> {
  const { ok, error } = await runScript(
    `tell application "${esc(appName)}" to activate`
  );
  if (!ok) throw new Error(`window.focus("${appName}") failed: ${error}`);
}

export async function list(): Promise<string[]> {
  const { ok, output, error } = await runScript(`
    tell application "System Events"
      set result to {}
      repeat with p in (every process whose visible is true)
        repeat with w in (every window of p)
          set end of result to (name of p) & ": " & (name of w)
        end repeat
      end repeat
      return result
    end tell
  `);
  if (!ok) throw new Error(`window.list failed: ${error}`);
  return output
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function capture(outputPath?: string): Promise<string> {
  const dest = outputPath ?? `/tmp/screenshot-${Date.now()}.png`;
  const { ok, error } = await runShell("screencapture", ["-x", dest]);
  if (!ok) throw new Error(`window.capture failed: ${error}`);
  return dest;
}

export async function captureWindow(appName: string, outputPath?: string): Promise<string> {
  const dest = outputPath ?? `/tmp/screenshot-${Date.now()}.png`;
  const { ok, error } = await runScript(`
    tell application "${esc(appName)}" to activate
    delay 0.3
    do shell script "screencapture -x -l $(osascript -e 'tell app \\"${esc(appName)}\\" to id of window 1') ${dest}"
  `);
  if (!ok) throw new Error(`window.captureWindow("${appName}") failed: ${error}`);
  return dest;
}

export async function ocr(imagePath: string): Promise<string> {
  // ใช้ Apple Vision framework ผ่าน swift one-liner
  const swift = `
import Vision
import Foundation
let url = URL(fileURLWithPath: "${esc(imagePath)}")
let request = VNRecognizeTextRequest { req, _ in
  let obs = req.results as? [VNRecognizedTextObservation] ?? []
  let text = obs.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\\n")
  print(text)
}
request.recognitionLevel = .accurate
try! VNImageRequestHandler(url: url).perform([request])
`.trim();
  const { ok, output, error } = await runShell("swift", ["-e", swift]);
  if (!ok) throw new Error(`window.ocr("${imagePath}") failed: ${error}`);
  return output;
}
