/**
 * DNA OS Computer-Use PHYSICAL ACCEPTANCE RUNNER
 *
 * ── ใครรัน ──
 * **OWNER เป็นผู้เริ่ม** (START_PHYSICAL_ACCEPTANCE):
 *     npx tsx control/computer-use-executor/tools/physical-acceptance-runner.ts
 * Claude/Agent ห้ามรันไฟล์นี้ (จะกลายเป็น originator ของ physical control — boundary)
 * เมื่อ Owner รัน = Owner เป็น originator; runner สร้าง Work Orders ให้เอง
 *
 * ── ทำอะไร ──
 * resolve Owner session (canonical owner-authentication — Owner ไม่ต้อง copy id),
 * grant bounded task authority ผ่าน Policy V2 (Owner ไม่ต้อง copy lease),
 * เปิด safe local sandbox (control/computer-use-executor/sandbox/acceptance-sandbox.html)
 * แล้วสั่ง 17 ขั้นผ่าน canonical path: WorkOrder→inbox→daemon(launchd)→Policy V2→Authority→executor→os-ui→helper→Evidence
 * ทุก physical op เก็บ before/after screenshot เป็นหลักฐาน (dispatch COMPLETED อย่างเดียวไม่พอ)
 *
 * ── reuse เท่านั้น ── owner-authentication + computer-use-policy + computer-use-authority
 * + daemon + executor + os-ui (ไม่มี architecture ใหม่)
 *
 * หมายเหตุพิกัด: sandbox วาง band เต็มความกว้าง (x ยืดหยุ่น) พิกัดเป็น logical points
 * สมมติ Chrome เปิดเต็มจอบนจอหลัก ถ้าพิกัดคลาด band สูง 120px ยังพอรับ + before/after
 * screenshot จะบอกผลจริง
 */
import { authenticateOwner, grantAuthorityAsOwner } from "../../owner-authentication/contract";
import { readPreauthorization, completeJob } from "../../computer-use-policy/contract";
import { revokeAuthority } from "../../computer-use-authority/contract";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { verifyRun, pointInside, conditionMet, type EffectState, type StepEvidence, type Bounds } from "./acceptance-verifier";

const BASE = join(process.cwd(), "control/computer-use-executor/data");
const SANDBOX = join(process.cwd(), "control/computer-use-executor/sandbox/acceptance-sandbox.html");
const SHOTDIR = join(process.cwd(), "connections/os-ui/data/screenshots");
const CALIBRATOR = join(process.cwd(), "control/computer-use-executor/tools/calibrate-sandbox.py");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let SID = "", AUTH = "", CHROME_PID = 0;

/** ขนาดจอ logical จริง (points) — ใช้คิดพิกัดแบบ fraction เลิกเดา absolute px */
function screenSize(): { W: number; H: number } {
  try {
    const out = execFileSync("/usr/bin/osascript", ["-e", 'tell application "Finder" to get bounds of window of desktop'], { encoding: "utf8", timeout: 4000 });
    const m = out.trim().split(",").map((s) => parseInt(s.trim(), 10));
    if (m.length === 4 && m[2] > 0 && m[3] > 0) return { W: m[2], H: m[3] };
  } catch { /* fallback */ }
  return { W: 1440, H: 900 };
}
/** ดึง kiosk Chrome (sandbox) กลับมา frontmost ก่อนทุก physical op — กัน VS Code/overlay แย่ง focus
 *  แล้ว CGEvent/keystroke จึงตกที่ sandbox จริง ไม่ใช่หน้าต่างอื่น (root cause รอบก่อน) */
