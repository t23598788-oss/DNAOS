/**
 * DNA OS Computer-Use ACCEPTANCE VERIFIER (effect-based, pure)
 *
 * หน้าที่เดียว: ตัดสิน PASS/NOT_PROVEN ของแต่ละ physical primitive จาก **actual effect**
 * (before/after state ของ sandbox) เท่านั้น — **ห้าม** แปลง dispatch `COMPLETED`/`executed=true`
 * เป็น PASS เด็ดขาด (นั่นคือ false positive ที่ run 1788243297532 เปิดโปง: COMPLETED แต่ clicks=0)
 *
 * pure function ล้วน (ไม่มี I/O) → unit-test ได้ deterministic. ผู้เรียก (runner) เป็นคนเก็บ
 * before/after EffectState จริงจาก sandbox แล้วส่งเข้ามา
 */

import { OBSERVABLE_KEYS, buildExpectation, type DeclaredIntent } from "../expectation";
import { evaluateEffect } from "../effect-verdict";

/** conditionMet ไม่ขึ้นกับเวลา — ใช้ stamp คงที่ ไม่ให้ clock เข้ามาในการตัดสิน */
const FIXED_STAMP = new Date(0);

export interface EffectState {
  clicks: number;
  dbls: number;
  state: string;      // ข้อความ #state ล่าสุด (เช่น "CLICK #1", "DOUBLECLICK #1", "KEY: Tab", "SCROLL y=1534")
  input: string;      // ค่าในช่อง input
  scrollY: number;
  dragLeft: number;   // ตำแหน่ง left ของกล่อง drag (px)
  activeElement: string; // identity ของ document.activeElement (เช่น "testinput", "body") — direct focus evidence
  maxScrollY: number; // scrollHeight - clientHeight → ถ้า >0 = DOCUMENT_SCROLLABLE
  wheelCount: number;  // จำนวน DOM 'wheel' event ที่ได้รับ (delivery instrumentation)
  wheelDeltaY: number; // deltaY ล่าสุด
  wheelMode: number;   // deltaMode ล่าสุด (0=pixel,1=line,2=page)
  wheelTarget: string; // identity ของ event.target ล่าสุด
}

export type Verdict = "PASS" | "NOT_PROVEN";

/**
 * Verification contract = ACTION (op) + TARGET (identity คงที่) + INTENT → EXPECTED EFFECT
 * primitive อย่างเดียวไม่กำหนด expected effect — click บน clickband≠click บน input
 */
export interface StepEvidence {
  op: string;
  target?: string;                  // stable target identity เช่น "clickband", "testinput" (ไม่ใช่พิกัด)
  intent?: string;                  // "activate" | "focus" | …
  dispatch: string;                 // ผล dispatch (COMPLETED/…) — ใช้เป็น "ข้อมูล" เท่านั้น ไม่ใช่เกณฑ์ PASS
  before: EffectState | null;
  after: EffectState | null;
  expectedType?: string;            // สำหรับ op=type
}

export interface Intent { expectedType?: string; target?: string; intent?: string; }

export interface PrimitiveResult {
  op: string;
  verdict: Verdict;
  reason: string;
  before?: Partial<EffectState>;
  after?: Partial<EffectState>;
}

const P = (reason: string): { verdict: Verdict; reason: string } => ({ verdict: "PASS", reason });
const NP = (reason: string): { verdict: Verdict; reason: string } => ({ verdict: "NOT_PROVEN", reason });

export interface Bounds { x0: number; x1: number; y0: number; y1: number; }
/** จุด calibrate อยู่ในกรอบ target จริงไหม (targeting precondition) — กันกดผิด control */
export function pointInside(pt: { x: number; y: number }, b: Bounds | undefined | null): boolean {
  if (!b) return false;
  return pt.x >= b.x0 && pt.x <= b.x1 && pt.y >= b.y0 && pt.y <= b.y1;
}

/** EffectState -> the key/value shape an Observation publishes, so the same evaluator reads both. */
function asObservation(s: EffectState): { acquired: true; observed_at: null; source: "ACCESSIBILITY_WINDOW_TITLE"; state: Record<string, string>; unavailable_reason: null } {
  const state: Record<string, string> = {};
  for (const [observable, key] of Object.entries(OBSERVABLE_KEYS)) {
    const v = (s as unknown as Record<string, unknown>)[observable];
    if (v !== undefined && v !== null) state[key] = String(v);
  }
  return { acquired: true, observed_at: null, source: "ACCESSIBILITY_WINDOW_TITLE", state, unavailable_reason: null };
}

