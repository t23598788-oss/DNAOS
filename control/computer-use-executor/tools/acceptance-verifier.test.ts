/**
 * Regression: acceptance verifier ต้อง "ปฏิเสธ false positive" — dispatch COMPLETED/executed=true
 * โดยไม่มี effect delta = NOT_PROVEN เสมอ (บั๊กที่ run 1788243297532 เปิดโปง)
 * รัน: npx tsx control/computer-use-executor/tools/acceptance-verifier.test.ts
 */
import { verifyPrimitive, verifyRun, pointInside, conditionMet, EffectState } from "./acceptance-verifier";

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}
const S = (o: Partial<EffectState>): EffectState => ({ clicks: 0, dbls: 0, state: "", input: "", scrollY: 0, dragLeft: 0, activeElement: "body", maxScrollY: 2400, wheelCount: 0, wheelDeltaY: 0, wheelMode: 0, wheelTarget: "", ...o });

// ── FALSE-POSITIVE REGRESSIONS (หัวใจที่ Owner สั่ง) ──
// COMPLETED + clicks 0->0 => CLICK NOT_PROVEN
eq("click: COMPLETED แต่ clicks 0->0 => NOT_PROVEN",
  verifyPrimitive({ op: "click", dispatch: "COMPLETED", before: S({ clicks: 0 }), after: S({ clicks: 0 }) }).verdict, "NOT_PROVEN");
// COMPLETED + dbls 0->0 => DOUBLE_CLICK NOT_PROVEN
eq("double_click: COMPLETED แต่ dbls 0->0 => NOT_PROVEN",
  verifyPrimitive({ op: "double_click", dispatch: "COMPLETED", before: S({ dbls: 0 }), after: S({ dbls: 0 }) }).verdict, "NOT_PROVEN");
// dbls เพิ่มแต่ state ไม่ใช่ DOUBLECLICK => NOT_PROVEN
eq("double_click: dbls 0->1 แต่ state!=DOUBLECLICK => NOT_PROVEN",
  verifyPrimitive({ op: "double_click", dispatch: "COMPLETED", before: S({ dbls: 0, state: "CLICK #1" }), after: S({ dbls: 1, state: "CLICK #3" }) }).verdict, "NOT_PROVEN");
// ไม่มี before/after => NOT_PROVEN (COMPLETED ก็ไม่ช่วย)
eq("click: ไม่มี after (COMPLETED) => NOT_PROVEN",
  verifyPrimitive({ op: "click", dispatch: "COMPLETED", before: S({ clicks: 0 }), after: null }).verdict, "NOT_PROVEN");

// ── TRUE POSITIVES (effect จริง) ──
eq("click: clicks 0->1 => PASS",
  verifyPrimitive({ op: "click", dispatch: "COMPLETED", before: S({ clicks: 0 }), after: S({ clicks: 1 }) }).verdict, "PASS");
eq("double_click: dbls 0->1 + DOUBLECLICK => PASS",
  verifyPrimitive({ op: "double_click", dispatch: "COMPLETED", before: S({ dbls: 0 }), after: S({ dbls: 1, state: "DOUBLECLICK #1" }) }).verdict, "PASS");
eq("scroll: scrollY 0->1534 => PASS",
  verifyPrimitive({ op: "scroll", dispatch: "COMPLETED", before: S({ scrollY: 0 }), after: S({ scrollY: 1534 }) }).verdict, "PASS");
eq("scroll: scrollY ไม่เปลี่ยน => NOT_PROVEN",
  verifyPrimitive({ op: "scroll", dispatch: "COMPLETED", before: S({ scrollY: 500 }), after: S({ scrollY: 500 }) }).verdict, "NOT_PROVEN");
eq("drag: dragLeft 60->366 => PASS",
  verifyPrimitive({ op: "drag", dispatch: "COMPLETED", before: S({ dragLeft: 60 }), after: S({ dragLeft: 366 }) }).verdict, "PASS");
eq("drag: dragLeft ไม่เปลี่ยน => NOT_PROVEN",
  verifyPrimitive({ op: "drag", dispatch: "COMPLETED", before: S({ dragLeft: 60 }), after: S({ dragLeft: 60 }) }).verdict, "NOT_PROVEN");
eq("type: input==expected => PASS",
  verifyPrimitive({ op: "type", dispatch: "COMPLETED", before: S({}), after: S({ input: "9070-278643" }), expectedType: "9070-278643" }).verdict, "PASS");
eq("type: input!=expected (เพี้ยน layout) => NOT_PROVEN",
  verifyPrimitive({ op: "type", dispatch: "COMPLETED", before: S({}), after: S({ input: "ฟฟฟฟฟ" }), expectedType: "DNAOS-CU" }).verdict, "NOT_PROVEN");
eq("key: state KEY: Tab => PASS",
  verifyPrimitive({ op: "key", dispatch: "COMPLETED", before: S({ state: "TYPED: x" }), after: S({ state: "KEY: Tab" }) }).verdict, "PASS");

