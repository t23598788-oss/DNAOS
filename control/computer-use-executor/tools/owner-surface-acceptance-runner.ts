/**
 * หน้าที่: ให้ Computer Use ทำงานกับ "แอปจริงของ Owner" (control-workspace,
 * http://127.0.0.1:5181) ผ่านเส้นทางเดิมทั้งเส้น แล้วให้ verdict ของแต่ละ
 * operation มาจากเครื่องตัดสินเดิม ไม่ใช่จากคนอ่านผล (Owner, 2026-09-02).
 *
 * นี่ไม่ใช่ระบบ Computer Use ตัวที่สอง. ไฟล์นี้ไม่มี CGEvent, ไม่มี adapter,
 * ไม่มี expectation, ไม่มี verdict, ไม่มี evidence store เป็นของตัวเอง. สิ่งเดียว
 * ที่มันเลือกคือ "เป้าหมาย" — แทนที่จะเป็น acceptance-sandbox.html ก็เป็น Owner
 * Surface จริง. ทุก operation ยังวิ่ง WorkOrder → inbox → daemon(launchd) →
 * Policy V2 → Authority → executor → os-ui → mouse-helper → Evidence เหมือนเดิม.
 *
 * ORIGINATOR. physical-acceptance-runner.ts ห้าม Agent รันเพราะ Agent จะกลาย
 * เป็นผู้ริเริ่มการควบคุมเครื่อง. ที่นี่ผู้ริเริ่มคือ TASK ของ Owner
 * (OWNER_SURFACE_SINGLE_APP_FULL_COMPUTER_USE_ACCEPTANCE) ซึ่งสั่งตรงว่า
 * "Computer Use must physically operate the REAL Owner Surface" และมี
 * preauthorization ของ Owner ค้างอยู่จริงใน computer-use-policy. originator
 * ถูกบันทึกตามนั้น — ไม่แอบอ้างว่าเป็น Owner และไม่แอบอ้างว่าเป็น Agent.
 *
 * VERDICT ไม่ได้มาจากไฟล์นี้. work order แต่ละใบพก observation_target = pid ของ
 * Chrome ที่เปิดแอปจริง executor จึงอ่าน before/after เอง สร้าง expectation เอง
 * และตัดสิน VERIFIED/FAILED/UNPROVEN เอง ไฟล์นี้อ่านผลจาก evidence ที่ executor
 * เขียน ไม่เคยคำนวณ verdict เอง และไม่เคยเลื่อน UNPROVEN ขึ้นเป็น PASS.
 *
 * Input: none (อ่าน owner session + preauthorization จาก store จริง)
 * Output: รายงานต่อ operation + ไฟล์ผลใน data/owner-surface-acceptance-*.json
 * สิ่งที่ห้ามแตะ: ห้ามคำนวณ verdict เอง, ห้ามแตะ Chrome หลักของ Owner,
 * ห้ามแปลง UNPROVEN เป็น PASS.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authenticateOwner, grantAuthorityAsOwner } from "../../owner-authentication/contract";
import { readPreauthorization } from "../../computer-use-policy/contract";
import { revokeAuthority } from "../../computer-use-authority/contract";
import { verifiedReadJsonl } from "../../observation-integrity/verified-read";

const BASE = join(process.cwd(), "control/computer-use-executor/data");
const SURFACE = process.env.DNAOS_OWNER_SURFACE ?? "http://127.0.0.1:5181/";
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = "/tmp/dnaos-owner-surface-profile";
const ORIGINATOR = "OWNER_TASK:OWNER_SURFACE_SINGLE_APP_FULL_COMPUTER_USE_ACCEPTANCE";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let SID = "", AUTH = "", PID = 0;

function screenSize(): { W: number; H: number } {
  try {
    const out = execFileSync("/usr/bin/osascript", ["-e", 'tell application "Finder" to get bounds of window of desktop'], { encoding: "utf8", timeout: 4000 });
    const m = out.trim().split(",").map((s) => parseInt(s.trim(), 10));
    if (m.length === 4 && m[2] > 0 && m[3] > 0) return { W: m[2], H: m[3] };
  } catch { /* fall through */ }
  return { W: 1440, H: 900 };
}