function activateChrome(): void {
  try {
    if (CHROME_PID > 0) {
      // เจาะ process ของ kiosk ด้วย unix id — เลี่ยง two-process ambiguity (Owner มี Chrome หลักรันอยู่)
      execFileSync("/usr/bin/osascript", ["-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${CHROME_PID}) to true`], { timeout: 4000 });
    } else {
      execFileSync("/usr/bin/osascript", ["-e", 'tell application "Google Chrome" to activate'], { timeout: 4000 });
    }
  } catch { /* best-effort */ }
}

/** อ่าน effect-state จริงของ sandbox จาก document.title ผ่าน System Events (เจาะ CHROME_PID
 *  → ไม่มี two-Chrome ambiguity, ใช้ Accessibility ที่ granted แล้ว). คืน null ถ้าอ่านไม่ได้
 *  (verifier จะตัดสิน NOT_PROVEN เมื่อไม่มีหลักฐาน — ปลอดภัย ไม่ false-positive) */
function readState(): EffectState | null {
  if (CHROME_PID <= 0) return null;
  let out = "";
  try { out = execFileSync("/usr/bin/osascript", ["-e", `tell application "System Events" to tell (first process whose unix id is ${CHROME_PID}) to get name of windows`], { encoding: "utf8", timeout: 4000 }); } catch { return null; }
  const seg = out.split(",").map((s) => s.trim()).find((s) => s.startsWith("DNAOS|"));
  if (!seg) return null;
  const title = seg.replace(/ - Google Chrome$/, "");
  const kv: Record<string, string> = {};
  for (const part of title.split("|")) { const i = part.indexOf("="); if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1); }
  return { clicks: +(kv.clicks ?? 0), dbls: +(kv.dbls ?? 0), state: kv.st ?? "", input: kv.in ?? "", scrollY: +(kv.sy ?? 0), dragLeft: +(kv.dl ?? 0), activeElement: kv.af ?? "", maxScrollY: +(kv.mx ?? 0), wheelCount: +(kv.wc ?? 0), wheelDeltaY: +(kv.wdy ?? 0), wheelMode: +(kv.wdm ?? 0), wheelTarget: kv.wt ?? "" };
}

function writeWO(id: string, op: string, ui: object, target = "screen", scope: string[] = ["ui-control"]): void {
  mkdirSync(join(BASE, "inbox"), { recursive: true });
  writeFileSync(join(BASE, "inbox", `${id}.json`), JSON.stringify({ work_order_id: id, owner_session_id: SID, authority_id: AUTH, requester: "owner:acceptance-runner", operation: op, target, scope_needed: scope, ui }));
}
async function awaitResult(id: string, timeoutMs = 12000): Promise<Record<string, unknown> | null> {
  const p = join(BASE, "results", `${id}.json`);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8")); await sleep(500); }
  return null;
}
/** รอผลพร้อม "ตรึง" Chrome ให้ frontmost ตลอดช่วง — daemon poll ทุก ~2s จึงมี gap ระหว่าง
 *  activate กับตอน CGEvent ยิงจริง; ถ้าไม่ตรึง focus อาจถูก VS Code/overlay แย่งใน gap นั้น
 *  ทำให้ CGEvent ตกหน้าต่างผิด (click step4 พลาดแต่ step5 ลง = อาการ jitter นี้) */
async function awaitResultKeepFront(id: string, timeoutMs = 14000): Promise<Record<string, unknown> | null> {
  const p = join(BASE, "results", `${id}.json`);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8"));
    activateChrome();
    await sleep(400);
  }
  return null;
}
function newestShot(): string | null {
  if (!existsSync(SHOTDIR)) return null;
  const files = readdirSync(SHOTDIR).filter((f) => f.endsWith(".png")).map((f) => join(SHOTDIR, f));
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}
async function shot(tag: string): Promise<string | null> {
  activateChrome(); await sleep(350); // ให้ screenshot จับ sandbox (ไม่ใช่ VS Code) เพื่อ verify ได้จริง
  const id = `acc-shot-${tag}-${Date.now()}`;
  writeWO(id, "screenshot", { target: "", scope: "screen", risk_confirmed: true }, "screen", ["display-read"]);
  const r = await awaitResult(id);
  await sleep(300);
  return r && r.executed ? newestShot() : null;
}
interface VerifyOpts { point?: { x: number; y: number }; bounds?: Bounds; dropRegion?: Bounds; end?: { x: number; y: number }; expectedType?: string; target?: string; intent?: string; preMove?: { x: number; y: number }; scrollBounds?: Bounds; }
const VERIFY_OPS = new Set(["click", "double_click", "scroll", "drag", "type", "key"]);

