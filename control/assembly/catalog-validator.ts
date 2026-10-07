/**
 * หน้าที่: ตรวจ catalog ทั้งชุดว่ามีรูโหว่ตรงไหน และไม่มีขั้นตอนที่ห้อยอยู่
 *
 * Owner, 2026-09-05 ข้อ 20/28: ทุก step ที่ไม่ใช่ปลายทางต้องมีตัวต่อ ทุก output
 * ที่จำเป็นต้องมีผู้บริโภค ทุก transition ต้องมีเจ้าของโค้ด ทุกผลทางการเงินต้อง
 * มีการคำนวณที่กำหนดผลได้ และทุกหน้าจอต้องมีต้นทางที่เป็น canonical
 *
 * ไฟล์นี้เป็นผู้ตัดสิน ไม่ใช่ผู้เขียน catalog — ถ้ามันบอกว่าไม่ผ่าน แปลว่าไม่ผ่าน
 *
 * Dependency ที่อนุญาต: ./registry.ts ./types.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามลดระดับผลเพื่อให้ตัวเลขสวย
 * - ห้ามข้ามการตรวจเพียงเพราะข้อมูลยังไม่ครบ ต้องรายงานว่าไม่ครบ
 */

import {
  commands, connections, dataContracts, derivations, events, financialEffects,
  ownership, ports, projections, stateMachines, units,
} from "./registry";

export type Severity = "ERROR" | "WARNING";

export interface Finding {
  readonly check: string;
  readonly severity: Severity;
  readonly subject: string;
  readonly detail: string;
}

export interface ValidationReport {
  readonly generated_at: string;
  readonly checks_run: number;
  readonly errors: number;
  readonly warnings: number;
  readonly findings: readonly Finding[];
  readonly result: "PASS" | "FAIL";
}

