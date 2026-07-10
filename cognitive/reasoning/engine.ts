/**
 * DNA OS Cognitive Layer — Reasoning Engine
 *
 * Pure Function — ไม่มี side effect, ไม่มี state, ไม่เรียก DB, ไม่เรียก Tool
 *
 * Input:  Goal + Session + Domain Knowledge + Rules + Behavior
 * Output: Plan + Decision + Confidence + Need More Info + Workspace Action + Next Actions
 *
 * อ้างอิง Specification:
 *   - Operational Principles 1-5
 *   - Assistant Behavior 1-10
 *   - Cognitive Rules 1-10
 *   - Architecture v6
 */

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

export interface Goal {
  who: string | null;
  what: string | null;
  action: string | null;
  detail: string | null;
  is_continuation: boolean;
  is_general: boolean;
  raw_input: string;
}

export interface Session {
  current_goal: string | null;
  current_workspace: string | null;
  current_business_object: {
    type: string;
    id: string | null;
    name: string | null;
  } | null;
  current_task: string | null;
  pending_actions: string[];
  confidence: number;
  open_questions: string[];
  last_tool_results: any[];
  history: string[];
  who: string | null;
  who_id: string | null;
}

export interface DomainObject {
  type: string;
  required_data: string[];
  related_entities: string[];
  possible_actions: string[];
  tables: string[];
}

export interface DomainKnowledge {
  objects: Record<string, DomainObject>;
  vocabulary: Record<string, string>;
  relationships: Record<string, string[]>;
  workflows: Record<string, string[]>;
}

export interface PlanStep {
  tool: string;
  args: Record<string, string>;
  depends_on?: number;
  condition?: string;
}

export interface ReasoningOutput {
  decision: string;
  confidence: number;
  plan: PlanStep[];
  need_more_info: string | null;
  workspace_action: "open" | "extend" | "replace" | "keep";
  next_actions: string[];
  reasoning_trace: string[];
}

// ═══════════════════════════════════════
// DOMAIN KNOWLEDGE (Built-in)
// ═══════════════════════════════════════

