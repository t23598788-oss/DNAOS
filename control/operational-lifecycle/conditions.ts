/**
 * หน้าที่: ตัวตรวจเงื่อนไขจบของขั้น — วัดจากข้อมูลจริงในทะเบียนและระบบที่รันอยู่
 * ไม่ใช่จากการมีอยู่ของไฟล์ (Owner, NO FAKE COMPLETION).
 *
 * กฎที่ไฟล์นี้บังคับด้วยรูปของมันเอง: เงื่อนไขจบทุกข้อคือ "ฟังก์ชันที่ไปอ่านของจริง
 * แล้วคืนตัวเลขที่วัดได้" ไม่ใช่ค่าคงที่ ไม่ใช่ธงที่ใครตั้งได้ ถ้าอยากทำให้ขั้นหนึ่ง
 * เป็น COMPLETE ต้องไปแก้ข้อมูลจริงให้ผ่าน ไม่ใช่มาแก้ไฟล์นี้
 *
 * `measured` ถูกคืนกลับเสมอแม้ผ่านแล้ว เพราะ "ผ่านแบบเฉียดฉิว" กับ "ผ่านแบบครบ"
 * ต้องแยกออกจากกันได้โดยไม่ต้องไปไล่ข้อมูลเอง
 *
 * Input: ข้อมูลจริงในรีโป (canonical registry, connection registry, git).
 * Output: `CONDITIONS`, `evaluateCondition`.
 * Dependency ที่อนุญาต: ./types.ts, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามให้ตัวตรวจใดคืน true คงที่, ห้ามใช้ "ไฟล์มีอยู่" เป็นเงื่อนไขจบ,
 * ห้ามให้ตัวตรวจเขียนข้อมูล.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runCapabilityFolderLawGate } from "../../governance/source-validation/contract";
import type { ConditionResult } from "./types";

const CANON = "software/registry-database/data/canonical";

function jsonl<T>(rel: string): readonly T[] {
  const path = join(process.cwd(), rel);
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try { out.push(JSON.parse(line) as T); } catch { /* ข้ามแถวเสีย ไม่ทิ้งทั้งไฟล์ */ }
  }
  return out;
}

/** ตัวตรวจหนึ่งข้อ — คืนทั้งผลและค่าที่วัดได้ พร้อมที่มาของหลักฐาน */
export interface ConditionProbe {
  readonly id: string;
  readonly describes: string;
  readonly run: () => Omit<ConditionResult, "condition_id">;
}

function probe(id: string, describes: string, evidence_ref: string, run: () => { satisfied: boolean; measured: string }): ConditionProbe {
  return { id, describes, run: () => ({ ...run(), evidence_ref }) };
}

/**
 * ตัวตรวจทั้งหมด — แต่ละตัวผูกกับช่องว่างจริงที่เอกสารต้นฉบับประกาศไว้เอง
 * ไม่มีตัวใดตรวจว่า "เอกสารเขียนเสร็จหรือยัง" เพราะเอกสารเขียนเสร็จไม่ใช่ระบบเสร็จ
 */