async function step(n: number, op: string, ui: object, target = "screen", scope: string[] = ["ui-control"], withBeforeAfter = true, verify?: VerifyOpts): Promise<Record<string, unknown>> {
  const before = withBeforeAfter ? await shot(`${n}-${op}-before`) : null;
  activateChrome(); await sleep(350); // sandbox กลับมา frontmost ก่อนยิง op → event ตกที่ sandbox จริง
  const stateBefore = readState();     // effect-state ก่อน op (จาก sandbox จริง)

  // ── TARGETING PRECONDITION: จุด calibrate ต้องอยู่ในกรอบ target จริง มิฉะนั้นห้ามยิง ──
  const pre: string[] = [];
  if (verify?.point) { if (!pointInside(verify.point, verify.bounds ?? null)) pre.push(`CALIBRATED_POINT_INSIDE_TARGET=NO point=${JSON.stringify(verify.point)} bounds=${JSON.stringify(verify.bounds)}`); }
  if (op === "drag" && verify?.end) { if (!pointInside(verify.end, verify.dropRegion ?? null)) pre.push(`DRAG_END_INSIDE_DROP_REGION=NO end=${JSON.stringify(verify.end)}`); }
  if (op === "scroll") {
    // SCROLL_TARGET ต้องเป็นจุดในโซน scrollable body (ไม่ทับ fixed control) + DOCUMENT_SCROLLABLE
    if (!verify?.preMove || !pointInside(verify.preMove, verify?.scrollBounds ?? null)) pre.push(`SCROLL_TARGET_INSIDE_SCROLLABLE=NO preMove=${JSON.stringify(verify?.preMove)} region=${JSON.stringify(verify?.scrollBounds)}`);
    if (!stateBefore || stateBefore.maxScrollY <= 0) pre.push(`DOCUMENT_SCROLLABLE=NO maxScrollY=${stateBefore?.maxScrollY}`);
  }
  if (pre.length > 0) {
    const rec = { step: n, work_order_id: `acc-${n}-${op}-skip`, operation: op, originator: "OWNER→acceptance-runner", result: `CALIBRATION_FAILED: ${pre.join("; ")}`, executed: false, dispatched: false, evidence_id: null, before_screenshot: before, after_screenshot: null, state_before: stateBefore, state_after: null };
    console.log(`  [${n}] ${op.padEnd(13)} SKIPPED — ${pre.join("; ")}`);
    return rec;
  }

  // ── SCROLL PRE-POSITION: ย้าย pointer ไปโซน scrollable body ที่ verify แล้ว ก่อนยิง wheel ──
  // (scroll wheel ไม่มีพิกัด → ตกที่หน้าต่างใต้ cursor; ถ้าไม่ reposition = residual cursor = intermittent)
  if (verify?.preMove) {
    const mvId = `acc-${n}-premove-${Date.now()}`;
    writeWO(mvId, "pointer_move", { coordinate: verify.preMove, scope: "screen", risk_confirmed: true });
    await awaitResultKeepFront(mvId);
    await sleep(300);
  }

  const id = `acc-${n}-${op}-${Date.now()}`;
  writeWO(id, op, ui, target, scope);
  const r = await awaitResultKeepFront(id); // ตรึง Chrome frontmost ตลอดจน daemon execute เสร็จ

  // ── EFFECT SYNCHRONIZATION: poll จน expected effect condition จริง หรือ timeout (ไม่ใช้ fixed sleep ตัดสิน) ──
  let stateAfter = stateBefore;
  let synced = false;
  if (VERIFY_OPS.has(op) && stateBefore) {
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      const s = readState();
      if (s) { stateAfter = s; if (conditionMet(op, stateBefore, s, { expectedType: verify?.expectedType, target: verify?.target, intent: verify?.intent })) { synced = true; break; } }
      activateChrome(); await sleep(300);
    }
  } else { await sleep(400); stateAfter = readState() ?? stateBefore; }

  const after = withBeforeAfter ? await shot(`${n}-${op}-after`) : null;
  const rec = { step: n, work_order_id: id, operation: op, target: verify?.target ?? null, intent: verify?.intent ?? null, originator: "OWNER→acceptance-runner", result: r?.result_status ?? r?.reason ?? "NO_RESULT", executed: r?.executed ?? false, dispatched: true, execution_owner: r?.execution_owner ?? null, evidence_id: r?.evidence_id ?? null, before_screenshot: before, after_screenshot: after, state_before: stateBefore, state_after: stateAfter, effect_synced: synced };
  console.log(`  [${n}] ${op.padEnd(13)} exec=${rec.executed} synced=${synced} state:${stateBefore ? `${stateBefore.clicks}/${stateBefore.dbls}` : "-"}→${stateAfter ? `${stateAfter.clicks}/${stateAfter.dbls} "${stateAfter.state}"` : "-"}`);
  return rec;
}

