/**
 * SCROLL A1/A2/A3 DIAGNOSTIC (Owner-originated — เหมือน acceptance runner)
 *   OWNER รัน:  npx tsx control/computer-use-executor/tools/scroll-diagnostic.ts
 *   Claude/Agent ห้ามรัน (physical origination — classifier บล็อก + boundary)
 *
 * โพสต์ **scroll op เดิมเป๊ะ** (ผ่าน daemon→os-ui→mouse-helper) ลงแต่ละหน้า A1/A2/A3 หลายครั้ง
 * แล้ววัด wheel receipt + default scroll (window.scrollY + container.scrollTop) จาก document.title
 * เพื่อแยกว่า "page/container structure" เป็นเหตุของ intermittent default-scroll failure ไหม
 * — ไม่แตะ production, ไม่แตะ mouse-helper, ใช้ event construction เดียวกันทั้ง 3 หน้า
 */
import { authenticateOwner, grantAuthorityAsOwner } from "../../owner-authentication/contract";
import { revokeAuthority } from "../../computer-use-authority/contract";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = join(process.cwd(), "control/computer-use-executor/data");
const SB = join(process.cwd(), "control/computer-use-executor/sandbox");
const PAGES = [
  { id: "A1", file: join(SB, "acceptance-sandbox.html"), note: "html,body height:100%+overflow-y:scroll + .spacer" },
  { id: "A2", file: join(SB, "scroll-diag/A2-normal-document.html"), note: "normal document (no height:100%)" },
  { id: "A3", file: join(SB, "scroll-diag/A3-explicit-container.html"), note: "explicit overflow:auto container" },
];
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = "/tmp/dnaos-scrolldiag-profile";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let SID = "", AUTH = "", CHROME_PID = 0;

