/**
 * หน้าที่: สร้างเอกสารสำหรับคนอ่าน จาก contract ที่เครื่องใช้จริง
 *
 * Owner, 2026-09-05 ข้อ 29: เอกสารต้องถูก generate จากข้อมูล canonical
 * ไม่ใช่เขียนมือคู่ขนาน เพราะเอกสารที่เขียนมือจะเพี้ยนจากของจริงเสมอ
 *
 * Dependency ที่อนุญาต: ./registry.ts ./readiness.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเติมคำอธิบายที่ไม่มีอยู่ใน contract
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilityReadiness } from "./readiness";
import {
  commands, connections, dataContracts, derivations, events, financialEffects,
  ownership, ports, projections, stateMachines, units,
} from "./registry";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "docs");

const table = (headers: readonly string[], rows: readonly (readonly string[])[]): string =>
  [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

export function generateDocs(): readonly string[] {
  mkdirSync(OUT, { recursive: true });
  const written: string[] = [];
  const put = (name: string, title: string, body: string) => {
    const p = join(OUT, name);
    writeFileSync(p, `# ${title}\n\n> สร้างอัตโนมัติจาก control/assembly/data — ห้ามแก้ด้วยมือ\n\n${body}\n`, "utf-8");
    written.push(name);
  };

  const ready = capabilityReadiness();
  put("CAPABILITY_REFERENCE.md", "ความสามารถที่ระบบมี",
    table(["capability", "unit", "ความพร้อม", "ที่ยังขาด"],
      ready.map((r) => [r.capability, r.unit_id ?? "-", r.state, r.missing_for_next.join(" · ") || "-"])));

  put("PORT_REFERENCE.md", "ช่องต่อของแต่ละ unit",
    table(["port", "unit", "ทิศทาง", "ช่องทาง", "เข้า", "ออก", "สิทธิ์", "สถานะ"],
      ports().map((p) => [p.port_id, p.owner_unit, p.direction, p.transport,
        p.input_schema_ref ?? "-", p.output_schema_ref ?? "-", p.authority_class, p.status])));

  put("DATA_REFERENCE.md", "ข้อมูลและเจ้าของ",
    table(["object", "ชั้น", "เจ้าของ capability", "ผู้เขียน", "ผู้อ่าน", "นโยบายการเขียน", "ต้นทางความจริง"],
      ownership().map((o) => [o.object, o.layer, o.owner_capability ?? "-",
        String(o.allowed_writers.length), String(o.readers.length), o.write_policy, o.source_of_truth])));

  put("EVENT_REFERENCE.md", "เหตุการณ์",
    table(["event", "ช่อง", "ผู้ผลิต", "ผู้บริโภค", "การส่ง", "ลำดับ", "คีย์กันซ้ำ"],
      events().map((e) => [e.event_id, e.channel, e.producer,
        e.consumers.join(", ") || "ไม่มี", e.delivery, e.ordering, e.dedup_key ?? "-"])));

  put("COMMAND_REFERENCE.md", "คำสั่งทางธุรกิจ",
    table(["command", "เจตนา", "ต้องส่ง", "ผลที่ได้", "เหตุการณ์ที่ตามมา", "บทบาทที่เรียกได้", "ผลข้างเคียง"],
      commands().map((c) => [c.command_id, c.intent, c.required_inputs.join(", "),
        c.expected_result, c.expected_event ?? "-", c.allowed_roles.join(", "), c.side_effect_class])));

  put("STATE_MACHINE_REFERENCE.md", "วงจรชีวิตของสิ่งต่าง ๆ",
    stateMachines().map((m) => `## ${m.machine_id} — ${m.entity}\n\n` +
      table(["จาก", "ไป", "ตัวกระตุ้น", "ผู้ทำ", "สิทธิ์", "โค้ดที่รับผิดชอบ"],
        m.transitions.map((t) => [t.from, t.to, t.trigger, t.actor, t.authority,
          t.implementation_owner ?? "**ไม่มี**"]))).join("\n\n"));

  put("PROJECTION_REFERENCE.md", "หน้าจอและแหล่งข้อมูล",
    table(["projection", "หน้าจอ", "แหล่งข้อมูล", "capability", "สิทธิ์", "การรีเฟรช"],
      projections().map((p) => [p.projection_id, p.surface, p.source_entities.join(", "),
        p.source_capability ?? "-", p.permission, p.refresh_mode])));

  put("FINANCIAL_EFFECT_REFERENCE.md", "ผลกระทบทางการเงิน",
    table(["effect", "ชนิด", "คำสั่งต้นทาง", "ที่มาของจำนวนเงิน", "สูตร", "บัญชีที่กระทบ", "ย้อนได้"],
      financialEffects().map((f) => [f.effect_id, f.effect_type, f.source_transaction,
        f.amount_source, f.formula_ref, f.ledger_object.join(", "), f.reversible ? "ได้" : "ไม่ได้"])) +
    "\n\n## ค่าที่คำนวณได้\n\n" +
    table(["ค่า", "อินพุต", "การคำนวณ", "คำนวณใหม่เมื่อ", "นโยบายแคช"],
      derivations().map((d) => [d.derived_object, d.inputs.join(", "), d.implementation_ref,
        d.recompute_trigger, d.cache_policy])));

  put("BUSINESS_FLOW_REFERENCE.md", "สายธุรกิจ",
    table(["unit", "ชื่อ", "โดเมน", "ให้ความสามารถ", "ต้องพึ่ง", "ทรัพยากร", "ความพร้อม"],
      units().map((u) => [u.unit_id, u.canonical_name, u.business_domain,
        u.provides_capabilities.join(", "), u.requires_capabilities.join(", ") || "-",
        u.resource_requirements.join(", ") || "-", u.availability])));

  put("DEPLOYMENT_REFERENCE.md", "ที่อยู่จริงของแต่ละ unit",
    table(["unit", "ที่รัน", "จุดเข้า", "สิทธิ์ที่ต้องมี"],
      units().map((u) => [u.unit_id, u.runtime_ref ?? "-", u.entrypoint_ref ?? "**ไม่มี**",
        u.authority_requirements.join(", ") || "-"])));

  put("ASSEMBLY_GUIDE.md", "คู่มือการประกอบ",
    `ลำดับที่ระบบใช้: REQUIREMENT → CAPABILITY LOOKUP → PORT MATCHING → CONTRACT VALIDATION → ` +
    `RESOURCE BINDING → FLOW PLAN → EXECUTION → VERIFICATION\n\n` +
    `เรียกใช้: \`planAssembly(capabilities, context)\` แล้วส่งผลเข้า \`link(plan, context)\` ` +
    `ถ้าได้ LINKABLE จึงเรียก \`buildExecutionManifest\` — ทั้งสามขั้นไม่มีการเรียกโมเดลภาษา\n\n` +
    `## สัญญาข้อมูลที่ประกาศไว้\n\n` +
    table(["schema_id", "entity", "เวอร์ชัน", "ตัวตน", "ต้นทางความจริง"],
      dataContracts().map((c) => [c.schema_id, c.entity_type, c.schema_version,
        c.identity_semantics, c.source_of_truth])) +
    `\n\n## สายที่ต่อไว้แล้ว\n\n` +
    table(["connection", "จาก", "ไป", "สถานะ"],
      connections().map((c) => [c.connection_id, c.producer_port, c.consumer_port, c.status])));

  return written;
}
