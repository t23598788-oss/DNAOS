/**
 * Reasoning Engine — Unit Test 20 กรณี
 *
 * ทดสอบว่า Pure Function ตัดสินใจถูกต้องตาม Specification
 * ไม่มี DB, ไม่มี API, ไม่มี Framework
 */

import { reason, type Goal, type Session, type ReasoningOutput } from "./engine";

// ── Empty Session ──
function emptySession(): Session {
  return {
    current_goal: null, current_workspace: null, current_business_object: null,
    current_task: null, pending_actions: [], confidence: 0,
    open_questions: [], last_tool_results: [], history: [],
    who: null, who_id: null,
  };
}

function sessionWith(overrides: Partial<Session>): Session {
  return { ...emptySession(), ...overrides };
}

function goal(overrides: Partial<Goal>): Goal {
  return {
    who: null, what: null, action: null, detail: null,
    is_continuation: false, is_general: false, raw_input: "",
    ...overrides,
  };
}

// ── Tests ──

const tests: { name: string; input: { goal: Goal; session: Session }; expect: Partial<ReasoningOutput> }[] = [

  // ── 1. ชื่อคนอย่างเดียว → เปิดทุกอย่าง ──
  {
    name: '1. "คุณเท่ห์" → เปิดทุกอย่าง',
    input: { goal: goal({ who: "เท่ห์", raw_input: "คุณเท่ห์" }), session: emptySession() },
    expect: { decision: "เปิดข้อมูลทั้งหมดของ เท่ห์", workspace_action: "open", need_more_info: null },
  },

  // ── 2. ชื่อ + มี who_id → ข้าม resolve ──
  {
    name: '2. "คุณเท่ห์" + มี who_id → ข้าม identity.resolve',
    input: { goal: goal({ who: "เท่ห์", raw_input: "คุณเท่ห์" }), session: sessionWith({ who: "เท่ห์", who_id: "uuid-xxx" }) },
    expect: { confidence: 0.95 },
  },

  // ── 3. "หนี้" + session มี who → ดูหนี้ของคนใน session ──
  {
    name: '3. "หนี้" + session.who = เท่ห์ → ดูหนี้ของเท่ห์',
    input: { goal: goal({ what: "หนี้", raw_input: "หนี้", is_continuation: true }), session: sessionWith({ who: "เท่ห์", who_id: "uuid-xxx" }) },
    expect: { need_more_info: null, workspace_action: "extend" },
  },

  // ── 4. "หนี้" + session ว่าง → ถามว่าของใคร ──
  {
    name: '4. "หนี้" + session ว่าง → ถามว่าของใคร',
    input: { goal: goal({ what: "หนี้", raw_input: "หนี้" }), session: emptySession() },
    expect: { confidence: 0.3, workspace_action: "keep" },
  },

  // ── 5. "ออกบิล" + session มี who → สร้างทันที ──
  {
    name: '5. "ออกบิล" + session.who = เท่ห์ → สร้างทันที ไม่ถาม',
    input: { goal: goal({ action: "สร้าง", what: "invoice", raw_input: "ออกบิล", is_continuation: true }), session: sessionWith({ who: "เท่ห์", who_id: "uuid-xxx" }) },
    expect: { need_more_info: null, workspace_action: "replace" },
  },

  // ── 6. "ออกบิล" + ไม่มี who → ถาม ──
  {
    name: '6. "ออกบิล" + ไม่มี who → ถามให้ใคร',
    input: { goal: goal({ action: "สร้าง", what: "invoice", raw_input: "ออกบิล" }), session: emptySession() },
    expect: { confidence: 0.3, workspace_action: "keep" },
  },

  // ── 7. "ล้าง" → ล้างหน้าจอ ──
  {
    name: '7. "ล้าง" → ล้างหน้าจอ',
    input: { goal: goal({ raw_input: "ล้าง" }), session: emptySession() },
    expect: { decision: "ล้างหน้าจอ", confidence: 1.0, workspace_action: "open" },
  },

  // ── 8. คำถามทั่วไป → ส่ง AI ──
  {
    name: '8. "ราคาทองวันนี้" → คำถามทั่วไป',
    input: { goal: goal({ is_general: true, raw_input: "ราคาทองวันนี้" }), session: emptySession() },
    expect: { confidence: 1.0, workspace_action: "keep" },
  },

  // ── 9. "โรงโม่" → partner (vocabulary) ──
  {
    name: '9. "โรงโม่" → ดู partner ทั้งหมด',
    input: { goal: goal({ what: "โรงโม่", raw_input: "โรงโม่" }), session: emptySession() },
    expect: { need_more_info: null, workspace_action: "open" },
  },

  // ── 10. "วัสดุ" → ดูวัสดุทั้งหมด (ไม่ต้องมี who) ──
  {
    name: '10. "วัสดุ" → ดูวัสดุทั้งหมด',
    input: { goal: goal({ what: "วัสดุ", raw_input: "วัสดุ" }), session: emptySession() },
    expect: { need_more_info: null },
  },

  // ── 11. "สร้างใบแจ้งหนี้ให้คุณเท่ห์" → สร้างทันที ──
  {
    name: '11. "สร้างใบแจ้งหนี้ให้คุณเท่ห์" → สร้างทันที',
    input: { goal: goal({ who: "เท่ห์", action: "สร้าง", what: "invoice", raw_input: "สร้างใบแจ้งหนี้ให้คุณเท่ห์" }), session: emptySession() },
    expect: { need_more_info: null, workspace_action: "replace" },
  },

  // ── 12. "ส่งเลย" + pending action → ดำเนินการ ──
  {
    name: '12. "ส่งเลย" + pending_actions → ดำเนินการ',
    input: { goal: goal({ action: "ส่ง", raw_input: "ส่งเลย" }), session: sessionWith({ pending_actions: ["ส่ง LINE ให้เท่ห์"] }) },
    expect: { confidence: 0.8, need_more_info: null },
  },

  // ── 13. "เหมือนเดิม" → ทำซ้ำ ──
  {
    name: '13. "เหมือนเดิม" → ทำซ้ำ goal เดิม',
    input: { goal: goal({ raw_input: "เหมือนเดิม" }), session: sessionWith({ current_goal: "ดูหนี้เท่ห์", history: ["ดูหนี้เท่ห์"] }) },
    expect: { confidence: 0.7, workspace_action: "replace" },
  },

  // ── 14. "คุณเท่ห์ ค้างจ่าย" → debt + customer ──
  {
    name: '14. "คุณเท่ห์ ค้างจ่าย" → ดูหนี้ของเท่ห์',
    input: { goal: goal({ who: "เท่ห์", what: "ค้างจ่าย", raw_input: "คุณเท่ห์ ค้างจ่าย" }), session: emptySession() },
    expect: { need_more_info: null, workspace_action: "open" },
  },

  // ── 15. continuation: "ดูงานด้วย" → extend workspace ──
  {
    name: '15. "ดูงานด้วย" ต่อจากเท่ห์ → extend',
    input: { goal: goal({ action: "ดู", what: "job", raw_input: "ดูงานด้วย", is_continuation: true }), session: sessionWith({ who: "เท่ห์", who_id: "uuid-xxx" }) },
    expect: { workspace_action: "extend", need_more_info: null },
  },

  // ── 16. "ลบ" → ต้องยืนยัน ──
  {
    name: '16. "ลบ" → ต้องยืนยัน',
    input: { goal: goal({ action: "ลบ", what: "document", detail: "doc-uuid", raw_input: "ลบเอกสาร" }), session: emptySession() },
    expect: { workspace_action: "keep" },
  },

  // ── 17. "ลูกค้า" → ดูทั้งหมด ──
  {
    name: '17. "ลูกค้า" → ดูลูกค้าทั้งหมด',
    input: { goal: goal({ what: "ลูกค้า", raw_input: "ลูกค้า" }), session: emptySession() },
    expect: { need_more_info: null },
  },

  // ── 18. มี who_id → plan ไม่มี identity.resolve ──
  {
    name: '18. มี who_id → plan ข้าม identity.resolve',
    input: { goal: goal({ who: "เท่ห์", raw_input: "คุณเท่ห์" }), session: sessionWith({ who: "เท่ห์", who_id: "uuid-xxx" }) },
    expect: {},
  },

  // ── 19. "ย้อนกลับ" → back ──
  {
    name: '19. "ย้อนกลับ" → workspace keep',
    input: { goal: goal({ raw_input: "ย้อนกลับ" }), session: emptySession() },
    expect: { decision: "ย้อนกลับ", confidence: 1.0, workspace_action: "keep" },
  },

  // ── 20. ไม่เข้าใจ → confidence ต่ำสุด ──
  {
    name: '20. "xyzabc" → ไม่เข้าใจ',
    input: { goal: goal({ raw_input: "xyzabc" }), session: emptySession() },
    expect: { confidence: 0.1 },
  },
];

// ═══════════════════════════════════════
// RUN TESTS
// ═══════════════════════════════════════

let passed = 0;
let failed = 0;

for (const test of tests) {
  const result = reason(test.input.goal, test.input.session);
  const errors: string[] = [];

  for (const [key, expected] of Object.entries(test.expect)) {
    const actual = (result as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(`  ${key}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
    }
  }

  if (errors.length === 0) {
    console.log(`✓ ${test.name}`);
    passed++;
  } else {
    console.log(`✗ ${test.name}`);
    for (const e of errors) console.log(e);
    console.log(`  trace: ${result.reasoning_trace.join(" → ")}`);
    failed++;
  }
}

console.log(`\n${passed}/${tests.length} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