export function validateCatalog(): ValidationReport {
  const f: Finding[] = [];
  const add = (check: string, severity: Severity, subject: string, detail: string) =>
    f.push({ check, severity, subject, detail });

  const U = units(); const P = ports(); const DC = dataContracts();
  const portIds = new Set(P.map((p) => p.port_id));
  const contractIds = new Set(DC.map((c) => c.schema_id));

  // 1 missing port
  for (const u of U) {
    for (const p of [...u.ports_in, ...u.ports_out]) {
      if (!portIds.has(p)) add("missing_port", "ERROR", u.unit_id, `อ้าง port ที่ไม่มีอยู่: ${p}`);
    }
    if (u.ports_in.length === 0 && u.ports_out.length === 0) {
      add("missing_port", "ERROR", u.unit_id, "unit ที่นำกลับมาใช้ได้ต้องมี port อย่างน้อยหนึ่งด้าน");
    }
    if (u.entrypoint_ref === null) add("missing_entrypoint", "ERROR", u.unit_id, "ไม่มี entrypoint");
  }

  // 2 schema mismatch / unversioned contract
  for (const p of P) {
    for (const ref of [p.input_schema_ref, p.output_schema_ref, p.error_schema_ref]) {
      if (ref !== null && !contractIds.has(ref)) add("schema_mismatch", "ERROR", p.port_id, `อ้าง schema ที่ไม่มี: ${ref}`);
    }
    if (p.contract_version === "" || p.contract_version === undefined) {
      add("unversioned_contract", "ERROR", p.port_id, "port ไม่มี contract_version");
    }
  }
  for (const c of DC) {
    if (c.schema_version === "") add("unversioned_contract", "ERROR", c.schema_id, "data contract ไม่มีเวอร์ชัน");
    if (c.identity_semantics === "ENTITY" && c.identity_fields.length === 0) {
      add("missing_identity", "WARNING", c.schema_id, "ประกาศเป็น ENTITY แต่ไม่มี identity field");
    }
  }

  // 3 orphan object — data object ที่ไม่มีเจ้าของ capability
  const own = ownership();
  for (const o of own) {
    if (o.owner_capability === null && o.write_policy !== "READ_ONLY" && o.write_policy !== "UNKNOWN") {
      add("unowned_data", "WARNING", o.object, `เขียนได้แต่ไม่มี owner_capability (${o.write_policy})`);
    }
    if (o.write_policy === "ARCHITECTURE_CONFLICT") {
      add("multi_writer_conflict", "ERROR", o.object, `ผู้เขียน ${o.allowed_writers.length} ราย โดยยังไม่ประกาศกติกาตัดสิน`);
    }
  }

  // 4 orphan event — ไม่มีผู้บริโภค
  for (const e of events()) {
    if (e.consumers.length === 0) add("orphan_event", "WARNING", e.event_id, "ไม่มีผู้บริโภคที่ประกาศไว้");
    if (!contractIds.has(e.payload_schema_ref)) add("schema_mismatch", "ERROR", e.event_id, `payload schema ไม่มี: ${e.payload_schema_ref}`);
  }

  // 5 dead-end state + missing terminal state + transition ไม่มีเจ้าของโค้ด
  for (const m of stateMachines()) {
    if (m.terminal_states.length === 0) add("missing_terminal_state", "WARNING", m.machine_id, "ไม่มีสถานะปลายทาง");
    for (const s of m.states) {
      const outgoing = m.transitions.filter((t) => t.from === s);
      if (outgoing.length === 0 && !m.terminal_states.includes(s)) {
        add("dead_end_state", "ERROR", `${m.machine_id}#${s}`, "ไม่ใช่สถานะปลายทางแต่ไม่มีทางออก");
      }
    }
    for (const t of m.transitions) {
      if (t.implementation_owner === null) {
        add("missing_transition_owner", "ERROR", `${m.machine_id}#${t.from}->${t.to}`, "ไม่มีโค้ดใดรับผิดชอบ transition นี้");
      }
      if (!m.states.includes(t.to) && t.to !== "(none)") {
        add("invalid_transition", "ERROR", m.machine_id, `ปลายทาง ${t.to} ไม่อยู่ในรายการสถานะ`);
      }
    }
  }

  /**
   * 6 missing authority — เฉพาะ port ที่ข้ามขอบเขตโปรเซส
   *
   * event ในโปรเซสเดียวกันไม่มีอะไรให้ยืนยันตัวตน สิทธิ์ถูกตัดสินไปแล้วที่ขอบ
   * ด้านนอก การบังคับให้มี authentication ตรงนั้นคือการตรวจผิดจุด
   */
  const CROSSES_PROCESS = new Set(["HTTP", "WEBHOOK", "RPC", "MCP", "DEVICE", "REALTIME"]);
  for (const p of P) {
    if (!CROSSES_PROCESS.has(p.transport)) continue;
    if ((p.side_effect_class === "EXTERNAL_WRITE" || p.side_effect_class === "DEVICE_CONTROL" || p.side_effect_class === "FINANCIAL")
      && (p.authentication === "" || p.authentication === "n/a")) {
      add("missing_authority", "ERROR", p.port_id, `${p.side_effect_class} ข้ามขอบเขตโปรเซสแต่ไม่มีการยืนยันตัวตน`);
    }
  }

  // 7 dangling connection
  for (const c of connections()) {
    if (!portIds.has(c.producer_port)) add("dangling_connection", "ERROR", c.connection_id, `producer port ไม่มี: ${c.producer_port}`);
    if (!portIds.has(c.consumer_port)) add("dangling_connection", "ERROR", c.connection_id, `consumer port ไม่มี: ${c.consumer_port}`);
  }

  // 8 missing financial source
  for (const fe of financialEffects()) {
    if (fe.formula_ref === "" || fe.amount_source.startsWith("UNKNOWN")) {
      add("missing_financial_source", "ERROR", fe.effect_id, `ไม่มีที่มาของจำนวนเงินที่กำหนดผลได้: ${fe.amount_source}`);
    }
  }

  // 9 UI without canonical projection source
  const canonicalObjects = new Set(own.filter((o) => o.source_of_truth === o.object).map((o) => o.object));
  for (const pr of projections()) {
    const grounded = pr.source_entities.some((e) => canonicalObjects.has(e));
    if (!grounded) add("ui_without_canonical_source", "ERROR", pr.projection_id, `แหล่งข้อมูลไม่มีตัวใดเป็น canonical: ${pr.source_entities.join(", ")}`);
    if (pr.source_capability === null) add("projection_without_capability", "WARNING", pr.projection_id, "ไม่ได้ผูกกับ capability ใด");
  }

  // 10 derived value ที่ถูกใช้เป็นต้นทางความจริง
  const derivedNames = new Set(derivations().map((d) => d.derived_object));
  for (const o of own) {
    if (derivedNames.has(o.object) && o.source_of_truth === o.object) {
      add("derived_used_as_source", "ERROR", o.object, "เป็นค่าที่คำนวณใหม่ได้ แต่ถูกประกาศเป็นต้นทางความจริง");
    }
  }

  // 11 command ที่ขอ capability ที่ไม่มีใครให้
  const provided = new Set(U.flatMap((u) => u.provides_capabilities));
  for (const c of commands()) {
    for (const cap of c.required_capabilities) {
      if (!provided.has(cap)) add("missing_capability", "ERROR", c.command_id, `ไม่มี unit ใดให้ capability: ${cap}`);
    }
    if (!contractIds.has(c.input_schema_ref)) add("schema_mismatch", "ERROR", c.command_id, `input schema ไม่มี: ${c.input_schema_ref}`);
  }

  // 12 output ที่จำเป็นแต่ไม่มีผู้บริโภค
  const consumedSchemas = new Set(P.filter((p) => p.direction === "IN").map((p) => p.input_schema_ref).filter((x): x is string => x !== null));
  const eventPayloads = new Set(events().flatMap((e) => (e.consumers.length > 0 ? [e.payload_schema_ref] : [])));
  for (const p of P) {
    if (p.direction !== "OUT" || p.output_schema_ref === null) continue;
    if (!consumedSchemas.has(p.output_schema_ref) && !eventPayloads.has(p.output_schema_ref)) {
      add("output_without_consumer", "WARNING", p.port_id, `ผลิต ${p.output_schema_ref} แต่ไม่มี port หรือ event ใดรับ`);
    }
  }

  const errors = f.filter((x) => x.severity === "ERROR").length;
  return {
    generated_at: new Date().toISOString(),
    checks_run: 12, errors, warnings: f.length - errors, findings: f,
    result: errors === 0 ? "PASS" : "FAIL",
  };
}