// ── TARGET_CONTAINMENT (targeting precondition — กันกดผิด control) ──
const clickBounds = { x0: 24, x1: 681, y0: 279, y1: 408 };  // clickband จริง run 1788244866695
const boxBounds = { x0: 96, x1: 285, y0: 471, y1: 561 };    // drag box จริง (largest blob)
eq("containment: click point (360,343) inside clickband => true", pointInside({ x: 360, y: 343 }, clickBounds), true);
eq("containment: OLD boxY (162,299) NOT inside box => false (บั๊กเดิม drag ไปโดน clickband)", pointInside({ x: 162, y: 299 }, boxBounds), false);
eq("containment: OLD boxY (162,299) IS inside clickband => true (อธิบาย CLICK #1 จาก drag)", pointInside({ x: 162, y: 299 }, clickBounds), true);
eq("containment: NEW boxY (190,516) inside box => true", pointInside({ x: 190, y: 516 }, boxBounds), true);
eq("containment: null bounds => false (fail-closed)", pointInside({ x: 1, y: 1 }, null), false);

// ── EFFECT_SYNC condition (poll จนเงื่อนไขจริง; COMPLETED ไม่เกี่ยว) ──
eq("effect-sync click: clicks 0->0 => false (ยังไม่ครบ → poll ต่อ/timeout)", conditionMet("click", S({ clicks: 0 }), S({ clicks: 0 })), false);
eq("effect-sync click: clicks 0->1 => true", conditionMet("click", S({ clicks: 0 }), S({ clicks: 1 })), true);
eq("effect-sync double: dbls 0->1 + DOUBLECLICK => true", conditionMet("double_click", S({ dbls: 0 }), S({ dbls: 1, state: "DOUBLECLICK #1" })), true);
eq("effect-sync double: dbls 0->1 no DOUBLECLICK => false", conditionMet("double_click", S({ dbls: 0 }), S({ dbls: 1, state: "CLICK #3" })), false);
eq("effect-sync drag: dragLeft 72->72 => false", conditionMet("drag", S({ dragLeft: 72 }), S({ dragLeft: 72 })), false);
eq("effect-sync drag: dragLeft 72->366 => true", conditionMet("drag", S({ dragLeft: 72 }), S({ dragLeft: 366 })), true);
eq("effect-sync type: input==expected => true", conditionMet("type", S({}), S({ input: "9070-1" }), { expectedType: "9070-1" }), true);

// ── TARGET-AWARE CLICK (ACTION+TARGET+INTENT → EXPECTED EFFECT) — 8 เคสที่ Owner สั่ง ──
const clbC = (b: Partial<EffectState>, a: Partial<EffectState>) => verifyPrimitive({ op: "click", target: "clickband", intent: "activate", dispatch: "COMPLETED", before: S(b), after: S(a) }).verdict;
const inpC = (b: Partial<EffectState>, a: Partial<EffectState>) => verifyPrimitive({ op: "click", target: "testinput", intent: "focus", dispatch: "COMPLETED", before: S(b), after: S(a) }).verdict;
eq("1) clickband click + counter increase => PASS", clbC({ clicks: 0 }, { clicks: 1 }), "PASS");
eq("2) clickband click + no counter increase => NOT_PROVEN", clbC({ clicks: 3 }, { clicks: 3 }), "NOT_PROVEN");
eq("3) input click + activeElement=input => PASS", inpC({ activeElement: "body" }, { activeElement: "testinput" }), "PASS");
eq("4) input click + activeElement!=input => NOT_PROVEN", inpC({ activeElement: "body" }, { activeElement: "body" }), "NOT_PROVEN");
eq("5) input focus PASS แม้ clickband counter ไม่เปลี่ยน (clicks 3->3) => PASS", inpC({ activeElement: "body", clicks: 3 }, { activeElement: "testinput", clicks: 3 }), "PASS");
eq("6) wrong target receives focus => NOT_PROVEN", inpC({ activeElement: "body" }, { activeElement: "someotherfield" }), "NOT_PROVEN");
eq("7) COMPLETED without target effect (input) => NOT_PROVEN", inpC({ activeElement: "body" }, { activeElement: "body" }), "NOT_PROVEN");
eq("7b) COMPLETED without target effect (clickband) => NOT_PROVEN", clbC({ clicks: 5 }, { clicks: 5 }), "NOT_PROVEN");
eq("focus: before ก็ target อยู่แล้ว => NOT_PROVEN (พิสูจน์ gain ไม่ได้)", inpC({ activeElement: "testinput" }, { activeElement: "testinput" }), "NOT_PROVEN");
// effect-sync focus condition
eq("effect-sync click focus: body->testinput => true", conditionMet("click", S({ activeElement: "body" }), S({ activeElement: "testinput" }), { target: "testinput", intent: "focus" }), true);
eq("effect-sync click activate: clicks 0->1 => true", conditionMet("click", S({ clicks: 0 }), S({ clicks: 1 }), { target: "clickband", intent: "activate" }), true);

// ── verifyRun: มี 1 NOT_PROVEN => proven=false ──
const run = verifyRun([
  { op: "click", dispatch: "COMPLETED", before: S({ clicks: 0 }), after: S({ clicks: 0 }) },       // false positive
  { op: "type", dispatch: "COMPLETED", before: S({}), after: S({ input: "9070-1" }), expectedType: "9070-1" },
]);
eq("verifyRun: มี click NOT_PROVEN => proven=false", run.proven, false);

console.log(`\n${fail === 0 ? "ALL PASS" : "SOME FAILED"}  (${pass} pass, ${fail} fail)`);
if (fail > 0) process.exit(1);
