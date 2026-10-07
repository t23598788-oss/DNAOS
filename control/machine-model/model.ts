/**
 * หน้าที่: ประกอบโมเดลเครื่องหนึ่งใบจากแหล่งที่มีอยู่ โดยไม่สร้างคลังใหม่
 *
 * ── ทำไมเป็นการ join ไม่ใช่การสแกน ──
 * ถ้าโมเดลเกิดจากการอ่านซอร์สใหม่ทุกครั้ง มันจะเปลี่ยนไปตามว่าใครอ่านและอ่าน
 * ตอนไหน สิ่งที่ควรเป็นความจริงเดียวกลายเป็นความเห็น ไฟล์นี้จึงอ่านเฉพาะแถวที่
 * ถูกเขียนไว้แล้วโดยเจ้าของแต่ละชั้น และไม่เปิดไฟล์ซอร์สแม้แต่ไฟล์เดียว
 *
 * ── ชั้นที่ไม่มีใครเก็บ ต้องดังกว่าชั้นที่มีข้อมูล ──
 * ชั้นที่ `source_store = null` หรืออ่านแล้วว่าง จะได้ `NOT_REPRESENTED` /
 * `EMPTY` พร้อมเหตุผล ไม่ใช่หายไปจากผลลัพธ์ เพราะช่องโหว่ที่มองไม่เห็นคือ
 * ช่องโหว่ที่ไม่มีวันถูกปิด
 *
 * Input: ไม่มี (อ่านจากดิสก์)
 * Output: `buildMachineModel`, `MachineModel`, `MachineNode`, `LayerCoverage`
 * Dependency ที่อนุญาต: ./layers.ts, การอ่าน jsonl ของเจ้าของชั้นแต่ละชั้น
 * สิ่งที่ห้ามแตะ: ห้ามเขียนไฟล์ ห้ามเปิดไฟล์ซอร์สเพื่อเดาว่ามีอะไรอยู่
 *                ห้ามเติมชั้นที่ว่างด้วยค่าที่อนุมานเอง
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MACHINE_LAYERS } from "./layers";
import type { LayerId } from "./layers";
import { observeHardwareOs, observeInstalledSoftware, observeLocalDatabases } from "./census";
import { projectDeclaredInvocations } from "./invocation";
import type { MachineFact, SoftwareEntity, DatabaseEntity } from "./census";

const ROOT = process.cwd();

function readJsonl(rel: string): readonly Record<string, unknown>[] {
  const path = join(ROOT, rel);
  if (!existsSync(path)) return [];
  const out: Record<string, unknown>[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (s.length === 0) continue;
    try { out.push(JSON.parse(s) as Record<string, unknown>); } catch { /* แถวเสียไม่ทำให้ทั้งชั้นหาย */ }
  }
  return out;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** หนึ่งสิ่งที่มีอยู่จริงบนเครื่อง ในชั้นใดชั้นหนึ่ง */
export interface MachineNode {
  readonly node_id: string;
  readonly layer_id: LayerId;
  readonly label: string;
  /** แถวต้นทางที่ทำให้ node นี้มีอยู่ — ตัวชี้ ไม่ใช่สำเนา */
  readonly source_ref: string;
  readonly purpose: string | null;
}

export type LayerStatus = "REPRESENTED" | "EMPTY" | "NOT_REPRESENTED";

export interface LayerCoverage {
  readonly layer_id: LayerId;
  readonly order: number;
  readonly status: LayerStatus;
  readonly node_count: number;
  readonly source_store: string | null;
  readonly reason: string;
}

export interface MachineEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly source_ref: string;
}

export interface BuildOptions {
  /**
   * สำรวจร่างกายของเครื่องด้วย (ฮาร์ดแวร์/OS/ซอฟต์แวร์/ฐานข้อมูล)
   *
   * เปิดไว้เป็นค่าเริ่มต้น เพราะโมเดลที่ไม่รู้ว่าตัวเองรันอยู่บนอะไร ไม่ใช่โมเดล
   * ของเครื่อง ปิดได้เมื่อผู้เรียกต้องการเฉพาะชั้นที่มาจากทะเบียน
   */
  readonly census?: boolean;
  /**
   * ฉายความสัมพันธ์การเรียกใช้ที่ประกาศไว้ลงกราฟด้วย
   *
   * ปิดได้เพื่อเทียบ "ก่อน" กับ "หลัง" การฉาย ในโปรเซสเดียวกัน — การเทียบข้าม
   * โปรเซสไม่ยุติธรรม เพราะจำนวนบริการที่ launchd โหลดอยู่เปลี่ยนได้ตลอด
   */
  readonly invocation?: boolean;
}

