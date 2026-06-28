import { resolveObjective, type EnrichedInput, type Session } from "./manager";

function emptySession(): Session {
  return { who: null, who_id: null, current_goal: null, current_workspace: null, current_business_object: null, current_task: null, pending_actions: [], confidence: 0, open_questions: [], last_tool_results: [], history: [] };
}
function s(o: Partial<Session>): Session { return { ...emptySession(), ...o }; }
function e(o: Partial<EnrichedInput>): EnrichedInput { return { who: null, what: null, action: null, detail: null, intent_type: "business", intent_id: null, is_new_session: false, raw_input: "", ...o }; }

const tests: { name: string; input: EnrichedInput; session: Session; expect: { type: string; who?: string | null; constraints_includes?: string } }[] = [
  { name: '01 "คุณเท่ห์" → open_profile', input: e({ who: "เท่ห์", raw_input: "คุณเท่ห์", is_new_session: true }), session: emptySession(), expect: { type: "open_profile" } },
  { name: '02 "หนี้" + session.who → review_debt (session who)', input: e({ what: "หนี้", raw_input: "หนี้" }), session: s({ who: "เท่ห์", who_id: "uuid" }), expect: { type: "review_debt", who: "เท่ห์" } },
  { name: '03 "หนี้" ไม่มี session → review_debt (no who)', input: e({ what: "หนี้", raw_input: "หนี้", is_new_session: true }), session: emptySession(), expect: { type: "review_debt", who: null } },
  { name: '04 "ออกบิล" + session → create_invoice', input: e({ action: "create", what: "invoice", raw_input: "ออกบิล" }), session: s({ who: "เท่ห์", who_id: "uuid" }), expect: { type: "create_invoice", who: "เท่ห์" } },
  { name: '05 "ล้าง" → navigation', input: e({ intent_type: "navigation", intent_id: null, raw_input: "ล้าง" }), session: emptySession(), expect: { type: "navigation" } },
  { name: '06 "ราคาทอง" → general_question', input: e({ intent_type: "general", intent_id: null, raw_input: "ราคาทองวันนี้" }), session: emptySession(), expect: { type: "general_question" } },
  { name: '07 "ใช่" → process_feedback', input: e({ intent_type: "feedback", intent_id: null, raw_input: "ใช่" }), session: s({ who: "เท่ห์", pending_actions: ["ส่ง LINE"] }), expect: { type: "process_feedback" } },
  { name: '08 "โรงโม่" → review_partner', input: e({ what: "โรงโม่", raw_input: "โรงโม่" }), session: emptySession(), expect: { type: "review_partner" } },
  { name: '09 "วัสดุ" → review_material', input: e({ what: "วัสดุ", raw_input: "วัสดุ" }), session: emptySession(), expect: { type: "review_material" } },
  { name: '10 "ดูงาน" → review_job', input: e({ action: "view", what: "job", raw_input: "ดูงาน" }), session: emptySession(), expect: { type: "review_job" } },
  { name: '11 มี who_id → constraint ห้าม resolve ซ้ำ', input: e({ who: "เท่ห์", raw_input: "เท่ห์" }), session: s({ who: "เท่ห์", who_id: "uuid" }), expect: { type: "open_profile", constraints_includes: "ห้าม resolve ซ้ำ" } },
  { name: '12 "สร้างใบเสนอราคา" → create_quotation', input: e({ action: "create", what: "quotation", raw_input: "สร้างใบเสนอราคา" }), session: emptySession(), expect: { type: "create_quotation" } },
  { name: '13 "ลบเอกสาร" → delete_document', input: e({ action: "delete", what: "document", raw_input: "ลบเอกสาร" }), session: emptySession(), expect: { type: "delete_document" } },
  { name: '14 "ส่งเลย" → execute_pending', input: e({ action: "send", raw_input: "ส่งเลย" }), session: s({ pending_actions: ["ส่ง LINE"] }), expect: { type: "execute_pending" } },
  { name: '15 "เหมือนเดิม" → continue_workflow', input: e({ action: "repeat", raw_input: "เหมือนเดิม" }), session: s({ current_goal: "pricing" }), expect: { type: "continue_workflow" } },
  { name: '16 new session → scope global', input: e({ who: "สมชาย", raw_input: "สมชาย", is_new_session: true }), session: s({ who: "เท่ห์" }), expect: { type: "open_profile" } },
  { name: '17 "คุณเท่ห์ ค้างจ่าย" → review_debt with who', input: e({ who: "เท่ห์", what: "ค้างจ่าย", raw_input: "คุณเท่ห์ ค้างจ่าย" }), session: emptySession(), expect: { type: "review_debt", who: "เท่ห์" } },
  { name: '18 "เอกสาร" → review_document', input: e({ what: "เอกสาร", raw_input: "เอกสาร" }), session: emptySession(), expect: { type: "review_document" } },
  { name: '19 "ลูกค้า" → review_customer', input: e({ what: "ลูกค้า", raw_input: "ลูกค้า" }), session: emptySession(), expect: { type: "review_customer" } },
  { name: '20 unknown → unknown', input: e({ raw_input: "xyzabc" }), session: emptySession(), expect: { type: "unknown" } },
];

let passed = 0;
let failed = 0;

for (const t of tests) {
  const result = resolveObjective(t.input, t.session);
  const errors: string[] = [];

  if (result.type !== t.expect.type) errors.push(`type: expected "${t.expect.type}" got "${result.type}"`);
  if (t.expect.who !== undefined && result.who !== t.expect.who) errors.push(`who: expected "${t.expect.who}" got "${result.who}"`);
  if (t.expect.constraints_includes && !result.constraints.some(c => c.includes(t.expect.constraints_includes!))) errors.push(`constraints missing: "${t.expect.constraints_includes}"`);

  if (errors.length === 0) { console.log(`✓ ${t.name}`); passed++; }
  else { console.log(`✗ ${t.name}`); errors.forEach(e => console.log(`  ${e}`)); failed++; }
}

console.log(`\n${passed}/${tests.length} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
