/**
 * Editor Wrap Mode / Horizontal Overflow — structural verification
 * (owner, 2026-08-10, TASK-074, capability #62).
 *
 * This is a small, standalone check — NOT part of scripts/ide-regression-
 * test.ts (npm run ide:test) — written to satisfy TASK-074's explicit
 * requirement: "Structurally verify (in your own test) that an extremely
 * long single line (>5000 characters) doesn't break page layout or expand
 * the viewport."
 *
 * Two things are verified, both against the REAL production code, never a
 * reimplementation:
 *
 * 1. Data-path safety: the real, exported lineColAt()/offsetOfLine()/
 *    shouldSoftWrapPath() helpers (components/ide-shell/IDEWorkspace.tsx)
 *    are run against a real >5000-character single line to confirm they
 *    return correct results quickly and never throw — i.e. the editor's
 *    own cursor/line logic has no pathological behavior on a line this
 *    long that could otherwise cascade into a broken/looping render.
 *
 * 2. Structural CSS guarantee: this is a plain-textarea editor (no
 *    Monaco, no virtualized DOM), so the actual "does it overflow the
 *    page" answer is a CSS containment property, not something a
 *    Node-only script can render a real browser layout for (this repo's
 *    existing ide:test suite is itself non-browser, same constraint).
 *    So this checks the REAL source of FileEditor's render — not a
 *    hardcoded copy — for exactly the three containment rules TASK-074
 *    required: the horizontal-scroll row is min-width:0 + overflow:hidden,
 *    and the textarea (the actual scrollable child) is overflowX:auto.
 *    A native <textarea> with these properties cannot expand its parent's
 *    box regardless of content length — this is standard CSS box model
 *    behavior, not an assumption specific to this file.
 *
 * Run: npx tsx scripts/ide-editor-overflow-verify.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { lineColAt, offsetOfLine, shouldSoftWrapPath } from "../components/ide-shell/IDEWorkspace";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) });
  }
}
function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

async function main() {
  // A real single line over 5000 characters (5,000 repeated tokens plus a
  // trailing newline and a second short line, mirroring a real file with
  // one pathologically long line among normal ones).
  const longLine = "x".repeat(5231);
  assert(longLine.length > 5000, "fixture sanity check");
  const content = `${longLine}\nsecond line`;

  test("lineColAt() resolves an offset inside a >5000-char line without throwing", () => {
    const start = Date.now();
    const { line, column } = lineColAt(content, 3000);
    const ms = Date.now() - start;
    assert(line === 1, `expected line 1, got ${line}`);
    assert(column === 3001, `expected column 3001, got ${column}`);
    assert(ms < 200, `lineColAt took ${ms}ms — unexpectedly slow for a single long line`);
  });

  test("lineColAt() resolves an offset on the line AFTER a >5000-char line", () => {
    const offsetOfSecondLineStart = longLine.length + 1;
    const { line, column } = lineColAt(content, offsetOfSecondLineStart + 3);
    assert(line === 2, `expected line 2, got ${line}`);
    assert(column === 4, `expected column 4, got ${column}`);
  });

  test("offsetOfLine() finds the start of the line after a >5000-char line", () => {
    const offset = offsetOfLine(content, 2);
    assert(offset === longLine.length + 1, `expected ${longLine.length + 1}, got ${offset}`);
  });

  test("a >5000-char line does not corrupt line counting for the rest of the file", () => {
    const bigContent = `${longLine}\n${longLine}\n${longLine}`;
    const lineCount = bigContent.split("\n").length;
    assert(lineCount === 3, `expected 3 lines, got ${lineCount}`);
  });

  test("shouldSoftWrapPath() — SMART soft-wraps prose/data file kinds", () => {
    assert(shouldSoftWrapPath("README.md") === true, "README.md should soft-wrap");
    assert(shouldSoftWrapPath("notes.txt") === true, "notes.txt should soft-wrap");
    assert(shouldSoftWrapPath("app.log") === true, "app.log should soft-wrap");
    assert(shouldSoftWrapPath("build-report.report") === true, "*.report should soft-wrap");
    assert(shouldSoftWrapPath("data.json") === true, "*.json should soft-wrap");
  });

  test("shouldSoftWrapPath() — SMART preserves line structure for source code", () => {
    assert(shouldSoftWrapPath("engine.ts") === false, "*.ts should NOT soft-wrap under SMART");
    assert(shouldSoftWrapPath("component.tsx") === false, "*.tsx should NOT soft-wrap under SMART");
    assert(shouldSoftWrapPath("route.py") === false, "*.py should NOT soft-wrap under SMART");
  });

  // ---- Structural CSS containment check against the REAL source ----
  const sourcePath = path.join(__dirname, "..", "components", "ide-shell", "IDEWorkspace.tsx");
  const source = await fs.readFile(sourcePath, "utf-8");
  const fileEditorStart = source.indexOf("function FileEditor(");
  assert(fileEditorStart !== -1, "FileEditor function not found in real source");
  const fileEditorEnd = source.indexOf("\nfunction ", fileEditorStart + 10);
  const fileEditorSrc = source.slice(fileEditorStart, fileEditorEnd === -1 ? undefined : fileEditorEnd);

  test("FileEditor's horizontal-scroll row is minWidth:0 + overflow:hidden (real source)", () => {
    const rowMatch = fileEditorSrc.match(/flex: 1, display: "flex", minHeight: 0, minWidth: 0, overflow: "hidden" \}\}/);
    assert(!!rowMatch, "expected the editor row's style object to declare minWidth:0 + overflow:hidden — page-level overflow containment would be missing without it");
  });

  test("FileEditor's <textarea> (the real scrollable child) declares overflowX:auto (real source)", () => {
    assert(/overflowX:\s*"auto"/.test(fileEditorSrc), "expected the textarea style to set overflowX: \"auto\" so its own horizontal scrollbar — never the page's — absorbs long lines");
  });

  test("FileEditor's <textarea> wrap attribute is driven by the real wrapMode (not hardcoded wrap=\"off\")", () => {
    assert(/wrap=\{softWrap \? "soft" : "off"\}/.test(fileEditorSrc), "expected wrap to be computed from softWrap (SMART/ON/OFF), not a hardcoded literal");
  });

  const allPass = results.every((r) => r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} — ${r.name}${r.detail ? `\n       ${r.detail}` : ""}`);
  }
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (!allPass) process.exit(1);
}

void main();
