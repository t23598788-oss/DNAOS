/**
 * MINIMUM BOUNDED SCROLL VERIFICATION (Owner-originated)
 *   OWNER รัน:  npx tsx control/computer-use-executor/tools/scroll-verify.ts
 *   Claude ห้ามรัน (physical origination)
 *
 * เปิด acceptance-sandbox.html (ที่ซ่อม CSS แล้ว) → post scroll เดิม (dy ±600) สลับ down/up หลายครั้ง
 * พิสูจน์ deterministic: wheel received → default browser action → window.scrollY เปลี่ยนจริง
 * DOWN: scrollY เพิ่ม · UP: scrollY ลด — ไม่รับ COMPLETED เป็นหลักฐาน (ต้องเห็น sy เปลี่ยน)
 * ไม่แตะ production/mouse-helper/verifier — ใช้ scroll primitive เดิม
 */
import { authenticateOwner, grantAuthorityAsOwner } from "../../owner-authentication/contract";
import { revokeAuthority } from "../../computer-use-authority/contract";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = join(process.cwd(), "control/computer-use-executor/data");
const PAGE = join(process.cwd(), "control/computer-use-executor/sandbox/acceptance-sandbox.html");
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = "/tmp/dnaos-scrollverify-profile";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let SID = "", AUTH = "", CHROME_PID = 0;

function screenSize(): { W: number; H: number } {
  try { const o = execFileSync("/usr/bin/osascript", ["-e", 'tell application "Finder" to get bounds of window of desktop'], { encoding: "utf8", timeout: 4000 }); const m = o.trim().split(",").map((s) => parseInt(s.trim(), 10)); if (m.length === 4 && m[2] > 0) return { W: m[2], H: m[3] }; } catch { /* */ }
  return { W: 1440, H: 900 };
}
function activateChrome(): void { try { if (CHROME_PID > 0) execFileSync("/usr/bin/osascript", ["-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${CHROME_PID}) to true`], { timeout: 4000 }); } catch { /* */ } }
function readState(): Record<string, string> | null {
  if (CHROME_PID <= 0) return null; let out = "";
  try { out = execFileSync("/usr/bin/osascript", ["-e", `tell application "System Events" to tell (first process whose unix id is ${CHROME_PID}) to get name of windows`], { encoding: "utf8", timeout: 4000 }); } catch { return null; }
  const seg = out.split(",").map((s) => s.trim()).find((s) => s.startsWith("DNAOS|")); if (!seg) return null;
  const kv: Record<string, string> = {}; for (const p of seg.replace(/ - Google Chrome$/, "").split("|")) { const i = p.indexOf("="); if (i > 0) kv[p.slice(0, i)] = p.slice(i + 1); } return kv;
}
async function dispatch(op: string, ui: object): Promise<void> {
  const id = `scv-${op}-${Date.now()}`; mkdirSync(join(BASE, "inbox"), { recursive: true });
  writeFileSync(join(BASE, "inbox", `${id}.json`), JSON.stringify({ work_order_id: id, owner_session_id: SID, authority_id: AUTH, requester: "owner:scroll-verify", operation: op, target: "screen", scope_needed: ["ui-control"], ui }));
  const p = join(BASE, "results", `${id}.json`); const t0 = Date.now();
  while (Date.now() - t0 < 12000) { if (existsSync(p)) return; activateChrome(); await sleep(400); }
}

async function main(): Promise<void> {
  const a = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 900 });
  if (!a.ok) { console.log("OWNER_AUTH FAILED:", a.reason_code); process.exit(1); }
  SID = a.session.session_id;
  const g = grantAuthorityAsOwner(SID, { requester: "owner:scroll-verify", executor: "control/computer-use-executor", capability: "connections/os-ui", operations: ["screenshot", "pointer_move", "scroll"], target: "screen", scope: ["ui-control", "display-read"], ttl_seconds: 600 });
  if (!("lease" in g) || !g.ok) { console.log("GRANT FAILED"); process.exit(1); }
  AUTH = g.lease.authority_id;
  const { W, H } = screenSize();
  const target = { x: Math.round(0.30 * W), y: Math.round(0.50 * H) };

  try { execFileSync("/usr/bin/pkill", ["-f", "dnaos-scrollverify-profile"], { timeout: 4000 }); } catch { /* */ }
  try { execFileSync("/bin/rm", ["-rf", PROFILE], { timeout: 4000 }); } catch { /* */ }
  await sleep(1000);
  const child = spawn(CHROME_BIN, [`--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "--disable-session-crashed-bubble", "--kiosk", `file://${PAGE}`], { detached: true, stdio: "ignore" });
  CHROME_PID = child.pid ?? 0; child.unref();
  await sleep(5000);

  const seq = [-600, 600, -600, 600]; // down, up, down, up (deterministic ทั้งสองทิศ)
  const attempts: Record<string, unknown>[] = [];
  for (let i = 0; i < seq.length; i++) {
    const dy = seq[i]; const dir = dy < 0 ? "down" : "up";
    activateChrome(); await sleep(400);
    await dispatch("pointer_move", { coordinate: target, scope: "screen", risk_confirmed: true }); await sleep(400);
    const b = readState() ?? {};
    await dispatch("scroll", { delta: { dx: 0, dy }, scope: "screen", risk_confirmed: true });
    let af = b; const t0 = Date.now();
    while (Date.now() - t0 < 4000) { const s = readState(); if (s) { af = s; if (s.wc !== b.wc && s.sy !== b.sy) break; } activateChrome(); await sleep(300); }
    const syB = +(b.sy ?? 0), syA = +(af.sy ?? 0);
    const wheelRecv = (+(af.wc ?? 0)) > (+(b.wc ?? 0));
    const ok = dir === "down" ? syA > syB : syA < syB;
    const rec = { attempt: i + 1, dir, wc_b: b.wc, wc_a: af.wc, sy_before: syB, sy_after: syA, wheel_received: wheelRecv, expected: dir === "down" ? "sy increases" : "sy decreases", pass: ok };
    console.log(`  #${i + 1} ${dir.padEnd(4)} wc ${b.wc}->${af.wc} sy ${syB}->${syA} wheel=${wheelRecv} => ${ok ? "PASS" : "FAIL"}`);
    attempts.push(rec);
  }
  try { execFileSync("/usr/bin/pkill", ["-f", "dnaos-scrollverify-profile"], { timeout: 4000 }); } catch { /* */ }
  revokeAuthority(AUTH);
  const downs = attempts.filter((x) => x.dir === "down");
  const ups = attempts.filter((x) => x.dir === "up");
  const downOk = downs.every((x) => x.pass) && downs.length > 0;
  const upOk = ups.every((x) => x.pass) && ups.length > 0;
  const out = { owner: a.session.owner_identity, target, attempts, scroll_down_deterministic: downOk, scroll_up_deterministic: upOk, scroll_primitive: downOk && upOk ? "PROVEN" : "NOT_PROVEN" };
  const outPath = join(BASE, `scroll-verify-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`\nSCROLL VERIFY saved: ${outPath}  → scroll_primitive=${out.scroll_primitive}`);
}
void main();