export interface MachineModel {
  readonly machine_id: string | null;
  readonly nodes: readonly MachineNode[];
  readonly edges: readonly MachineEdge[];
  readonly coverage: readonly LayerCoverage[];
  readonly built_from: readonly string[];
}

const nodeId = (layer: LayerId, id: string): string => `machine://${layer}/${id}`;

/**
 * ผลการสำรวจถูกจำไว้ต่อโปรเซส
 *
 * การสำรวจเรียกคำสั่งของระบบจริงหลายสิบครั้ง การเรียก `buildMachineModel()`
 * ซ้ำในโปรเซสเดียวจึงต้องได้คำตอบเดิมโดยไม่ไปรบกวนเครื่องซ้ำ — และทำให้ผลลัพธ์
 * ของสองการเรียกในโปรเซสเดียวเทียบกันได้จริง
 */
let censusCache: { facts: readonly MachineFact[]; software: readonly SoftwareEntity[]; databases: readonly DatabaseEntity[] } | null = null;

export function machineCensus(machineId: string): NonNullable<typeof censusCache> { return census(machineId); }

function census(machineId: string): NonNullable<typeof censusCache> {
  if (censusCache !== null) return censusCache;
  const declaredStores = [...new Set(MACHINE_LAYERS
    .map((l) => l.source_store)
    .filter((s): s is string => s !== null && s.endsWith(".jsonl")))];
  censusCache = {
    facts: observeHardwareOs(machineId),
    software: observeInstalledSoftware(machineId),
    databases: observeLocalDatabases(machineId, declaredStores),
  };
  return censusCache;
}

/**
 * ประกอบโมเดลจากแถวที่มีอยู่
 *
 * `machine_id` เป็น `null` ได้ และการเป็น null ไม่ได้แปลว่าอ่านไม่สำเร็จ —
 * มันแปลว่าเครื่องนี้ยังไม่เคยประกาศตัวตนของตัวเอง ซึ่งเป็นข้อเท็จจริงที่ต้อง
 * เห็น ไม่ใช่ข้อผิดพลาดที่ต้องกลบด้วยค่าแทน
 */
