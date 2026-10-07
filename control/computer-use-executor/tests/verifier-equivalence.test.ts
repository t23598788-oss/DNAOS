/**
 * หน้าที่: prove that moving the primitive rules to one semantic owner changed
 * WHERE they live and nothing about WHAT they mean (Owner, 2026-09-02).
 *
 * WHY THIS EXISTS. Step 5 needed a runtime effect verdict, and the rules it
 * needs already existed inside ./tools/acceptance-verifier.ts `conditionMet`.
 * Two copies of those rules would drift the moment either was edited, so
 * `conditionMet` now delegates to ../expectation.ts + ../effect-verdict.ts.
 * A delegation is only safe if it is behaviour-identical, and "the 37 existing
 * cases still pass" is weaker than it sounds — those cases were chosen to catch
 * the known false positive, not to pin every branch.
 *
 * SO THIS COMPARES AGAINST THE ORIGINAL. `originalConditionMet` below is the
 * pre-refactor body, copied verbatim, kept only as the reference. Every
 * operation is run against a full cross-product of before/after states and
 * intents, and any single disagreement fails. The states include the ones that
 * matter and the awkward ones: counters going backwards, identical states,
 * empty strings, targets already focused, unknown operations.
 *
 * Input: none.  Output: exit code 0 (all agreed) or 1.
 * Dependency ที่อนุญาต: ../tools/acceptance-verifier, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามแก้ `originalConditionMet` ให้ตรงกับของใหม่ — มันคือ
 * ตัวอ้างอิงว่าความหมายเดิมคืออะไร ถ้าไม่ตรงคือของใหม่ผิด.
 */
import { conditionMet, type EffectState } from "../tools/acceptance-verifier";

interface Intent { expectedType?: string; target?: string; intent?: string }

/** VERBATIM pre-refactor logic. The reference for "what the locked rules mean". */
function originalConditionMet(op: string, before: EffectState, after: EffectState, opts?: Intent): boolean {
  const intent = opts?.intent, target = opts?.target;
  switch (op) {
    case "click":
      if (intent === "focus") return !!target && after.activeElement === target && before.activeElement !== target;
      return after.clicks > before.clicks;
    case "double_click": return after.dbls > before.dbls && /DOUBLECLICK/i.test(after.state);
    case "scroll": return after.scrollY !== before.scrollY;
    case "drag": return after.dragLeft !== before.dragLeft;
    case "type": return !!opts?.expectedType && after.input === opts.expectedType;
    case "key": return /KEY:/i.test(after.state) && after.state !== before.state;
    default: return false;
  }
}

const S = (o: Partial<EffectState>): EffectState => ({
  clicks: 0, dbls: 0, state: "", input: "", scrollY: 0, dragLeft: 0,
  activeElement: "body", maxScrollY: 2400, wheelCount: 0, wheelDeltaY: 0, wheelMode: 0, wheelTarget: "", ...o,
});

/** Values chosen so each field crosses every boundary the rules can notice. */
const CLICKS = [0, 1, 2];
const DBLS = [0, 1];
const STATES = ["", "SANDBOX READY", "CLICK #1", "DOUBLECLICK #1", "KEY: Tab", "KEY: Enter"];
const INPUTS = ["", "9070-123456", "other"];
const SCROLLS = [0, 600, -600];
const DRAGS = [72, 366];
const FOCI = ["body", "testinput", ""];

const OPS = ["click", "double_click", "scroll", "drag", "type", "key", "pointer_move", "focus", "screenshot", "", "SCROLL"];
const INTENTS: Intent[] = [
  {}, { intent: "activate" }, { intent: "focus" }, { intent: "focus", target: "testinput" },
  { intent: "focus", target: "" }, { target: "testinput" },
  { expectedType: "9070-123456" }, { expectedType: "" }, { expectedType: "other" },
];

let compared = 0;
const disagreements: string[] = [];

for (const op of OPS) {
  for (const opts of INTENTS) {
    for (const c of CLICKS) for (const d of DBLS) for (const st of STATES) for (const inp of INPUTS)
      for (const sy of SCROLLS) for (const dl of DRAGS) for (const af of FOCI) {
        const before = S({ clicks: 0, dbls: 0, state: "SANDBOX READY", input: "", scrollY: 0, dragLeft: 72, activeElement: "body" });
        const after = S({ clicks: c, dbls: d, state: st, input: inp, scrollY: sy, dragLeft: dl, activeElement: af });
        const want = originalConditionMet(op, before, after, opts);
        const got = conditionMet(op, before, after, opts);
        compared += 1;
        if (want !== got && disagreements.length < 10) {
          disagreements.push(`op=${op} opts=${JSON.stringify(opts)} after={clicks:${c},dbls:${d},state:"${st}",input:"${inp}",scrollY:${sy},dragLeft:${dl},activeElement:"${af}"} original=${want} delegated=${got}`);
        }
      }
  }
}

// The BEFORE state matters too — vary it against a fixed AFTER so backwards
// counters, unchanged values and already-focused targets are all covered.
for (const op of OPS) {
  for (const opts of INTENTS) {
    for (const c of CLICKS) for (const st of STATES) for (const sy of SCROLLS) for (const af of FOCI) {
      const before = S({ clicks: c, dbls: 1, state: st, input: "9070-123456", scrollY: sy, dragLeft: 366, activeElement: af });
      const after = S({ clicks: 1, dbls: 1, state: "DOUBLECLICK #1", input: "9070-123456", scrollY: 600, dragLeft: 366, activeElement: "testinput" });
      const want = originalConditionMet(op, before, after, opts);
      const got = conditionMet(op, before, after, opts);
      compared += 1;
      if (want !== got && disagreements.length < 10) {
        disagreements.push(`op=${op} opts=${JSON.stringify(opts)} before={clicks:${c},state:"${st}",scrollY:${sy},activeElement:"${af}"} original=${want} delegated=${got}`);
      }
    }
  }
}

const ok = disagreements.length === 0;
console.log(`${ok ? "PASS" : "FAIL"}  delegated conditionMet agrees with the original on all ${compared} combinations`);
for (const d of disagreements) console.log(`      ${d}`);
console.log(`\n${ok ? "ALL PASSED" : `${disagreements.length}+ DISAGREEMENTS`}`);
process.exit(ok ? 0 : 1);