/** ดึงหน้าต่างแอปจริงกลับมา frontmost ก่อนทุก op — เจาะด้วย unix id เพื่อไม่ชน Chrome หลักของ Owner */
function activate(): void {
  if (PID <= 0) return;
  try { execFileSync("/usr/bin/osascript", ["-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${PID}) to true`], { timeout: 4000 }); } catch { /* best effort */ }
}

/** อ่านสถานะที่แอปจริงประกาศเอง — ใช้ตรวจว่า surface พูดได้แล้วหรือยัง ไม่ได้ใช้ตัดสิน */
function publishedState(): Record<string, string> | null {
  if (PID <= 0) return null;
  let out = "";
  try { out = execFileSync("/usr/bin/osascript", ["-e", `tell application "System Events" to tell (first process whose unix id is ${PID}) to get name of windows`], { encoding: "utf8", timeout: 4000 }); } catch { return null; }
  const seg = out.split(",").map((s) => s.trim()).find((s) => s.startsWith("DNAOS|"));
  if (!seg) return null;
  const kv: Record<string, string> = {};
  for (const part of seg.replace(/ - Google Chrome$/, "").split("|")) { const i = part.indexOf("="); if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1); }
  return kv;
}

/**
 * กรอบหน้าต่างจริงของแอป Owner (logical points) — ไม่ใช่ขนาดจอ
 *
 * รอบก่อนคำนวณพิกัดจากเศษส่วนของ "จอ" โดยสมมติว่า Chrome เปิด kiosk เต็มจอ
 * ภาพหน้าจอพิสูจน์ว่าไม่จริง: มันเป็นหน้าต่างธรรมดา พิกัดจึงตกนอกแอปบ้าง
 * ในแอปบ้าง แล้วผลออกมาเป็น FAILED ทั้งที่ primitive ไม่ได้พัง — เป็นการวัดผิด
 * ไม่ใช่ระบบผิด อ่านกรอบจริงก่อน แล้วค่อยเลือกจุด
 */
function windowBounds(): { x: number; y: number; w: number; h: number } | null {
  if (PID <= 0) return null;
  // "window 1" ไม่ใช่หน้าต่างเอกสารเสมอไป — รอบหนึ่งมันคืนแถบเมนู
  // (1440x41 ที่ (0,-41)) แล้วจุดที่คำนวณได้ตกนอกจอที่ y=-23 ทั้งที่ผ่าน
  // การตรวจ "อยู่ในกรอบ" เพราะกรอบนั้นเองผิด จึงต้องอ่านทุกหน้าต่างแล้วเลือก
  // อันที่ใหญ่ที่สุดที่อยู่บนจอจริง ไม่ใช่เชื่อ index
  try {
    const out = execFileSync("/usr/bin/osascript", ["-e",
      `tell application "System Events" to tell (first process whose unix id is ${PID}) to get {position, size} of every window`,
    ], { encoding: "utf8", timeout: 6000 });
    const nums = out.trim().split(",").map((v) => parseInt(v.trim(), 10)).filter((v) => !Number.isNaN(v));
    // osascript คืน position ของทุกหน้าต่างก่อน แล้วตามด้วย size ของทุกหน้าต่าง
    const half = Math.floor(nums.length / 2);
    if (half < 2 || half % 2 !== 0) return null;
    const count = half / 2;
    let best: { x: number; y: number; w: number; h: number } | null = null;
    for (let i = 0; i < count; i += 1) {
      const x = nums[i * 2]!, y = nums[i * 2 + 1]!;
      const w = nums[half + i * 2]!, h = nums[half + i * 2 + 1]!;
      if (y < 0 || w < 200 || h < 200) continue; // แถบเมนู/หน้าต่างซ่อน ไม่ใช่เป้าหมาย
      if (!best || w * h > best.w * best.h) best = { x, y, w, h };
    }
    return best;
  } catch { return null; }
}

const inside = (p: { x: number; y: number }, b: { x: number; y: number; w: number; h: number } | null): boolean =>
  b !== null && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

function writeWO(id: string, op: string, ui: object, target = "screen", scope: string[] = ["ui-control"], observe = true): void {
  mkdirSync(join(BASE, "inbox"), { recursive: true });
  writeFileSync(join(BASE, "inbox", `${id}.json`), JSON.stringify({
    work_order_id: id, owner_session_id: SID, authority_id: AUTH,
    requester: ORIGINATOR, operation: op, target, scope_needed: scope, ui,
    ...(observe && PID > 0 ? { observation_target: { pid: PID }, capture_routing_context: true, settle_ms: 1200 } : {}),
  }));
}

async function awaitResultKeepFront(id: string, timeoutMs = 16000): Promise<Record<string, unknown> | null> {
  const p = join(BASE, "results", `${id}.json`);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
    activate();
    await sleep(400);
  }
  return null;
}

/** evidence ที่ executor เขียนไว้ — แหล่งเดียวของ verdict */
function evidenceFor(evidenceId: string): Record<string, unknown> | null {
  const v = verifiedReadJsonl<Record<string, unknown>>(join(process.cwd(), "control/computer-use-executor/data/execution-evidence.jsonl"));
  if (v.outcome !== "READ_SUCCEEDED" || !v.rows) return null;
  return v.rows.filter((r) => r.evidence_id === evidenceId).at(-1) ?? null;
}

interface OpSpec { label: string; op: string; ui: object; scope?: string[]; target?: string; expected: string; }

const records: Record<string, unknown>[] = [];

async function runOp(n: number, spec: OpSpec): Promise<void> {
  activate(); await sleep(400);
  const before = publishedState();
  const id = `osa-${n}-${spec.op}-${Date.now()}`;
  writeWO(id, spec.op, spec.ui, spec.target ?? "screen", spec.scope ?? ["ui-control"]);
  const result = await awaitResultKeepFront(id);
  await sleep(700);
  const after = publishedState();
  const ev = result?.evidence_id ? evidenceFor(String(result.evidence_id)) : null;
  const verdict = (ev?.effect_verdict as { status?: string } | undefined)?.status ?? "NO_VERDICT_RECORDED";
  const obsAfter = ev?.observation_after as { acquired?: boolean; unavailable_reason?: string | null } | undefined;

  const rec = {
    step: n, label: spec.label, COMMAND: spec.op, TARGET: spec.target ?? "screen",
    EXPECTED_EFFECT: spec.expected,
    BEFORE_STATE: before, AFTER_STATE: after,
    EXECUTION_EVIDENCE: result?.evidence_id ?? null,
    dispatch_result: result?.result_status ?? result?.reason ?? "NO_RESULT",
    executed: result?.executed ?? false,
    EFFECT_VERDICT: verdict,
    observation_acquired: obsAfter?.acquired ?? null,
    observation_unavailable_reason: obsAfter?.unavailable_reason ?? null,
    VISIBLE_RESULT: before && after ? `${JSON.stringify(before)} -> ${JSON.stringify(after)}` : "NO_PUBLISHED_STATE",
    originator: ORIGINATOR,
  };
  records.push(rec);
  console.log(`  [${n}] ${spec.op.padEnd(16)} exec=${String(rec.executed).padEnd(5)} verdict=${String(verdict).padEnd(10)} obs=${obsAfter?.acquired ?? "-"} ${obsAfter?.unavailable_reason ?? ""}`);
}

async function main(): Promise<void> {
  console.log("=== OWNER SURFACE COMPUTER USE ACCEPTANCE ===");
  console.log(`target surface: ${SURFACE}`);

  const a = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 900 });
  if (!a.ok) { console.log("OWNER_AUTH FAILED:", a.reason_code); process.exit(1); }
  SID = a.session.session_id;
  const pol = readPreauthorization();
  console.log(`owner session: ${SID}  preauthorized=${pol.preauthorized}`);

  const g = grantAuthorityAsOwner(SID, {
    requester: ORIGINATOR, executor: "control/computer-use-executor", capability: "connections/os-ui",
    operations: ["screenshot", "read_screen", "pointer_move", "click", "double_click", "scroll", "drag", "focus", "type", "key", "browser_navigate"],
    target: "screen", scope: ["ui-control", "display-read"], ttl_seconds: 900,
  });
  if (!("lease" in g) || !g.ok) { console.log("GRANT FAILED:", (g as { reason_code?: string }).reason_code); process.exit(1); }
  AUTH = g.lease.authority_id;
  console.log(`authority: ${AUTH}`);

  // เปิดแอปจริงในหน้าต่างแยก (โปรไฟล์แยก) — ไม่แตะ Chrome หลักของ Owner
  try { execFileSync("/bin/rm", ["-rf", PROFILE], { timeout: 4000 }); } catch { /* ignore */ }
  try {
    const child = spawn(CHROME_BIN, [`--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "--disable-session-crashed-bubble", "--kiosk", SURFACE], { detached: true, stdio: "ignore" });
    PID = child.pid ?? 0; child.unref();
  } catch (e) { console.log("chrome launch failed:", String(e)); }
  console.log(`owner surface window pid=${PID} (isolated profile — Owner's own Chrome untouched)`);
  await sleep(7000);

  const st = publishedState();
  console.log(`surface publishes observable state: ${st ? `YES ${JSON.stringify(st)}` : "NO"}`);

  const { W, H } = screenSize();
  const mid: { x: number; y: number } = { x: Math.round(W * 0.62), y: Math.round(H * 0.55) };
  const nav = { x: Math.round(W * 0.03), y: Math.round(H * 0.30) };

  // PROFILE=repeat-click ตอบคำถามเดียว: click แรกที่ไม่ลงเป็นเพราะ macOS กิน
  // click แรกไปเป็น click-to-focus หรือเปล่า ถ้าใช่ ครั้งที่ 2/3 ต้องลง
  if (process.env.DNAOS_OSA_PROFILE === "repeat-click") {
    for (let i = 1; i <= 4; i += 1) {
      await runOp(i, { label: `CLICK #${i}`, op: "click", ui: { coordinate: mid, scope: "screen", risk_confirmed: true }, expected: "clicks เพิ่มขึ้น" });
    }
    try { revokeAuthority(AUTH); } catch { /* ignore */ }
    const outP = join(BASE, `owner-surface-acceptance-${Date.now()}.json`);
    writeFileSync(outP, JSON.stringify({ surface: SURFACE, profile: "repeat-click", originator: ORIGINATOR, chrome_pid: PID, operations: records }, null, 1));
    const vv = records.filter((r) => r.EFFECT_VERDICT === "VERIFIED").length;
    console.log(`\nVERIFIED=${vv} of ${records.length}`);
    console.log(`report: ${outP}`);
    return;
  }

  // PROFILE=real — ทดสอบเฉพาะเป้าหมายที่ถูกต้องจริง ตามที่ Owner สั่ง:
  // ห้ามยิง scroll ใส่หน้าที่ mx=0 แล้วสรุปว่า primitive พัง ต้องรู้ก่อนว่า
  // เอกสาร scroll ได้ไหม แล้วค่อยตัดสินใจ
  if (process.env.DNAOS_OSA_PROFILE === "real") {
    // TARGETING PRECONDITION — เลือกจุดจากกรอบหน้าต่างจริง แล้วพิสูจน์ว่าอยู่ในกรอบ
    // ถ้าอ่านกรอบไม่ได้หรือจุดตกนอกกรอบ ต้องไม่ยิงและต้องไม่นับเป็น FAILED
    // เพราะนั่นคือ "วัดไม่ได้" ไม่ใช่ "ทำแล้วไม่เกิดผล"
    const wb = windowBounds();
    const target = wb ? { x: Math.round(wb.x + wb.w * 0.5), y: Math.round(wb.y + wb.h * 0.45) } : mid;
    const targetable = inside(target, wb);
    console.log(`  window bounds: ${wb ? `${wb.w}x${wb.h} at (${wb.x},${wb.y})` : "UNREADABLE"}`);
    console.log(`  target point : ${JSON.stringify(target)} inside_window=${targetable}`);
    if (!targetable) {
      records.push({ step: 0, label: "TARGETING", COMMAND: "precondition", EFFECT_VERDICT: "NOT_MEASURABLE",
        VISIBLE_RESULT: `target ${JSON.stringify(target)} not provably inside window ${JSON.stringify(wb)} — refused to dispatch`, originator: ORIGINATOR });
      console.log("  TARGETING_PRECONDITION_FAILED — no physical op dispatched (not counted as FAILED)");
      const outP0 = join(BASE, `owner-surface-acceptance-${Date.now()}.json`);
      writeFileSync(outP0, JSON.stringify({ surface: SURFACE, profile: "real", originator: ORIGINATOR, chrome_pid: PID, window_bounds: wb, operations: records }, null, 1));
      console.log(`report: ${outP0}`);
      return;
    }
    mid.x = target.x; mid.y = target.y;
    // ช่องพิมพ์คำสั่งจริงอยู่ล่างสุดของหน้าต่าง — คลิกให้ focus ก่อน แล้ว type
    // ถึงจะมีผลที่วัดได้ (in เปลี่ยน) ไม่ใช่พิมพ์ลอย ๆ ใส่หน้าเปล่า
    // 0.5 ของความกว้างตกที่ปุ่ม "+" (แนบไฟล์) ซึ่งเปิด file picker ของ macOS
    // แล้ว dialog นั้นกลืน event ที่เหลือทั้งหมด — จอค้าง ผลกลายเป็น FAILED ทุกข้อ
    // ทั้งที่ CGEvent ถูกส่งจริง เลื่อนไปทางขวาให้ตกกลางช่องข้อความจริง
    const inputPoint = wb ? { x: Math.round(wb.x + wb.w * 0.62), y: Math.round(wb.y + wb.h * 0.93) } : mid;
    const scrollable = Number(st?.mx ?? "0") > 0;
    console.log(`  document scrollable (mx): ${st?.mx ?? "?"} -> scroll ${scrollable ? "WILL RUN" : "NOT APPLICABLE (skipped, not failed)"}`);
    console.log(`  command input point: ${JSON.stringify(inputPoint)} inside_window=${inside(inputPoint, wb)}`);
    let n = 1;
    // app: "chrome" คือเงื่อนไขของ os-ui admission สำหรับ click/type/key/focus
    // (ALLOWED_APP_KEYS) รอบก่อนไม่ได้ส่งมา จึงถูกปฏิเสธที่ APP_NOT_ALLOWLISTED
    // ตั้งแต่ก่อนสร้าง CGEvent — ไม่ใช่ primitive พัง แต่เป็นการยื่นคำขอไม่ครบ
    await runOp(n++, { label: "CLICK input", op: "click", ui: { app: "chrome", coordinate: inputPoint, scope: "ui-control", risk_confirmed: true }, expected: "clicks เพิ่มขึ้น และ af เป็นช่องพิมพ์" });
    await runOp(n++, { label: "TYPE", op: "type", ui: { app: "chrome", text: "dnaos acceptance", scope: "ui-control" }, expected: "in เปลี่ยนเป็นข้อความที่พิมพ์" });
    await runOp(n++, { label: "KEY Tab", op: "key", ui: { app: "chrome", key: "TAB", scope: "ui-control" }, expected: "st เปลี่ยนเป็น key:Tab" });
    await runOp(n++, { label: "DOUBLE_CLICK", op: "double_click", ui: { coordinate: mid, scope: "screen", risk_confirmed: true }, expected: "dbls เพิ่มขึ้น" });
    await runOp(n++, { label: "DRAG", op: "drag", ui: { coordinate: mid, coordinate2: { x: mid.x - 200, y: mid.y }, scope: "screen", risk_confirmed: true }, expected: "dl เปลี่ยน" });
    if (scrollable) {
      await runOp(n++, { label: "SCROLL", op: "scroll", ui: { coordinate: mid, delta_y: -400, scope: "screen", risk_confirmed: true }, expected: "sy เปลี่ยน" });
    } else {
      records.push({ step: n++, label: "SCROLL", COMMAND: "scroll", TARGET: "screen", EXPECTED_EFFECT: "sy เปลี่ยน",
        EFFECT_VERDICT: "NOT_APPLICABLE", VISIBLE_RESULT: `document reports mx=${st?.mx ?? "?"} — ไม่มีระยะให้เลื่อน จึงไม่ยิงและไม่นับว่าล้ม`, originator: ORIGINATOR });
      console.log(`  [${n - 1}] scroll           NOT_APPLICABLE — mx=${st?.mx ?? "?"}`);
    }
    await runOp(n++, { label: "SCREENSHOT", op: "screenshot", ui: { target: "", scope: "screen", risk_confirmed: true }, scope: ["display-read"], expected: "ได้ภาพแอปจริง" });
    try { revokeAuthority(AUTH); } catch { /* ignore */ }
    const outR = join(BASE, `owner-surface-acceptance-${Date.now()}.json`);
    writeFileSync(outR, JSON.stringify({ surface: SURFACE, profile: "real", originator: ORIGINATOR, chrome_pid: PID, published_state_at_start: st, operations: records }, null, 1));
    const v2 = records.filter((r) => r.EFFECT_VERDICT === "VERIFIED").length;
    const f2 = records.filter((r) => r.EFFECT_VERDICT === "FAILED").length;
    console.log(`\nVERIFIED=${v2} FAILED=${f2} OTHER=${records.length - v2 - f2}`);
    console.log(`report: ${outR}`);
    return;
  }

  await runOp(1, { label: "OPEN", op: "browser_navigate", target: SURFACE, ui: { target: SURFACE, scope: "browser", risk_confirmed: true }, scope: ["ui-control"], expected: "แอปจริงถูกเปิดผ่าน os-ui" });
  await runOp(2, { label: "FOCUS", op: "focus", ui: { target: "Google Chrome", scope: "ui-control" }, expected: "หน้าต่างแอปจริงเป็น frontmost" });
  await runOp(3, { label: "SCREEN OBSERVATION", op: "screenshot", ui: { target: "", scope: "screen", risk_confirmed: true }, scope: ["display-read"], expected: "ได้ภาพหน้าจอจริงของแอป" });
  await runOp(4, { label: "SCREEN READ", op: "read_screen", ui: { target: "", scope: "screen", risk_confirmed: true }, scope: ["display-read"], expected: "อ่านเนื้อหาหน้าจอจริงได้" });
  await runOp(5, { label: "POINTER MOVE", op: "pointer_move", ui: { coordinate: mid, scope: "screen", risk_confirmed: true }, expected: "ตัวชี้ย้ายไปพิกัดที่สั่ง" });
  await runOp(6, { label: "CLICK", op: "click", ui: { coordinate: mid, scope: "screen", risk_confirmed: true }, expected: "clicks เพิ่มขึ้น" });
  await runOp(7, { label: "DOUBLE_CLICK", op: "double_click", ui: { coordinate: mid, scope: "screen", risk_confirmed: true }, expected: "dbls เพิ่มขึ้น" });
  await runOp(8, { label: "SCROLL", op: "scroll", ui: { coordinate: mid, delta_y: -400, scope: "screen", risk_confirmed: true }, expected: "sy เปลี่ยน" });
  await runOp(9, { label: "DRAG", op: "drag", ui: { coordinate: mid, end: { x: mid.x - 220, y: mid.y }, scope: "screen", risk_confirmed: true }, expected: "dl เปลี่ยน" });
  await runOp(10, { label: "TYPE", op: "type", ui: { text: "dnaos owner surface acceptance", scope: "ui-control" }, expected: "in เปลี่ยนเป็นข้อความที่พิมพ์" });
  await runOp(11, { label: "KEY", op: "key", ui: { key: "Tab", scope: "ui-control" }, expected: "st เปลี่ยนเป็น key:Tab" });
  await runOp(12, { label: "NAVIGATION", op: "click", ui: { coordinate: nav, scope: "screen", risk_confirmed: true }, expected: "clicks เพิ่มขึ้น / v เปลี่ยน view" });

  try { revokeAuthority(AUTH); } catch { /* lease หมดอายุเองอยู่แล้ว */ }

  const out = join(BASE, `owner-surface-acceptance-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify({ surface: SURFACE, originator: ORIGINATOR, owner_session_id: SID, authority_id: AUTH, chrome_pid: PID, published_state_at_start: st, operations: records }, null, 1));
  const v = records.filter((r) => r.EFFECT_VERDICT === "VERIFIED").length;
  const f = records.filter((r) => r.EFFECT_VERDICT === "FAILED").length;
  const u = records.length - v - f;
  console.log(`\nVERIFIED=${v}  FAILED=${f}  UNPROVEN/NO_VERDICT=${u}`);
  console.log(`report: ${out}`);
}

void main();