export function buildMachineModel(options: BuildOptions = {}): MachineModel {
  const nodes: MachineNode[] = [];
  const edges: MachineEdge[] = [];
  const counts = new Map<LayerId, number>();
  const builtFrom: string[] = [];
  const add = (n: MachineNode): void => { nodes.push(n); counts.set(n.layer_id, (counts.get(n.layer_id) ?? 0) + 1); };

  // MACHINE — ตัวตนของเครื่อง อ่านจากพิธีเริ่มติดตั้ง ไม่ใช่จาก hostname
  let machineId: string | null = null;
  const initPath = join(process.env.HOME ?? "", "Library/Application Support/DNA OS/installation/initialization.json");
  if (existsSync(initPath)) {
    try {
      const rec = JSON.parse(readFileSync(initPath, "utf8")) as Record<string, unknown>;
      machineId = str(rec.installation_id);
      if (machineId !== null) {
        add({ node_id: nodeId("MACHINE", machineId), layer_id: "MACHINE", label: machineId,
          source_ref: "installation-initialization", purpose: "ตัวตนของการติดตั้งบนเครื่องนี้" });
        builtFrom.push("execution/installation-initialization");
      }
    } catch { /* อ่านไม่ได้ = ยังไม่มีตัวตน ไม่ใช่มีตัวตนที่ไม่รู้ */ }
  }

  // FILES_PACKAGES + CAPABILITIES + CONTRACTS + PURPOSE + OWNERSHIP + DEPENDENCIES
  const resources = readJsonl("software/registry-database/data/canonical/resources.jsonl");
  for (const r of resources) {
    const id = str(r.resource_id);
    if (id === null) continue;
    add({ node_id: nodeId("FILES_PACKAGES", id), layer_id: "FILES_PACKAGES",
      label: str(r.source_location) ?? id, source_ref: `resources:${id}`, purpose: null });
  }
  if (resources.length > 0) builtFrom.push("registry-database/resources");

  const caps = readJsonl("software/registry-database/data/canonical/capabilities.jsonl");
  for (const c of caps) {
    const id = str(c.capability_id);
    if (id === null) continue;
    const purpose = str(c.purpose);
    add({ node_id: nodeId("CAPABILITIES", id), layer_id: "CAPABILITIES",
      label: str(c.canonical_name) ?? id, source_ref: `capabilities:${id}`, purpose });
    // สัญญาและเจตนาไม่ใช่ node แยก — มันคือคุณสมบัติของความสามารถเดียวกัน
    // แต่ต้องนับแยก เพราะ "มีความสามารถ" กับ "รู้ว่ามันรับอะไร" เป็นคนละคำถาม
    const hasContract = Array.isArray(c.input_contract) || Array.isArray(c.output_contract);
    if (hasContract) counts.set("CONTRACTS", (counts.get("CONTRACTS") ?? 0) + 1);
    if (purpose !== null) counts.set("PURPOSE", (counts.get("PURPOSE") ?? 0) + 1);
  }
  if (caps.length > 0) builtFrom.push("registry-database/capabilities");

  const rels = readJsonl("software/registry-database/data/canonical/relationships.jsonl");
  for (const rel of rels) {
    const from = str(rel.from_id), to = str(rel.to_id), kind = str(rel.relationship_kind);
    const rid = str(rel.relationship_id);
    if (from === null || to === null || kind === null) continue;
    const fromLayer: LayerId = str(rel.from_type) === "CAPABILITY" ? "CAPABILITIES" : "FILES_PACKAGES";
    const toLayer: LayerId = str(rel.to_type) === "CAPABILITY" ? "CAPABILITIES"
      : str(rel.to_type) === "DEPENDENCY" ? "DEPENDENCIES" : "FILES_PACKAGES";
    edges.push({ from: nodeId(fromLayer, from), to: nodeId(toLayer, to), kind,
      source_ref: `relationships:${rid ?? kind}` });
    counts.set("DEPENDENCIES", (counts.get("DEPENDENCIES") ?? 0) + 1);
  }
  if (rels.length > 0) builtFrom.push("registry-database/relationships");

  const owns = readJsonl("software/registry-database/data/canonical/resource_capabilities.jsonl");
  for (const o of owns) {
    const res = str(o.resource_id), cap = str(o.capability_id);
    if (res === null || cap === null) continue;
    edges.push({ from: nodeId("FILES_PACKAGES", res), to: nodeId("CAPABILITIES", cap),
      kind: "OWNED_BY_CAPABILITY", source_ref: `resource_capabilities:${res}` });
    counts.set("OWNERSHIP", (counts.get("OWNERSHIP") ?? 0) + 1);
  }
  if (owns.length > 0) builtFrom.push("registry-database/resource_capabilities");

  // REPOSITORIES
  const repos = readJsonl("software/repository-registry/data/repositories.jsonl");
  for (const r of repos) {
    const id = str(r.repository_id);
    if (id === null) continue;
    add({ node_id: nodeId("REPOSITORIES", id), layer_id: "REPOSITORIES",
      label: str(r.source_authority) ?? id, source_ref: `repositories:${id}`, purpose: null });
  }
  if (repos.length > 0) builtFrom.push("repository-registry");

  // PROCESSES_SERVICES + CURRENT_STATE
  const obs = readJsonl("control/machine-observation/data/observations.jsonl");
  for (const o of obs) {
    const id = str(o.event_id);
    if (id === null) continue;
    add({ node_id: nodeId("CURRENT_STATE", id), layer_id: "CURRENT_STATE",
      label: str(o.path) ?? id, source_ref: `observations:${id}`, purpose: null });
    // แถวเดียวกันเป็นหลักฐานของสองชั้น: "ตอนนี้เป็นอย่างไร" และ "อะไรกำลังรัน"
    // แต่จะนับเป็นชั้น process ได้ก็ต่อเมื่อมีหลักฐานของ process จริงติดมา
    const proc = Array.isArray(o.process_evidence) ? o.process_evidence : [];
    if (proc.length > 0) {
      add({ node_id: nodeId("PROCESSES_SERVICES", id), layer_id: "PROCESSES_SERVICES",
        label: str(o.path) ?? id, source_ref: `observations:${id}`, purpose: null });
      const rtId = str(o.runtime_target_id);
      if (rtId !== null) {
        edges.push({ from: nodeId("PROCESSES_SERVICES", id), to: nodeId("RUNTIME", rtId),
          kind: "OBSERVES_RUNTIME_TARGET", source_ref: `observations:${id}` });
      }
    }
  }
  if (obs.length > 0) builtFrom.push("machine-observation/observations");

  const rt = readJsonl("control/machine-observation/data/runtime-targets.jsonl");
  for (const r of rt) {
    const id = str(r.runtime_target_id) ?? str(r.target_id);
    if (id === null) continue;
    add({ node_id: nodeId("RUNTIME", id), layer_id: "RUNTIME",
      label: str(r.canonical_name) ?? id, source_ref: `runtime-targets:${id}`, purpose: null });
    const capId = str(r.capability_id);
    if (capId !== null) {
      edges.push({ from: nodeId("RUNTIME", id), to: nodeId("CAPABILITIES", capId),
        kind: "RUNTIME_SERVES_CAPABILITY", source_ref: `runtime-targets:${id}` });
    }
  }
  if (rt.length > 0) builtFrom.push("machine-observation/runtime-targets");

  // CONNECTED_EXTERNAL_RESOURCES
  const conns = readJsonl("connections/connection-registry/data/connections.jsonl");
  for (const c of conns) {
    const id = str(c.connection_id);
    if (id === null) continue;
    add({ node_id: nodeId("CONNECTED_EXTERNAL_RESOURCES", id), layer_id: "CONNECTED_EXTERNAL_RESOURCES",
      label: str(c.adapter) ?? str(c.provider) ?? id, source_ref: `connections:${id}`, purpose: null });
    // ── ความสัมพันธ์ที่แถวนี้ประกาศไว้เอง ──
    // `executor_capability_id` และ `credential_ref` เป็นช่องที่ผู้เขียนแถวใส่ไว้
    // การไม่แปลงเป็นเส้น ทำให้คำถาม "ถ้าไม่มีที่เก็บซอร์สภายนอกแล้วเหลืออะไร"
    // ตอบว่า "ไม่กระทบอะไรเลย" ทั้งที่ความสัมพันธ์ถูกประกาศไว้แล้วในข้อมูล
    const exec = str(c.executor_capability_id);
    if (exec !== null) {
      edges.push({ from: nodeId("CONNECTED_EXTERNAL_RESOURCES", id), to: nodeId("CAPABILITIES", exec),
        kind: "CONNECTION_SERVES_CAPABILITY", source_ref: `connections:${id}` });
    }
    const credRef = str((c.credential_ref as Record<string, unknown> | undefined)?.ref);
    if (credRef !== null) {
      edges.push({ from: nodeId("CONNECTED_EXTERNAL_RESOURCES", id), to: nodeId("CREDENTIAL_POINTERS", credRef),
        kind: "CONNECTION_USES_CREDENTIAL", source_ref: `connections:${id}` });
    }
  }
  if (conns.length > 0) builtFrom.push("connection-registry");

  // CREDENTIAL_POINTERS — ตัวชี้เท่านั้น ไม่มีค่าความลับผ่านชั้นนี้
  const creds = readJsonl("credentials/registry/data/api-credential-references.jsonl");
  for (const c of creds) {
    const id = str(c.credential_ref);
    if (id === null) continue;
    add({ node_id: nodeId("CREDENTIAL_POINTERS", id), layer_id: "CREDENTIAL_POINTERS",
      label: str(c.provider) ?? id, source_ref: `api-credential-references:${id}`, purpose: null });
  }
  if (creds.length > 0) builtFrom.push("credentials/registry");

  // HISTORY
  const events = readJsonl("software/registry-database/data/canonical/registration_events.jsonl");
  counts.set("HISTORY", events.length);
  if (events.length > 0) builtFrom.push("registry-database/registration_events");

  // ── สำรวจร่างกาย: ฮาร์ดแวร์/OS, ซอฟต์แวร์ที่ติดตั้ง, ฐานข้อมูลท้องถิ่น ──
  // ผูกเข้ากับ MACHINE ที่มีอยู่แล้ว ไม่แตะตัวตนของโหนดเดิมสักตัว
  if (options.census !== false && machineId !== null) {
    const c = census(machineId);
    const machineNode = nodeId("MACHINE", machineId);

    for (const f of c.facts) {
      const id = `${f.fact_type}/${f.observed_value}`;
      add({ node_id: nodeId("HARDWARE_OS", id), layer_id: "HARDWARE_OS",
        label: `${f.fact_type}=${f.observed_value}`, source_ref: f.evidence_ref, purpose: null });
      edges.push({ from: nodeId("HARDWARE_OS", id), to: machineNode,
        kind: "OBSERVED_ON_MACHINE", source_ref: f.evidence_ref });
    }
    if (c.facts.length > 0) builtFrom.push("census/hardware-os");

    for (const sw of c.software) {
      add({ node_id: nodeId("INSTALLED_SOFTWARE", `${sw.kind}/${sw.name}`), layer_id: "INSTALLED_SOFTWARE",
        label: sw.name, source_ref: sw.evidence_ref, purpose: null });
      // ซอฟต์แวร์พึ่งเครื่อง: เครื่องหายไป ของบนเครื่องก็เรียกใช้ไม่ได้
      edges.push({ from: nodeId("INSTALLED_SOFTWARE", `${sw.kind}/${sw.name}`), to: machineNode,
        kind: "SOFTWARE_RUNS_ON_MACHINE", source_ref: sw.evidence_ref });
    }
    if (c.software.length > 0) builtFrom.push("census/installed-software");

    for (const db of c.databases) {
      const id = `${db.kind}/${db.name}`;
      add({ node_id: nodeId("LOCAL_DATABASES", id), layer_id: "LOCAL_DATABASES",
        label: db.name, source_ref: db.evidence_ref, purpose: null });
      edges.push({ from: nodeId("LOCAL_DATABASES", id), to: machineNode,
        kind: "SOFTWARE_RUNS_ON_MACHINE", source_ref: db.evidence_ref });
      if (db.engine_ref !== null) {
        const engineName = db.engine_ref.replace("database-engine://", "");
        edges.push({ from: nodeId("LOCAL_DATABASES", id),
          to: nodeId("LOCAL_DATABASES", `DATABASE_ENGINE/${engineName}`),
          kind: "INSTANCE_OF_ENGINE", source_ref: db.evidence_ref });
      }
    }
    if (c.databases.length > 0) builtFrom.push("census/local-databases");
  }

  // ── ความสัมพันธ์การเรียกใช้ที่ถูกประกาศไว้แล้วแต่ไม่เคยถูกฉายลงกราฟ ──
  // สร้างเส้นเฉพาะคู่ที่ทั้งสองปลายเป็นโหนดจริง ไม่สร้างโหนดปลอมมารองรับ
  if (options.invocation !== false) {
    const has = (id: string): boolean => nodes.some((n) => n.node_id === id);
    const capNode = (id: string): string => nodeId("CAPABILITIES", id);
    for (const d of projectDeclaredInvocations()) {
      const to = capNode(d.capability_id);
      if (!has(to)) continue;
      if (d.caller !== null) {
        const from = capNode(d.caller);
        if (has(from) && from !== to) {
          edges.push({ from, to, source_ref: d.evidence_ref,
            kind: d.kind === "CAPABILITY_DISPATCHED_TO_EXECUTOR"
              ? "CAPABILITY_DISPATCHED_TO_EXECUTOR" : "CAPABILITY_INVOKED_BY_CAPABILITY" });
        }
      }
      if (d.process_service !== null) {
        const proc = nodeId("INSTALLED_SOFTWARE", `BACKGROUND_SERVICE/${d.process_service}`);
        if (has(proc)) edges.push({ from: to, to: proc, kind: "CAPABILITY_RUNS_IN_PROCESS", source_ref: d.evidence_ref });
      }
    }
    builtFrom.push("invocation/declared");
  }

  const coverage = MACHINE_LAYERS.map((l) => {
    const n = counts.get(l.layer_id) ?? 0;
    const status: LayerStatus = n > 0 ? "REPRESENTED" : l.source_store === null ? "NOT_REPRESENTED" : "EMPTY";
    return { layer_id: l.layer_id, order: l.order, status, node_count: n, source_store: l.source_store,
      reason: n > 0 && l.source_store === null ? `สำรวจได้ ${n} รายการจากการวัดเครื่องโดยตรง`
        : l.source_store === null ? "ยังไม่มีแหล่งใดในระบบบันทึกชั้นนี้"
        : n > 0 ? `อ่านได้ ${n} รายการจาก ${l.source_store}`
        : `แหล่ง ${l.source_store} มีอยู่แต่ยังไม่มีข้อมูล` };
  });

  return { machine_id: machineId, nodes, edges, coverage, built_from: builtFrom };
}