const DOMAIN: DomainKnowledge = {
  objects: {
    customer: {
      type: "customer",
      required_data: ["ชื่อ", "เบอร์โทร", "ที่อยู่", "ประเภท"],
      related_entities: ["debt", "invoice", "job", "quotation"],
      possible_actions: ["ดูหนี้", "ออกบิล", "ดูเอกสาร", "ดูงาน", "ส่ง LINE"],
      tables: ["partners"],
    },
    debt: {
      type: "debt",
      required_data: ["ยอดเงินต้น", "ดอกเบี้ยสะสม", "ค่าธรรมเนียม", "ประวัติชำระ", "กำหนดจ่าย"],
      related_entities: ["customer", "invoice", "payment"],
      possible_actions: ["ออกเอกสารทวงหนี้", "บันทึกชำระ", "ส่ง LINE", "คำนวณดอกเบี้ย"],
      tables: ["invoice_debts", "debt_trackings"],
    },
    invoice: {
      type: "invoice",
      required_data: ["ลูกค้า", "รายการ", "ยอดเงิน", "กำหนดชำระ"],
      related_entities: ["customer", "debt"],
      possible_actions: ["พิมพ์", "ส่ง LINE", "แก้ไข"],
      tables: ["documents"],
    },
    quotation: {
      type: "quotation",
      required_data: ["ลูกค้า", "วัสดุ", "จำนวน", "ราคา", "ระยะทาง"],
      related_entities: ["customer", "material", "route"],
      possible_actions: ["พิมพ์", "ส่ง LINE", "แก้ไขราคา", "สร้าง Job"],
      tables: ["documents"],
    },
    job: {
      type: "job",
      required_data: ["โปรเจกต์", "ลูกค้า", "วัสดุ", "จำนวน", "ระยะทาง", "สถานะ"],
      related_entities: ["customer", "vehicle", "material", "route"],
      possible_actions: ["ดูแผนที่", "ออก DO", "ดูลูกค้า"],
      tables: ["jobs"],
    },
    partner: {
      type: "partner",
      required_data: ["ชื่อ", "ประเภท", "เบอร์โทร", "ที่อยู่", "วัสดุ"],
      related_entities: ["material", "route"],
      possible_actions: ["สั่งซื้อ", "ดูแผนที่", "โทร"],
      tables: ["partners"],
    },
    material: {
      type: "material",
      required_data: ["ชื่อ", "ราคา"],
      related_entities: ["partner", "job"],
      possible_actions: ["ดูราคา", "สั่งซื้อ", "ดู supplier"],
      tables: ["material_types"],
    },
    document: {
      type: "document",
      required_data: ["ประเภท", "เลขที่", "ลูกค้า", "ยอดเงิน", "สถานะ"],
      related_entities: ["customer"],
      possible_actions: ["พิมพ์", "ส่ง LINE", "แก้ไข", "ลบ"],
      tables: ["documents"],
    },
  },

  vocabulary: {
    "โรงโม่": "partner",
    "โม่หิน": "partner",
    "บ่อทราย": "partner",
    "บ่อดิน": "partner",
    "โรงงาน": "partner",
    "บิล": "invoice",
    "ใบแจ้งหนี้": "invoice",
    "ใบเสนอราคา": "quotation",
    "เสนอราคา": "quotation",
    "ใบเสร็จ": "document",
    "ค้างจ่าย": "debt",
    "ค้าง": "debt",
    "หนี้": "debt",
    "ลูกหนี้": "debt",
    "ทวงหนี้": "debt",
    "งาน": "job",
    "จัดส่ง": "job",
    "ขนส่ง": "job",
    "โปรเจกต์": "job",
    "วัสดุ": "material",
    "หิน": "material",
    "ทราย": "material",
    "ดิน": "material",
    "ลูกรัง": "material",
    "คอนกรีต": "material",
    "ลูกค้า": "customer",
    "เอกสาร": "document",
    "รถ": "job",
    "พ่วง": "job",
    "DO": "document",
    "PO": "document",
    "คิว": "material",
  },

  relationships: {
    customer: ["debt", "invoice", "job", "quotation", "document"],
    debt: ["customer", "invoice", "payment"],
    invoice: ["customer", "debt"],
    job: ["customer", "material", "partner"],
    partner: ["material"],
    material: ["partner", "job"],
  },

  workflows: {
    "เก็บเงิน": ["ดูหนี้", "ออกใบแจ้งหนี้", "ส่งให้ลูกค้า", "รับชำระ", "ออกใบเสร็จ"],
    "เสนอราคา": ["คำนวณราคา", "ออกใบเสนอราคา", "ส่งให้ลูกค้า"],
    "ส่งของ": ["รับออเดอร์", "เลือกบ่อ", "จัดรถ", "ออก DO", "ส่ง", "ปิดงาน"],
    "ทวงหนี้": ["ดูหนี้", "ออกเอกสารทวงหนี้", "โทร", "ส่ง LINE"],
  },
};

// ═══════════════════════════════════════
// REASONING ENGINE (Pure Function)
// ═══════════════════════════════════════