function screenSize(): { W: number; H: number } {
  try { const o = execFileSync("/usr/bin/osascript", ["-e", 'tell application "Finder" to get bounds of window of desktop'], { encoding: "utf8", timeout: 4000 }); const m = o.trim().split(",").map((s) => parseInt(s.trim(), 10)); if (m.length === 4 && m[2] > 0) return { W: m[2], H: m[3] }; } catch { /* */ }
  return { W: 1440, H: 900 };
}
function activateChrome(): void { try { if (CHROME_PID > 0) execFileSync("/usr/bin/osascript", ["-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${CHROME_PID}) to true`], { timeout: 4000 }); } catch { /* */ } }
/** อ่าน title (DNAOS| หรือ DIAG|) → kv */
function readState(): Record<string, string> | null {
  if (CHROME_PID <= 0) return null;
  let out = "";
  try { out = execFileSync("/usr/bin/osascript", ["-e", `tell application "System Events" to tell (first process whose unix id is ${CHROME_PID}) to get name of windows`], { encoding: "utf8", timeout: 4000 }); } catch { return null; }
  const seg = out.split(",").map((s) => s.trim()).find((s) => s.startsWith("DNAOS|") || s.startsWith("DIAG|"));
  if (!seg) return null;
  const kv: Record<string, string> = {};
  for (const part of seg.replace(/ - Google Chrome$/, "").split("|")) { const i = part.indexOf("="); if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1); }
  return kv;
}
function writeWO(id: string, op: string, ui: object): void {
  mkdirSync(join(BASE, "inbox"), { recursive: true });
  writeFileSync(join(BASE, "inbox", `${id}.json`), JSON.stringify({ work_order_id: id, owner_session_id: SID, authority_id: AUTH, requester: "owner:scroll-diagnostic", operation: op, target: "screen", scope_needed: ["ui-control"], ui }));
}
async function awaitResult(id: string, timeoutMs = 12000): Promise<Record<string, unknown> | null> {
  const p = join(BASE, "results", `${id}.json`); const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8")); activateChrome(); await sleep(400); }
  return null;
}
async function dispatch(op: string, ui: object): Promise<void> { const id = `scdiag-${op}-${Date.now()}`; writeWO(id, op, ui); await awaitResult(id); }

async function openPage(file: string): Promise<void> {
  try { execFileSync("/usr/bin/pkill", ["-f", "dnaos-scrolldiag-profile"], { timeout: 4000 }); } catch { /* */ }
  try { execFileSync("/bin/rm", ["-rf", PROFILE], { timeout: 4000 }); } catch { /* */ }
  await sleep(1000);
  const child = spawn(CHROME_BIN, [`--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "--disable-session-crashed-bubble", "--kiosk", `file://${file}`], { detached: true, stdio: "ignore" });
  CHROME_PID = child.pid ?? 0; child.unref();
  await sleep(5000);
}

async function main(): Promise<void> {
  const a = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 900 });
  if (!a.ok) { console.log("OWNER_AUTH FAILED:", a.reason_code); process.exit(1); }
  SID = a.session.session_id;
  const g = grantAuthorityAsOwner(SID, { requester: "owner:scroll-diagnostic", executor: "control/computer-use-executor", capability: "connections/os-ui", operations: ["screenshot", "pointer_move", "scroll"], target: "screen", scope: ["ui-control", "display-read"], ttl_seconds: 600 });
  if (!("lease" in g) || !g.ok) { console.log("GRANT FAILED"); process.exit(1); }
  AUTH = g.lease.authority_id;
  const { W, H } = screenSize();
  const target = { x: Math.round(0.30 * W), y: Math.round(0.50 * H) }; // จุดกลาง-ซ้าย: อยู่เหนือ content ทุกหน้า, เลี่ยง overlay ขวา
  const N = 6; // 6 ครั้ง/หน้า (สลับ down/up) — ทดสอบ determinism ไม่ใช่ครั้งเดียว
  const results: Record<string, unknown>[] = [];

  for (const page of PAGES) {
    console.log(`\n=== ${page.id} (${page.note}) ===`);
    await openPage(page.file);
    const attempts: Record<string, unknown>[] = [];
    for (let i = 0; i < N; i++) {
      const dy = i % 2 === 0 ? -600 : 600; // even=down, odd=up
      activateChrome(); await sleep(400);
      await dispatch("pointer_move", { coordinate: target, scope: "screen", risk_confirmed: true });
      await sleep(400);
      const before = readState();
      await dispatch("scroll", { delta: { dx: 0, dy }, scope: "screen", risk_confirmed: true });
      // poll ให้ effect ปรากฏ (wheel/scroll) หรือ timeout 4s
      let after = before; const t0 = Date.now();
      while (Date.now() - t0 < 4000) { const s = readState(); if (s) { after = s; if (s.wc !== before?.wc && (s.sy !== before?.sy || s.dsy !== before?.dsy || s.cst !== before?.cst)) break; if (s.wc !== before?.wc) after = s; } activateChrome(); await sleep(300); }
      const b = before ?? {}, af = after ?? {};
      const wheelRecv = (+(af.wc ?? 0)) > (+(b.wc ?? 0));
      const winScrolled = (af.sy ?? "0") !== (b.sy ?? "0");
      const contScrolled = (af.cst ?? "-1") !== (b.cst ?? "-1") && (af.cst ?? "-1") !== "-1";
      const cls = !wheelRecv ? "NO_WHEEL_RECEIVED" : winScrolled ? "WINDOW_SCROLLED" : contScrolled ? "CONTAINER_SCROLLED" : "WHEEL_RECEIVED_NO_SCROLL";
      const rec = { attempt: i + 1, dir: dy < 0 ? "down" : "up", wc_b: b.wc, wc_a: af.wc, wdy: af.wdy, wt: af.wt, wdm: af.wdm, sy_b: b.sy, sy_a: af.sy, dsy_b: b.dsy, dsy_a: af.dsy, cst_b: b.cst, cst_a: af.cst, mx: af.mx, wheelRecv, winScrolled, contScrolled, cls };
      console.log(`  #${i + 1} ${rec.dir.padEnd(4)} wc ${b.wc}->${af.wc} sy ${b.sy}->${af.sy} cst ${b.cst}->${af.cst} wt=${af.wt} => ${cls}`);
      attempts.push(rec);
    }
    const wr = attempts.filter((x) => x.wheelRecv).length;
    const ws = attempts.filter((x) => x.winScrolled || x.contScrolled).length;
    results.push({ page: page.id, note: page.note, attempts, wheel_received: wr, scroll_success: ws, scroll_failure: N - ws });
  }
  try { execFileSync("/usr/bin/pkill", ["-f", "dnaos-scrolldiag-profile"], { timeout: 4000 }); } catch { /* */ }
  revokeAuthority(AUTH);
  const outPath = join(BASE, `scroll-diagnostic-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify({ owner: a.session.owner_identity, screen: { W, H }, target, N, results }, null, 1));
  console.log(`\nSCROLL DIAGNOSTIC saved: ${outPath}`);
  console.log("→ ให้ Claude อ่านไฟล์นี้เพื่อสรุป A1/A2/A3 (page-structure causal?)");
}
void main();