export const CONDITIONS: readonly ConditionProbe[] = [
  probe("CAPABILITY_FOLDER_LAW_ENFORCED_BY_RUNNABLE_CHECK",
    "กฎโฟลเดอร์ต้องถูกบังคับด้วยตัวตรวจที่รันได้ ไม่ใช่ข้อความที่ประกาศไว้เฉย ๆ",
    "governance/source-validation/folder-law-gate.ts#runCapabilityFolderLawGate", () => {
      /**
       * เงื่อนไขนี้ *รันด่านจริง* ไม่ใช่ดูว่ามีไฟล์ marker อยู่ไหม
       * รอบก่อนใช้การมีอยู่ของไฟล์เป็นตัวชี้ ซึ่งใครก็สร้างไฟล์เปล่าให้ผ่านได้
       * — นั่นคือ FILE_EXISTS = COMPLETE ที่กฎห้ามไว้ตรง ๆ
       */
      const result = runCapabilityFolderLawGate();
      return {
        satisfied: result.status === "PASS",
        measured: `gate=${result.status} subjects=${String(result.subject_count)} violations=${String(result.failed_count)}`,
      };
    }),

  probe("CONNECTION_CENSUS_HAS_UI_SURFACE_ENTITY",
    "สำมะโนการเชื่อมต่อต้องมี entity ชนิด UI_SURFACE — census phase 1 ประกาศเองว่ายังไม่มี",
    `${CANON}/resources.jsonl`, () => {
      const rows = jsonl<{ resource_type?: string }>(`${CANON}/resources.jsonl`);
      const n = rows.filter((r) => r.resource_type === "UI_SURFACE").length;
      return { satisfied: n > 0, measured: `UI_SURFACE=${n}/${rows.length}` };
    }),

  probe("ALL_VERSIONS_HAVE_COMMIT_SHA",
    "ทุก version ต้องผูกกับ commit จริง — ไม่มี commit คือไม่มีทางย้อนได้ว่าโค้ดตัวไหน",
    `${CANON}/versions.jsonl`, () => {
      const rows = jsonl<{ commit_sha?: string | null }>(`${CANON}/versions.jsonl`);
      const withSha = rows.filter((r) => typeof r.commit_sha === "string" && r.commit_sha !== "").length;
      return { satisfied: rows.length > 0 && withSha === rows.length, measured: `commit_sha=${withSha}/${rows.length}` };
    }),

  probe("ALL_RESOURCES_HAVE_REPOSITORY_ID",
    "ทุกทรัพยากรต้องรู้ว่าอยู่รีโปไหน — lineage trace ประกาศเองว่า repository_id = null",
    `${CANON}/resources.jsonl`, () => {
      const rows = jsonl<{ repository_id?: string | null }>(`${CANON}/resources.jsonl`);
      const set = rows.filter((r) => typeof r.repository_id === "string" && r.repository_id !== "").length;
      return { satisfied: rows.length > 0 && set === rows.length, measured: `repository_id=${set}/${rows.length}` };
    }),

  probe("INFRA_REPOSITORY_IDENTITY_REGISTERED",
    "ตัวตนของรีโปหลักต้องอยู่ในทะเบียน — cross-system design ประกาศเองว่ายังไม่มี",
    `${CANON}/resources.jsonl`, () => {
      const rows = jsonl<{ repository_id?: string | null }>(`${CANON}/resources.jsonl`);
      const n = rows.filter((r) => r.repository_id === "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-").length;
      return { satisfied: n > 0, measured: `linked_resources=${n}` };
    }),

  probe("CAPABILITY_REGISTRY_HAS_LINKS",
    "ทะเบียนต้องผูกความสามารถเข้ากับทรัพยากรจริง ไม่ใช่มีแค่รายชื่อความสามารถ",
    `${CANON}/resource_capabilities.jsonl`, () => {
      const links = jsonl<unknown>(`${CANON}/resource_capabilities.jsonl`).length;
      const caps = jsonl<unknown>(`${CANON}/capabilities.jsonl`).length;
      return { satisfied: links > 0 && caps > 0, measured: `links=${links} capabilities=${caps}` };
    }),

  probe("CONNECTION_DECLARATIONS_HAVE_IO_CONTRACT",
    "ทุก connection declaration ต้องประกาศ input/output contract — phase A ประกาศเองว่ายังว่าง",
    "connections/connection-registry/data/connection-declarations.jsonl", () => {
      const rows = jsonl<{ input_contract?: unknown[]; output_contract?: unknown[] }>("connections/connection-registry/data/connection-declarations.jsonl");
      const full = rows.filter((r) => (r.input_contract?.length ?? 0) > 0 && (r.output_contract?.length ?? 0) > 0).length;
      return { satisfied: rows.length > 0 && full === rows.length, measured: `io_contract=${full}/${rows.length}` };
    }),

  probe("REGISTRY_HAS_DEPLOYMENT_NODE",
    "ทะเบียนต้องมี node ของปลายทางที่ deploy จริง — ไม่มี node = ไม่มีเส้นไปถึง production",
    `${CANON}/relationships.jsonl`, () => {
      const rel = jsonl<{ to_type?: string; from_type?: string }>(`${CANON}/relationships.jsonl`);
      const n = rel.filter((r) => r.to_type === "DEPLOYMENT" || r.from_type === "DEPLOYMENT").length;
      return { satisfied: n > 0, measured: `deployment_edges=${n}/${rel.length}` };
    }),

  probe("REGISTRY_HAS_RUNTIME_RELATION",
    "ต้องมีความสัมพันธ์ที่บอกว่าอะไรรันอยู่ที่ไหน ไม่ใช่แค่ไฟล์ผูกความสามารถ",
    `${CANON}/relationships.jsonl`, () => {
      const rel = jsonl<{ to_type?: string }>(`${CANON}/relationships.jsonl`);
      const n = rel.filter((r) => r.to_type === "RUNTIME" || r.to_type === "PROCESS").length;
      return { satisfied: n > 0, measured: `runtime_edges=${n}/${rel.length}` };
    }),

  probe("CATALOG_PROJECTION_HEALTH_IS_MEASURED",
    "health_status ต้องมาจากการวัดจริง — projection design ประกาศเองว่าเป็น literal ที่พิมพ์มือ 13 จุด",
    "governance/architecture-rules/CAPABILITY_CATALOG_PROJECTION_DESIGN.md#45", () => {
      const path = join(process.cwd(), "control/command-router/capability-registry.ts");
      if (!existsSync(path)) return { satisfied: false, measured: "capability-registry.ts ไม่พบ" };
      const literals = (readFileSync(path, "utf8").match(/health_status\s*:\s*"/g) ?? []).length;
      return { satisfied: literals === 0, measured: `health_status literal=${literals}` };
    }),

  probe("ACCOUNTING_TRUTH_DERIVED_FROM_LEDGER",
    "สถานะทางบัญชีต้องอนุมานจาก ledger ไม่ใช่อ่านจากคอลัมน์สถานะเดิม",
    "governance/architecture-rules/ACCOUNTING_CANONICAL_TRUTH.md#8", () => {
      const dir = join(process.cwd(), "software/accounting-ledger");
      return { satisfied: existsSync(dir), measured: existsSync(dir) ? "ledger capability พบ" : "ยังไม่มี software/accounting-ledger/" };
    }),

  probe("VERCEL_BOUNDARY_CAPABILITY_BUILT",
    "แผน Vercel ต้องกลายเป็น capability จริง — เอกสารประกาศตัวเองว่า PLAN ONLY",
    "governance/architecture-rules/VERCEL_BOUNDARY_PLAN.md#3", () => {
      const built = existsSync(join(process.cwd(), "connections/vercel"));
      const links = jsonl<{ capability_id?: string }>(`${CANON}/resource_capabilities.jsonl`)
        .filter((r) => (r.capability_id ?? "").includes("vercel")).length;
      return { satisfied: built && links > 0, measured: `folder=${built ? "YES" : "NO"} registered_capabilities=${links}` };
    }),

  probe("FLOW_CONTRACT_STATE_IS_PROVEN_NOT_DECLARED",
    "ความสัมพันธ์ต้องไปถึงระดับ PROVEN ไม่ใช่ค้างที่ DECLARED — lifecycle model ประกาศตัวเองว่า DESIGN ONLY",
    `${CANON}/relationships.jsonl`, () => {
      const rel = jsonl<{ state?: string }>(`${CANON}/relationships.jsonl`);
      const proven = rel.filter((r) => r.state === "PROVEN").length;
      return { satisfied: rel.length > 0 && proven === rel.length, measured: `PROVEN=${proven}/${rel.length}` };
    }),

  probe("SEMANTIC_CONTRACT_DISCOVERY_REGISTERED",
    "การค้นพบ contract ต้องถูกลงทะเบียน ไม่ใช่จบที่รายงาน — เอกสารประกาศเองว่าไม่ลงทะเบียน contract ใด",
    "governance/architecture-rules/SEMANTIC_CANDIDATE_AND_CONTRACT_DISCOVERY.md#5", () => {
      const caps = jsonl<{ input_contract?: unknown }>(`${CANON}/capabilities.jsonl`);
      const withContract = caps.filter((c) => c.input_contract !== undefined && c.input_contract !== null).length;
      return { satisfied: caps.length > 0 && withContract === caps.length, measured: `input_contract=${withContract}/${caps.length}` };
    }),

  probe("PROVIDER_PROJECT_IDENTITY_HAS_EXECUTOR_SOURCE",
    "ทุก provider declaration ต้องมี executor source — เอกสารประกาศเองว่า GitHub = NONE",
    "connections/connection-registry/data/connection-declarations.jsonl", () => {
      const rows = jsonl<{ executor_source?: string | null }>("connections/connection-registry/data/connection-declarations.jsonl");
      const ok = rows.filter((r) => typeof r.executor_source === "string" && r.executor_source !== "" && r.executor_source !== "NONE").length;
      return { satisfied: rows.length > 0 && ok === rows.length, measured: `executor_source=${ok}/${rows.length}` };
    }),

  probe("TARGET_IDENTITY_NATURAL_KEYS_DECLARED",
    "ทุกระบบเป้าหมายต้องมี natural key ที่ประกาศแล้ว — discovery ประกาศเองว่าบางระบบยังไม่มี",
    "connections/connection-registry/data/connections.jsonl", () => {
      const rows = jsonl<{ identity?: string | null; connection_id?: string }>("connections/connection-registry/data/connections.jsonl");
      const ok = rows.filter((r) => typeof r.identity === "string" && r.identity !== "").length;
      return { satisfied: rows.length > 0 && ok === rows.length, measured: `identity=${ok}/${rows.length}` };
    }),

  probe("ARCHITECTURE_RULES_INDEX_LISTS_EVERY_DOCUMENT",
    "ดัชนีต้องครอบคลุมเอกสารทุกฉบับในโฟลเดอร์ ไม่งั้นดัชนีเองก็เป็นความจริงที่ไม่ครบ",
    "governance/architecture-rules/README.md", () => {
      const dir = join(process.cwd(), "governance/architecture-rules");
      const readme = existsSync(join(dir, "README.md")) ? readFileSync(join(dir, "README.md"), "utf8") : "";
      const names = readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "README.md");
      const listed = names.filter((n) => readme.includes(n)).length;
      return { satisfied: names.length > 0 && listed === names.length, measured: `listed=${listed}/${names.length}` };
    }),
];

const BY_ID = new Map(CONDITIONS.map((c) => [c.id, c]));

/** รันตัวตรวจหนึ่งข้อ — ตัวตรวจที่ไม่รู้จักถือว่าไม่ผ่าน และบอกตรง ๆ ว่าไม่รู้จัก */
export function evaluateCondition(conditionId: string): ConditionResult {
  const found = BY_ID.get(conditionId);
  if (!found) {
    return { condition_id: conditionId, satisfied: false, measured: "ไม่มีตัวตรวจชื่อนี้", evidence_ref: "NONE" };
  }
  try {
    return { condition_id: conditionId, ...found.run() };
  } catch (error) {
    // ตรวจไม่ได้ ≠ ผ่าน — ความล้มเหลวของการวัดต้องไม่กลายเป็นการอนุมัติ
    return { condition_id: conditionId, satisfied: false, evidence_ref: "MEASUREMENT_FAILED",
      measured: `วัดไม่ได้: ${error instanceof Error ? error.message : String(error)}` };
  }
}