export function reason(goal: Goal, session: Session): ReasoningOutput {
  const trace: string[] = [];

  // ── R1: General question → ไม่ต้องวางแผน ──
  if (goal.is_general) {
    trace.push("R1: คำถามทั่วไป ไม่เกี่ยวกับ DB");
    return {
      decision: "ส่งให้ AI ตอบคำถามทั่วไป",
      confidence: 1.0,
      plan: [],
      need_more_info: null,
      workspace_action: "keep",
      next_actions: [],
      reasoning_trace: trace,
    };
  }

  // ── Resolve who จาก session (RULE 1, RULE 9) ──
  const who = goal.who ?? session.who;
  const who_id = session.who_id;
  trace.push(`R9: Session who="${who ?? "ไม่มี"}" who_id="${who_id ?? "ไม่มี"}"`);

  if (goal.is_continuation && !goal.who && session.who) {
    trace.push("R1: ไม่มี who ใน input → ใช้จาก session");
  }

  // ── Resolve what จาก vocabulary ──
  let what = goal.what;
  if (what && DOMAIN.vocabulary[what]) {
    const resolved = DOMAIN.vocabulary[what];
    trace.push(`Vocabulary: "${what}" → ${resolved}`);
    what = resolved;
  }

  // ── Resolve what จากคำใน raw_input ──
  if (!what) {
    for (const [word, obj] of Object.entries(DOMAIN.vocabulary)) {
      if (goal.raw_input.includes(word)) {
        what = obj;
        trace.push(`Vocabulary scan: พบ "${word}" → ${obj}`);
        break;
      }
    }
  }

  // ── Resolve action ──
  const action = resolveAction(goal.action, goal.raw_input);
  trace.push(`Action: "${action}"`);

  // ── Determine domain object ──
  const domainObj = what ? DOMAIN.objects[what] : null;

  // ── Handle navigation commands ──
  if (action === "clear") {
    trace.push("Navigation: ล้างหน้าจอ");
    return {
      decision: "ล้างหน้าจอ",
      confidence: 1.0,
      plan: [],
      need_more_info: null,
      workspace_action: "open",
      next_actions: [],
      reasoning_trace: trace,
    };
  }

  // ── Workflow intent → Reasoning ไม่แตก steps, ส่งชื่อ workflow ตรงไป ──
  if (action === "workflow" && goal.what) {
    trace.push(`Workflow intent: ${goal.what} → ส่ง Workflow Registry จัดการ`);
    const targetWho = who ?? session.who;
    return {
      decision: `รัน workflow ${goal.what}${targetWho ? ` สำหรับ ${targetWho}` : ""}`,
      confidence: targetWho ? (who_id ? 0.95 : 0.7) : 0.3,
      plan: [], // Planner จะอ่านจาก Workflow Registry เอง
      need_more_info: !targetWho ? "ทำให้ใครครับ" : null,
      workspace_action: "replace",
      next_actions: [],
      reasoning_trace: trace,
    };
  }

  // ── Transport intent → ขนส่งผลลัพธ์ ไม่ใช่ business action ──
  if (action === "transport") {
    trace.push(`Transport: ${goal.what ?? "pending action"}`);
    const targetWho = who ?? session.who;

    if (session.pending_actions.length > 0) {
      trace.push("R9: มี pending_actions → ดำเนินการ");
      return {
        decision: `ส่ง: ${session.pending_actions[0]}`,
        confidence: 0.8,
        plan: [{ tool: "action.execute", args: { action: session.pending_actions[0] } }],
        need_more_info: null,
        workspace_action: "keep",
        next_actions: [],
        reasoning_trace: trace,
      };
    }

    if (targetWho && who_id) {
      trace.push("มี who_id → ส่งได้เลย");
      return {
        decision: `ส่ง ${goal.what ?? "ข้อมูล"} ให้ ${targetWho}`,
        confidence: 0.8,
        plan: [{ tool: `${goal.what ?? "line"}.send`, args: { customer_id: who_id } }],
        need_more_info: null,
        workspace_action: "keep",
        next_actions: [],
        reasoning_trace: trace,
      };
    }

    trace.push("R4: ไม่มี pending + ไม่มี who → ถาม");
    return {
      decision: "ต้องรู้ว่าส่งอะไรให้ใคร",
      confidence: 0.3,
      plan: [],
      need_more_info: "ส่งอะไรให้ใครครับ",
      workspace_action: "keep",
      next_actions: [],
      reasoning_trace: trace,
    };
  }

  if (action === "back") {
    trace.push("Navigation: ย้อนกลับ");
    return {
      decision: "ย้อนกลับ",
      confidence: 1.0,
      plan: [],
      need_more_info: null,
      workspace_action: "keep",
      next_actions: [],
      reasoning_trace: trace,
    };
  }

  // ── CASE 1: มีชื่อคน ไม่มี action → เปิดทุกอย่าง (B3: เชิงรุก) ──
  if (who && !action) {
    trace.push("B3: มีชื่อ ไม่มี action → เปิดทุกอย่างของคนนี้");
    trace.push("R5: แตกเป็นหลาย tool ตาม relationships");

    const plan: PlanStep[] = [];
    plan.push({ tool: "identity.resolve", args: { name: who } });

    const related = DOMAIN.relationships["customer"] ?? [];
    for (const rel of related) {
      const relObj = DOMAIN.objects[rel];
      if (relObj) {
        plan.push({
          tool: `${rel}.query`,
          args: { customer_id: "$0.id", name: who },
          depends_on: 0,
        });
      }
    }

    return {
      decision: `เปิดข้อมูลทั้งหมดของ ${who}`,
      confidence: who_id ? 0.95 : 0.7,
      plan: who_id ? skipResolve(plan, who_id) : plan,
      need_more_info: null,
      workspace_action: goal.is_continuation ? "extend" : "open",
      next_actions: DOMAIN.objects["customer"]?.possible_actions ?? [],
      reasoning_trace: trace,
    };
  }

  // ── CASE 2: มี action + มี what + ต้องการ who ──
  if (action && what && domainObj) {
    const wantsAll = /ทั้งหมด|ทุกรายการ|all/i.test(goal.raw_input);
    const needsWho = ["debt", "invoice", "quotation", "job", "document"].includes(what) && !wantsAll;

    // ── action = ดู ──
    if (action === "view") {
      if (needsWho && who) {
        trace.push(`B2: ค้นก่อนถาม → query ${what} ของ ${who}`);
        trace.push("R5: เพิ่ม related entities");

        const plan: PlanStep[] = [];
        if (!who_id) {
          plan.push({ tool: "identity.resolve", args: { name: who } });
        }
        plan.push({
          tool: `${what}.query`,
          args: who_id ? { customer_id: who_id } : { customer_id: "$0.id" },
          depends_on: who_id ? undefined : 0,
        });

        return {
          decision: `ดู${domainObj.type}ของ ${who}`,
          confidence: who_id ? 0.95 : 0.7,
          plan,
          need_more_info: null,
          workspace_action: goal.is_continuation ? "extend" : "open",
          next_actions: domainObj.possible_actions,
          reasoning_trace: trace,
        };
      }

      if (needsWho && !who) {
        // ── RULE 3, RULE 4: ดูว่า session มี who ไหม ──
        trace.push("R3: ตรวจ session → ไม่มี who");
        trace.push("R4: confidence ต่ำ → ต้องถาม");
        return {
          decision: `ต้องรู้ว่าดู${domainObj.type}ของใคร`,
          confidence: 0.3,
          plan: [],
          need_more_info: `ดู${goal.what}ของใครครับ`,
          workspace_action: "keep",
          next_actions: [],
          reasoning_trace: trace,
        };
      }

      // ── ไม่ต้องการ who (วัสดุ, partner list) ──
      trace.push(`B6: ลงมือทำ → query ${what}.list`);
      return {
        decision: `ดู${domainObj.type}ทั้งหมด`,
        confidence: 0.9,
        plan: [{ tool: `${what}.list`, args: {} }],
        need_more_info: null,
        workspace_action: goal.is_continuation ? "extend" : "open",
        next_actions: domainObj.possible_actions,
        reasoning_trace: trace,
      };
    }

    // ── action = สร้าง ──
    if (action === "create") {
      if (!who && !session.who) {
        trace.push("R4: ไม่มี who → confidence ต่ำ → ถาม");
        return {
          decision: `ต้องรู้ว่าสร้าง${goal.what}ให้ใคร`,
          confidence: 0.3,
          plan: [],
          need_more_info: `สร้าง${goal.what}ให้ใครครับ`,
          workspace_action: "keep",
          next_actions: [],
          reasoning_trace: trace,
        };
      }

      const targetWho = who ?? session.who!;
      trace.push(`B6: ลงมือทำ → สร้าง ${what} ให้ ${targetWho}`);
      trace.push("B2: ค้นยอดจาก DB ก่อนสร้าง");
      trace.push("R2: เรียก tool ก่อนตอบ");

      const plan: PlanStep[] = [];
      if (!who_id) {
        plan.push({ tool: "identity.resolve", args: { name: targetWho } });
      }

      // B2: ดึงยอดจาก DB ก่อนสร้าง (ไม่ถามผู้ใช้)
      if (what === "invoice" || what === "debt") {
        plan.push({
          tool: "debt.query",
          args: who_id ? { customer_id: who_id } : { customer_id: "$0.id" },
          depends_on: who_id ? undefined : 0,
        });
        plan.push({
          tool: `${what}.create`,
          args: {
            customer_id: who_id ?? "$0.id",
            amount: who_id ? "$0.total" : "$1.total",
          },
          depends_on: who_id ? 0 : 1,
        });
      } else {
        plan.push({
          tool: `${what}.create`,
          args: { customer_id: who_id ?? "$0.id" },
          depends_on: who_id ? undefined : 0,
        });
      }

      return {
        decision: `สร้าง${goal.what}ให้ ${targetWho}`,
        confidence: who_id ? 0.95 : 0.7,
        plan,
        need_more_info: null,
        workspace_action: "replace",
        next_actions: domainObj.possible_actions,
        reasoning_trace: trace,
      };
    }

    // ── action = ลบ ──
    if (action === "delete") {
      trace.push("B10: ลบ → ต้องยืนยัน");
      return {
        decision: "ต้องยืนยันก่อนลบ",
        confidence: 0.9,
        plan: [{ tool: "record.delete", args: { table: domainObj.tables[0], id: goal.detail ?? "" } }],
        need_more_info: "ยืนยันลบหรือไม่",
        workspace_action: "keep",
        next_actions: [],
        reasoning_trace: trace,
      };
    }
  }

  // ── CASE 3: มีแค่ what ไม่มี action ──
  if (what && domainObj && !action) {
    if (who) {
      trace.push(`CASE 3a: "${what}" + who="${who}" → ดู ${what} ของ ${who}`);
      return reason({ ...goal, action: "ดู" }, session);
    }

    trace.push(`CASE 3b: "${what}" ไม่มี who → ดูทั้งหมดหรือใช้ session`);
    if (session.who) {
      trace.push("R1: ใช้ who จาก session");
      return reason({ ...goal, who: session.who, action: "ดู" }, session);
    }

    // ไม่ต้องการ who
    if (!["debt", "invoice"].includes(what)) {
      return reason({ ...goal, action: "ดู" }, session);
    }

    // ต้องการ who แต่ไม่มี
    trace.push("R4: confidence ต่ำ → ถาม");
    return {
      decision: `ต้องรู้ว่าดู${goal.what ?? what}ของใคร`,
      confidence: 0.3,
      plan: [],
      need_more_info: `ดู${goal.what ?? what}ของใครครับ`,
      workspace_action: "keep",
      next_actions: [],
      reasoning_trace: trace,
    };
  }

  // ── CASE 4: มีแค่ who ไม่มี what (คำสั่งสั้นเช่น "ส่งเลย" "เหมือนเดิม") ──
  if (!who && !what && action) {
    if (action === "send" && session.pending_actions.length > 0) {
      trace.push("R1: 'ส่งเลย' → ดู pending_actions");
      return {
        decision: `ดำเนินการ: ${session.pending_actions[0]}`,
        confidence: 0.8,
        plan: [{ tool: "action.execute", args: { action: session.pending_actions[0] } }],
        need_more_info: null,
        workspace_action: "replace",
        next_actions: [],
        reasoning_trace: trace,
      };
    }

    if (action === "repeat" && session.history.length > 0) {
      trace.push("R1: 'เหมือนเดิม' → ทำซ้ำ");
      return {
        decision: `ทำซ้ำ: ${session.current_goal}`,
        confidence: 0.7,
        plan: [{ tool: "action.repeat", args: { goal: session.current_goal ?? "" } }],
        need_more_info: null,
        workspace_action: "replace",
        next_actions: [],
        reasoning_trace: trace,
      };
    }
  }

  // ── CASE 5: ไม่เข้าใจ ──
  trace.push("ไม่สามารถตีความได้");
  return {
    decision: "ไม่เข้าใจคำสั่ง",
    confidence: 0.1,
    plan: [],
    need_more_info: null,
    workspace_action: "keep",
    next_actions: [],
    reasoning_trace: trace,
  };
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

function resolveAction(action: string | null, raw: string): string | null {
  if (action) {
    const map: Record<string, string> = {
      "ดู": "view", "หา": "view", "ค้นหา": "view", "เปิด": "view", "แสดง": "view",
      "สร้าง": "create", "ออก": "create", "ออกบิล": "create", "ทำ": "create",
      "ลบ": "delete", "ลบออก": "delete",
      "แก้": "edit", "เปลี่ยน": "edit", "อัปเดต": "edit",
      "ส่ง": "transport", "ส่งเลย": "transport",
      "workflow": "workflow",
      "transport": "transport",
      "ล้าง": "clear", "เคลียร์": "clear",
      "ย้อนกลับ": "back", "กลับ": "back",
      "เหมือนเดิม": "repeat", "ซ้ำ": "repeat",
    };
    return map[action] ?? action;
  }

  // Scan raw input
  if (/ล้าง|clear/.test(raw)) return "clear";
  if (/ย้อน|กลับ/.test(raw)) return "back";
  if (/สร้าง|ออกบิล|ออกใบ/.test(raw)) return "create";
  if (/ลบ/.test(raw)) return "delete";
  if (/ส่งเลย|ส่ง LINE/.test(raw)) return "send";
  if (/เหมือนเดิม|ซ้ำ/.test(raw)) return "repeat";
  if (/ดู|หา|ค้น|เปิด|แสดง/.test(raw)) return "view";

  return null;
}

function skipResolve(plan: PlanStep[], who_id: string): PlanStep[] {
  return plan
    .filter(s => s.tool !== "identity.resolve")
    .map(s => ({
      ...s,
      args: Object.fromEntries(
        Object.entries(s.args).map(([k, v]) => [k, v === "$0.id" ? who_id : v])
      ),
      depends_on: undefined,
    }));
}