/**
 * เงื่อนไข "expected observable effect" ต่อ primitive — ใช้ทั้ง (ก) effect-sync poll ของ runner
 * (dispatch → poll จนเงื่อนไขจริง หรือ timeout) และ (ข) เกณฑ์ verdict — จุดเดียวกัน ไม่หลุด sync
 *
 * ── ONE SEMANTIC OWNER (2026-09-02) ──
 * กฎเดิมของแต่ละ primitive **ไม่เปลี่ยนความหมาย** แต่ย้ายไปอยู่ที่เดียวคือ
 * ../expectation.ts (พูดว่า "คาดหวังอะไร") + ../effect-verdict.ts (พูดว่า
 * "ความสัมพันธ์แต่ละแบบแปลว่าอะไร) เพื่อไม่ให้ runtime verdict กับ acceptance
 * suite ตีความคนละอย่างเมื่อมีการแก้ในอนาคต ที่นี่จึงเหลือแค่การเรียกใช้
 * ผลลัพธ์ยังเป็น boolean เหมือนเดิมทุกกรณี (พิสูจน์ด้วย
 * ../tests/verifier-equivalence.test.ts ที่เทียบกับตรรกะเดิมทุก op ทุกสถานะ)
 * `null` (ตัดสินไม่ได้) ถูกแปลงเป็น false เหมือนพฤติกรรมเดิมทุกประการ
 */
export function conditionMet(op: string, before: EffectState, after: EffectState, opts?: Intent): boolean {
  const expectation = buildExpectation(
    { operation: op, ui: { text: opts?.expectedType }, intent_declaration: { target: opts?.target, intent: opts?.intent as DeclaredIntent | undefined } },
    () => FIXED_STAMP,
  );
  return evaluateEffect(expectation, asObservation(before), asObservation(after), () => FIXED_STAMP).status === "VERIFIED";
}

/**
 * ตัดสินหนึ่ง primitive จาก before/after เท่านั้น
 * op ที่ไม่มี observable state (pointer_move) → ต้องมีหลักฐานอื่น มิฉะนั้น NOT_PROVEN (ไม่เดาจาก COMPLETED)
 */
export function verifyPrimitive(e: StepEvidence): { verdict: Verdict; reason: string } {
  // effect-based เท่านั้น: ถ้าไม่มี before/after ก็พิสูจน์ไม่ได้ (ไม่ว่าจะ COMPLETED หรือไม่)
  if (!e.before || !e.after) return NP(`no before/after effect evidence (dispatch=${e.dispatch} ไม่นับเป็นหลักฐานพฤติกรรม)`);
  const b = e.before, a = e.after;
  switch (e.op) {
    case "click":
      if (e.intent === "focus") {
        // click บน input → พิสูจน์ focus โดยตรง (activeElement) ไม่ใช่ clickband counter
        if (!e.target) return NP("intent=focus แต่ไม่มี target identity");
        if (b.activeElement === e.target) return NP(`before ก็โฟกัส ${e.target} อยู่แล้ว (พิสูจน์การได้โฟกัสจาก click นี้ไม่ได้)`);
        return a.activeElement === e.target ? P(`activeElement ${b.activeElement}->${a.activeElement} (=target ${e.target})`) : NP(`activeElement="${a.activeElement}" != target "${e.target}"`);
      }
      return a.clicks > b.clicks ? P(`clicks ${b.clicks}->${a.clicks}`) : NP(`clicks ไม่เพิ่ม (${b.clicks}->${a.clicks})`);
    case "double_click":
      if (!(a.dbls > b.dbls)) return NP(`dbls ไม่เพิ่ม (${b.dbls}->${a.dbls})`);
      if (!/DOUBLECLICK/i.test(a.state)) return NP(`dbls เพิ่มแต่ state ไม่ใช่ DOUBLECLICK (state="${a.state}")`);
      return P(`dbls ${b.dbls}->${a.dbls} + state=${a.state}`);
    case "scroll":
      return a.scrollY !== b.scrollY ? P(`scrollY ${b.scrollY}->${a.scrollY}`) : NP(`scrollY ไม่เปลี่ยน (${b.scrollY})`);
    case "drag":
      return a.dragLeft !== b.dragLeft ? P(`dragLeft ${b.dragLeft}->${a.dragLeft}`) : NP(`dragLeft ไม่เปลี่ยน (${b.dragLeft})`);
    case "type":
      if (!e.expectedType) return NP("ไม่มี expectedType ให้เทียบ");
      return a.input === e.expectedType ? P(`input == expected (${e.expectedType})`) : NP(`input="${a.input}" != expected="${e.expectedType}"`);
    case "key":
      return /KEY:/i.test(a.state) && a.state !== b.state ? P(`state=${a.state}`) : NP(`ไม่เห็น observable key state (state="${a.state}")`);
    default:
      return NP(`op "${e.op}" ไม่มีกฎ effect-based → พิสูจน์ไม่ได้`);
  }
}

/** ตัดสินทั้ง suite; PASS ทั้งหมดจึงจะ END_TO_END_PROVEN */
export function verifyRun(steps: StepEvidence[]): { proven: boolean; results: PrimitiveResult[] } {
  const results = steps.map((e) => {
    const v = verifyPrimitive(e);
    return { op: e.op, verdict: v.verdict, reason: v.reason,
      before: e.before ? { clicks: e.before.clicks, dbls: e.before.dbls } : undefined,
      after: e.after ? { clicks: e.after.clicks, dbls: e.after.dbls, state: e.after.state } as Partial<EffectState> : undefined };
  });
  const proven = results.every((r) => r.verdict === "PASS");
  return { proven, results };
}