async function main(): Promise<void> {
  console.log("=== DNA OS PHYSICAL ACCEPTANCE (Owner-originated) ===");
  const a = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 900 });
  if (!a.ok) { console.log("OWNER_AUTH FAILED:", a.reason_code, "— รันไฟล์นี้บนเครื่องที่ Owner ล็อกอินอยู่"); process.exit(1); }
  SID = a.session.session_id;
  console.log(`OWNER authenticated: ${a.session.owner_identity} via ${a.session.authenticated_via}`);

  const pol = readPreauthorization();
  console.log(`Policy V2: PREAUTHORIZED=${pol.preauthorized ? "ON" : "OFF"} — Owner physically started acceptance = task approval`);
  const g = grantAuthorityAsOwner(SID, { requester: "owner:acceptance-runner", executor: "control/computer-use-executor", capability: "connections/os-ui", operations: ["screenshot", "read_screen", "pointer_move", "click", "double_click", "scroll", "drag", "focus", "type", "key"], target: "screen", scope: ["ui-control", "display-read"], ttl_seconds: 600 });
  if (!("lease" in g) || !g.ok) { console.log("GRANT FAILED:", (g as { reason_code?: string }).reason_code); process.exit(1); }
  AUTH = g.lease.authority_id;
  console.log(`task authority: ${AUTH} (bounded ttl 600s)`);

  // เปิด sandbox แบบ KIOSK เต็มจอ + โปรไฟล์แยก → viewport เต็มจอ origin (0,0)
  // ทำให้ CSS px ≈ screen point (CGEvent ใช้ logical points) พิกัดจึงตรงจริง
  // (รอบก่อน --app เป็นหน้าต่างธรรมดา ไม่เต็มจอ → พิกัด CSS ไม่ตรง screen → click/drag/type ไม่โดนเป้า)
  const CHROME_PROFILE = "/tmp/dnaos-accept-profile";
  const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  try { execFileSync("/bin/rm", ["-rf", CHROME_PROFILE], { timeout: 4000 }); } catch { /* โปรไฟล์ใหม่ทุกครั้ง → เริ่มที่ scroll y=0 */ }
  // launch Chrome BINARY ตรง (ไม่ผ่าน `open`) → honor --kiosk เสมอ แม้ Chrome หลักของ Owner รันอยู่
  // (รอบก่อน open -na ถูก instance เดิมเพิกเฉย flag → ได้หน้าต่างมี tab bar ไม่เต็มจอ → พิกัดคลาด)
  try {
    const child = spawn(CHROME_BIN, [`--user-data-dir=${CHROME_PROFILE}`, "--no-first-run", "--no-default-browser-check", "--disable-session-crashed-bubble", "--kiosk", `file://${SANDBOX}`], { detached: true, stdio: "ignore" });
    CHROME_PID = child.pid ?? 0;
    child.unref();
  } catch { /* ถ้าเปิดไม่ได้ step จะสะท้อนผลเอง */ }
  console.log(`kiosk Chrome pid=${CHROME_PID} (isolated profile, direct-binary launch)`);
  await sleep(5000);

  // RUNTIME CALIBRATION: ถ่าย sandbox แล้วสแกนสีสด หา screen-y จริงของแต่ละ target
  // (เลิกพึ่ง CSS vh→screen ที่เรนเดอร์ไม่นิ่ง — รอบก่อน clickband ตก y≈75 ไม่ใช่ 270)
  const { W, H } = screenSize();
  const calImg = await shot("calibrate");
  let cal: { cleanX?: number; clickY?: number; dragY?: number; inputY?: number; boxX?: number; boxY?: number; clickBounds?: Bounds; boxBounds?: Bounds; inputBounds?: Bounds } = {};
  if (calImg) { try { cal = JSON.parse(execFileSync("/usr/bin/python3", [CALIBRATOR, calImg, String(W), String(H)], { encoding: "utf8", timeout: 15000 })); } catch (e) { console.log("calibrate error:", e instanceof Error ? e.message : String(e)); } }
  const cx = cal.cleanX ?? Math.round(0.25 * W);
  const boxX = cal.boxX ?? Math.round(0.14 * W), boxY = cal.boxY ?? Math.round(0.52 * H);
  const CLICK = { x: cx, y: cal.clickY ?? Math.round(0.25 * H) };   // clickband center (largest-blob)
  const DRAG0 = { x: boxX, y: boxY };                                // กล่อง DRAG (largest-blob — ไม่โดน stray-orange พิษ)
  const DRAG1 = { x: Math.min(boxX + 280, Math.round(0.42 * W)), y: boxY }; // ลากขวาในแนว y เดิม ยังซ้าย overlay
  const INPUTC = { x: cx, y: cal.inputY ?? Math.round(0.77 * H) };   // input band center
  const CLICK_B = cal.clickBounds, BOX_B = cal.boxBounds, INPUT_B = cal.inputBounds;
  // drop region ของ drag = แนว y ของกล่อง (±40) ทั้งความกว้างซ้าย-overlay → ลากแนวนอนได้
  const DROP_B: Bounds | undefined = BOX_B ? { x0: 0, x1: Math.round(0.45 * W), y0: BOX_B.y0 - 40, y1: BOX_B.y1 + 40 } : undefined;
  // SCROLL target = โซน dark body ระหว่าง clickband กับ box (ไม่ทับ fixed control ใด ๆ) — deterministic scroll
  const SCROLL_B: Bounds | undefined = (CLICK_B && BOX_B && BOX_B.y0 - CLICK_B.y1 > 20) ? { x0: CLICK_B.x0, x1: CLICK_B.x1, y0: CLICK_B.y1 + 4, y1: BOX_B.y0 - 4 } : undefined;
  const SCROLLPT = SCROLL_B ? { x: cx, y: Math.round((SCROLL_B.y0 + SCROLL_B.y1) / 2) } : { x: cx, y: Math.round(0.5 * H) };
  console.log(`calibrated: click=${JSON.stringify(CLICK)}∈${JSON.stringify(CLICK_B)} drag=${JSON.stringify(DRAG0)}→${JSON.stringify(DRAG1)}∈${JSON.stringify(BOX_B)} input=${JSON.stringify(INPUTC)}∈${JSON.stringify(INPUT_B)}`);

  // CANONICAL AUTHORITY TARGET = "screen" สำหรับทุก op (grant ก็ target:"screen")
  // เพราะทุก op คือการควบคุม pointer/keyboard ที่พิกัดหน้าจอจริง — lease.target ต้อง
  // ตรงกับ wo.target แบบ identity เดียว (ไม่ wildcard) ส่วน chrome คือ os-ui `ui.app`
  // ที่ยัง enforce app-allowlist ของ os-ui อยู่ (คนละชั้นกับ authority target)
  // พิกัด (kiosk fullscreen → CSS px ≈ screen point) ฝั่งซ้าย x≈260 เพื่อเลี่ยง
  // overlay always-on-top ที่อยู่กลาง-ขวาจอ (band ใน sandbox เต็มความกว้าง คลิกซ้ายก็โดน)
  //   clickband y170-320 (center 245) · dragband y380-530 box center (115,455) · inputwrap y600-720 (center 660)
  const recs: Record<string, unknown>[] = [];
  recs.push(await step(1, "screenshot", { target: "", scope: "screen", risk_confirmed: true }, "screen", ["display-read"], false));
  recs.push(await step(2, "pointer_move", { coordinate: CLICK, scope: "screen", risk_confirmed: true }));
  recs.push(await step(3, "focus", { app: "chrome", scope: "known-app", risk_confirmed: true }, "screen"));
  recs.push(await step(4, "click", { coordinate: CLICK, app: "chrome", scope: "known-app", risk_confirmed: true }, "screen", ["ui-control"], true, { point: CLICK, bounds: CLICK_B, target: "clickband", intent: "activate" }));
  recs.push(await step(5, "double_click", { coordinate: CLICK, scope: "screen", risk_confirmed: true }, "screen", ["ui-control"], true, { point: CLICK, bounds: CLICK_B, target: "clickband" }));
  recs.push(await step(6, "scroll", { delta: { dx: 0, dy: -600 }, scope: "screen", risk_confirmed: true }, "screen", ["ui-control"], true, { preMove: SCROLLPT, scrollBounds: SCROLL_B }));
  recs.push(await step(7, "scroll", { delta: { dx: 0, dy: 600 }, scope: "screen", risk_confirmed: true }, "screen", ["ui-control"], true, { preMove: SCROLLPT, scrollBounds: SCROLL_B }));
  recs.push(await step(8, "drag", { coordinate: DRAG0, coordinate2: DRAG1, scope: "screen", risk_confirmed: true }, "screen", ["ui-control"], true, { point: DRAG0, bounds: BOX_B, end: DRAG1, dropRegion: DROP_B }));
  recs.push(await step(9, "click", { coordinate: INPUTC, app: "chrome", scope: "known-app", risk_confirmed: true }, "screen", ["ui-control"], true, { point: INPUTC, bounds: INPUT_B, target: "testinput", intent: "focus" }));  // focus text input
  const TYPE_TOKEN = `9070-${String(Date.now()).slice(-6)}`; // digits+hyphen only → layout-invariant (keystroke ไทยทำตัวอักษรเพี้ยน)
  console.log(`EXPECTED_TYPE_VALUE = ${TYPE_TOKEN}`);
  recs.push(await step(10, "type", { text: TYPE_TOKEN, app: "chrome", scope: "known-app", risk_confirmed: true }, "screen", ["ui-control"], true, { expectedType: TYPE_TOKEN }));
  recs.push(await step(11, "key", { key: "TAB", app: "chrome", scope: "known-app", risk_confirmed: true }, "screen", ["ui-control"], true, {}));
  recs.push(await step(12, "read_screen", { app: "chrome", target: "chrome", scope: "known-app", risk_confirmed: true }, "screen", ["display-read"], false));
  recs.push(await step(13, "screenshot", { target: "", scope: "screen", risk_confirmed: true }, "screen", ["display-read"], false));

  // 15-17: complete → revoke → post-revoke DENY
  completeJob(AUTH); revokeAuthority(AUTH);
  console.log("JOB_COMPLETED → authority revoked");
  const denyId = `acc-postrevoke-${Date.now()}`;
  writeWO(denyId, "screenshot", { target: "", scope: "screen", risk_confirmed: true }, "screen", ["display-read"]);
  const deny = await awaitResult(denyId);
  console.log(`post-revoke screenshot: executed=${deny?.executed} reason=${deny?.reason} (ต้อง DENY)`);

  // ── EFFECT-BASED VERIFICATION (ไม่แปลง COMPLETED เป็น PASS) ──
  // map แต่ละ step → StepEvidence (before/after จริง) → verifyRun ตัดสิน PASS/NOT_PROVEN
  const evidence: StepEvidence[] = recs
    .filter((s) => VERIFY_OPS.has(s.operation as string))
    .map((s) => ({
      op: s.operation as string,
      target: (s.target as string | null) ?? undefined,
      intent: (s.intent as string | null) ?? undefined,
      dispatch: String(s.result),
      before: (s.state_before as EffectState | null) ?? null,
      after: (s.state_after as EffectState | null) ?? null,
      expectedType: s.operation === "type" ? TYPE_TOKEN : undefined,
    }));
  const verification = verifyRun(evidence);
  console.log("\n=== EFFECT-BASED VERDICTS (verifier — ไม่นับ COMPLETED เป็น PASS) ===");
  for (const r of verification.results) console.log(`  ${r.op.padEnd(13)} ${r.verdict.padEnd(11)} ${r.reason}`);
  console.log(`PHYSICAL_COMPUTER_USE = ${verification.proven ? "END_TO_END_PROVEN" : "NOT_PROVEN"}`);

  const out = { owner: a.session.owner_identity, authority_id: AUTH, preauthorized: pol.preauthorized, daemon: "launchd com.dnaos.computer-use-executor", steps: recs, type_expected: TYPE_TOKEN, post_revoke: { work_order_id: denyId, executed: deny?.executed, reason: deny?.reason }, verification, physical_computer_use: verification.proven ? "END_TO_END_PROVEN" : "NOT_PROVEN" };
  const outPath = join(BASE, `acceptance-result-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`\nACCEPTANCE RESULT saved: ${outPath}`);

  // ปิดเฉพาะ kiosk instance ของ acceptance (โปรไฟล์แยก) — กัน Owner ติดใน fullscreen
  // ไม่กระทบ Chrome หลักของ Owner (คนละ user-data-dir)
  if (CHROME_PID > 0) { try { execFileSync("/bin/kill", [String(CHROME_PID)], { timeout: 4000 }); } catch { /* ปิดไปแล้ว */ } }
  try { execFileSync("/usr/bin/pkill", ["-f", "dnaos-accept-profile"], { timeout: 5000 }); } catch { /* ปิดไปแล้ว/ไม่มี */ }

  console.log("→ ให้ Claude อ่านไฟล์นี้ + before/after screenshots เพื่อ VERIFY (Claude = observer/verifier ไม่ใช่ originator)");
}
void main();
