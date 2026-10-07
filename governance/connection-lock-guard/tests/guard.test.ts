/**
 * เทสต์นี้ล้มทันทีที่บล็อกที่ถูกล็อกเปลี่ยน — นั่นคือกลไกการล็อกทั้งหมด
 * งานทั่วไปที่ไปแตะคำศัพท์ทะเบียนหรือตาราง executor จะเห็นทันทีว่าเปลี่ยนอะไร
 */
import { verifyConnectionLocks, computeLockState, LOCKED_REGIONS, LOCKED_FILES } from "../contract";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}`); if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`); }
};

const state = computeLockState();
check("ทุกบล็อกที่ประกาศไว้ยังหาเจอในทรี", state.every((e) => e.problem === null), state.filter((e) => e.problem));
check(`ล็อกครบตามที่ประกาศ (${LOCKED_REGIONS.length} region + ${LOCKED_FILES.length} file)`,
  state.length === LOCKED_REGIONS.length + LOCKED_FILES.length, state.length);

const verdict = verifyConnectionLocks();
check("ไม่มี drift จากเส้นฐาน", verdict.ok, verdict.ok ? null : verdict);
if (!verdict.ok && verdict.reason_code === "DRIFT") {
  for (const d of verdict.drifted) console.log(`      DRIFT ${d.id}\n        เหตุผลที่ถูกล็อก: ${d.why}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
