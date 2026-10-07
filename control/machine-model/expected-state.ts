/**
 * หน้าที่: เทียบสิ่งที่ควรเป็น กับสิ่งที่เป็นอยู่ แล้วบอกว่าต่างกันตรงไหนและใครเดือดร้อน
 *
 * ── ทำไมต้องมีสิ่งที่ควรเป็นก่อน ──
 * ถ้าไม่มีใครประกาศว่าเครื่องนี้ควรมีอะไรทำงานอยู่ คำว่า "ซ่อมตัวเอง" ก็เหลือแค่
 * การเดาว่าน่าจะซ่อมอะไร ไฟล์นี้จึงเริ่มจากคำประกาศเสมอ และเมื่อไม่มีคำประกาศ
 * มันตอบว่า `NOT_DECLARED` ไม่ใช่เอาสิ่งที่สังเกตได้มาตั้งเป็นสิ่งที่ควรเป็น
 * — เพราะถ้าทำอย่างนั้น ระบบที่พังอยู่จะกลายเป็นระบบที่ "ถูกต้อง" ทันที
 *
 * ── แหล่งของคำประกาศ ──
 * `runtime-targets.jsonl` เป็นคำประกาศที่มีอยู่แล้ว: launchd label, argv, host,
 * port, สถานะ health ที่คาดหวัง พร้อม evidence_refs ไม่สร้างที่เก็บใหม่
 *
 * ── การวัดไม่ใช่การซ่อม ──
 * ทุกทางในไฟล์นี้จบที่ข้อเสนอ ไม่มีทางใดสั่งรีสตาร์ต เขียนไฟล์ หรือส่ง Agent
 * และ target ที่ประกาศ `authority: OBSERVE_ONLY` จะได้ `repair_permitted=false`
 * ตายตัวจากชนิดข้อมูล ไม่ใช่จากวินัยของผู้เรียก
 *
 * Input: `MachineModel`, `DependencyIndex`
 * Output: `readExpectedState`, `diffMachineState`, `StateDifference`
 * Dependency ที่อนุญาต: ./model.ts, ./dependency-index.ts, owner-error-lane (ถามทะเบียน)
 * สิ่งที่ห้ามแตะ: ห้ามตั้งสิ่งที่สังเกตได้เป็นสิ่งที่ควรเป็น ห้ามซ่อม ห้ามเขียนไฟล์
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOwnershipForPath } from "../owner-error-lane/contract";
import type { MachineModel } from "./model";
import type { DependencyIndex } from "./dependency-index";

export interface ExpectedNode {
  readonly node_id: string;
  readonly canonical_name: string;
  readonly launchd_label: string | null;
  readonly host: string | null;
  readonly port: number | null;
  readonly health_path: string | null;
  readonly expected_status: number | null;
  /** `OBSERVE_ONLY` = ประกาศไว้ให้ดูเท่านั้น ห้ามลงมือ */
  readonly authority: string;
  readonly served_capability_id: string | null;
  readonly basis: string;
  readonly evidence_refs: readonly string[];
}

export type DifferenceClass =
  | "MATCH"
  | "SERVICE_NOT_LOADED"
  | "SERVICE_NOT_RESPONDING"
  | "UNEXPECTED_STATUS"
  | "NOT_MEASURABLE";

export interface StateDifference {
  readonly expectation: ExpectedNode;
  readonly observed: string;
  readonly difference_class: DifferenceClass;
  /** สิ่งที่พึ่งพาสิ่งนี้อยู่ — มาจากดัชนีทิศกลับ ไม่ใช่การเดา */
  readonly dependency_impact: readonly string[];
  readonly known_recovery_capability: string | null;
  readonly recovery_status: "KNOWN" | "NOT_REGISTERED" | "NONE_DECLARED";
  /** ตายตัว: ชั้นนี้ไม่ส่งอะไรไปทำ */
  readonly dispatched: false;
  readonly repair_permitted: boolean;
  readonly verify_plan: string | null;
  readonly evidence_refs: readonly string[];
}

export type TargetCoverageClass = "DECLARED_EXPECTED" | "MISSING_EXPECTATION";

export interface TargetCoverage {
  readonly launchd_label: string;
  readonly coverage_class: TargetCoverageClass;
  /** ความสามารถที่ประกาศไว้ว่า target นี้ให้บริการ — `null` เมื่อไม่มีคำประกาศ */
  readonly declared_capability_id: string | null;
  readonly declaration_source: string | null;
  readonly reason: string;
}

export interface ExpectedStateCoverage {
  readonly expected_target_count: number;
  readonly observed_target_count: number;
  readonly match_count: number;
  readonly deviation_count: number;
  readonly missing_expectation_count: number;
  readonly recovery_resolvable_count: number;
  readonly targets: readonly TargetCoverage[];
}

export interface ExpectedStateReport {
  readonly declared_count: number;
  readonly differences: readonly StateDifference[];
  /** ชั้นที่ยังไม่มีใครประกาศว่าควรเป็นอย่างไร — ต้องเห็น ไม่ใช่หายไป */
  readonly undeclared_layers: readonly string[];
}

const TARGETS = "control/machine-observation/data/runtime-targets.jsonl";

/** คำนำหน้า label ของบริการ DNA OS บนเครื่องนี้ — ใช้ระบุขอบเขตการสำรวจ ไม่ใช่ใช้เดาความหมาย */
const SERVICE_LABEL_PREFIX = "com.dnaos.";

/** อ่านคำประกาศที่มีอยู่ — ไม่มีการอนุมานจากสิ่งที่กำลังรัน */
export function readExpectedState(): readonly ExpectedNode[] {
  const path = join(process.cwd(), TARGETS);
  if (!existsSync(path)) return [];
  const out: ExpectedNode[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (s.length === 0) continue;
    let r: Record<string, any>;
    try { r = JSON.parse(s); } catch { continue; }
    const id = typeof r.runtime_target_id === "string" ? r.runtime_target_id : null;
    if (id === null) continue;
    out.push({
      node_id: `machine://RUNTIME/${id}`,
      canonical_name: typeof r.canonical_name === "string" ? r.canonical_name : id,
      launchd_label: r.process?.launchd_label ?? null,
      host: r.network?.host ?? null,
      port: typeof r.network?.port === "number" ? r.network.port : null,
      health_path: r.health?.path ?? null,
      expected_status: typeof r.health?.expected_status === "number" ? r.health.expected_status : null,
      authority: typeof r.authority === "string" ? r.authority : "UNDECLARED",
      served_capability_id: typeof r.capability_id === "string" ? r.capability_id : null,
      basis: `${TARGETS}:${id}`,
      evidence_refs: Array.isArray(r.evidence_refs) ? r.evidence_refs : [],
    });
  }
  return out;
}

function launchdLoaded(label: string): boolean | null {
  try {
    const out = execFileSync("launchctl", ["list"], { encoding: "utf8", timeout: 10_000 });
    return out.split("\n").some((l) => l.trim().endsWith(label));
  } catch { return null; }
}

function httpStatus(host: string, port: number, path: string): number | null {
  try {
    const out = execFileSync("curl", ["-s", "-m", "4", "-o", "/dev/null", "-w", "%{http_code}",
      `http://${host}:${port}${path}`], { encoding: "utf8", timeout: 10_000 });
    const n = Number(out.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

/**
 * ความสามารถที่รู้จักวิธีกู้คืน — ถามทะเบียน ไม่ใช่ตั้งชื่อเอา
 *
 * ถ้าทะเบียนไม่รู้จักเจ้าของของ `control/runtime-control/` ผลคือ
 * `NOT_REGISTERED` ซึ่งแปลว่ายังไม่มีใครรับผิดชอบการกู้คืน ไม่ใช่ว่ากู้ไม่ได้
 */
function knownRecovery(): { id: string | null; status: "KNOWN" | "NOT_REGISTERED" } {
  // `control/runtime-control/` คือแถวโฟลเดอร์ที่ทะเบียนผูกไว้กับ
  // service-lifecycle-supervision (บูตบริการตามลำดับที่ประกาศ พร้อมจำนวนครั้งที่จำกัด)
  // — ถามด้วย path ของทะเบียน ไม่ได้ตั้งชื่อ capability เอง
  const owned = resolveOwnershipForPath("control/runtime-control/");
  return owned.capability_id !== null
    ? { id: owned.capability_id, status: "KNOWN" }
    : { id: null, status: "NOT_REGISTERED" };
}

/**
 * Expected ↕ Observed → Difference → ผลกระทบ → ความสามารถกู้คืน → ข้อเสนอ
 *
 * ไม่มีขั้น "ซ่อม" ในสายนี้โดยตั้งใจ ข้อเสนอจบที่ `dispatched: false` เสมอ
 */
export function diffMachineState(model: MachineModel, index: DependencyIndex): ExpectedStateReport {
  const expected = readExpectedState();
  const recovery = knownRecovery();
  const differences: StateDifference[] = [];

  for (const e of expected) {
    const evidence: string[] = [e.basis];
    let cls: DifferenceClass = "NOT_MEASURABLE";
    let observed = "ยังวัดไม่ได้";

    if (e.launchd_label !== null) {
      const loaded = launchdLoaded(e.launchd_label);
      evidence.push(`launchctl list -> ${e.launchd_label}: ${loaded === null ? "อ่านไม่ได้" : loaded}`);
      if (loaded === false) { cls = "SERVICE_NOT_LOADED"; observed = "launchd ไม่ได้โหลดบริการนี้"; }
    }
    if (cls !== "SERVICE_NOT_LOADED" && e.host !== null && e.port !== null && e.health_path !== null) {
      const status = httpStatus(e.host, e.port, e.health_path);
      evidence.push(`GET http://${e.host}:${e.port}${e.health_path} -> ${status ?? "ไม่ตอบ"}`);
      if (status === null) { cls = "SERVICE_NOT_RESPONDING"; observed = "ไม่มีการตอบกลับ"; }
      else if (e.expected_status !== null && status !== e.expected_status) {
        cls = "UNEXPECTED_STATUS"; observed = `HTTP ${status} แทนที่จะเป็น ${e.expected_status}`;
      } else { cls = "MATCH"; observed = `HTTP ${status}`; }
    }

    // ผลกระทบมาจากดัชนีทิศกลับของความสามารถที่ target นี้ให้บริการ
    const impactRoot = e.served_capability_id !== null
      ? `machine://CAPABILITIES/${e.served_capability_id}` : e.node_id;
    const impact = index.impactOf(impactRoot).map((p) => p.node_id);

    differences.push({
      expectation: e, observed, difference_class: cls,
      dependency_impact: impact,
      known_recovery_capability: recovery.id, recovery_status: recovery.status,
      dispatched: false,
      // สิทธิ์ลงมือมาจากคำประกาศของ target เอง ไม่ใช่จากความรุนแรงของปัญหา
      repair_permitted: e.authority !== "OBSERVE_ONLY" && recovery.status === "KNOWN" && cls !== "MATCH",
      verify_plan: cls === "MATCH" ? null
        : e.host !== null && e.port !== null && e.health_path !== null
          ? `GET http://${e.host}:${e.port}${e.health_path} ต้องได้ ${e.expected_status ?? "สถานะที่ประกาศไว้"}`
          : null,
      evidence_refs: [...evidence, ...e.evidence_refs],
    });
  }

  const declaredLayers = new Set(["RUNTIME", "PROCESSES_SERVICES"]);
  const undeclared = model.coverage
    .filter((c) => !declaredLayers.has(c.layer_id))
    .map((c) => c.layer_id);

  return { declared_count: expected.length, differences, undeclared_layers: undeclared };
}

/**
 * ความครอบคลุมของ "สิ่งที่ควรเป็น" เทียบกับบริการที่รันอยู่จริงบนเครื่องนี้
 *
 * บริการที่สังเกตเห็นแต่ไม่มีคำประกาศ จะขึ้นเป็น `MISSING_EXPECTATION` และ
 * **ไม่ถูกแปลงเป็นความคาดหวัง** ต่อให้มันดูปกติดีอยู่ตอนนี้ — เพราะสิ่งที่กำลัง
 * ทำงานอยู่ ไม่ใช่ข้อพิสูจน์ว่ามันควรทำงานอยู่ และไม่ใช่ข้อพิสูจน์ว่าควรทำงาน
 * แบบที่มันทำอยู่
 *
 * ความสามารถของ target ที่ไม่มีคำประกาศ = `null` ไม่ใช่การเดาจากชื่อ label
 */
export function expectedStateCoverage(model: MachineModel, index: DependencyIndex): ExpectedStateCoverage {
  const report = diffMachineState(model, index);
  const declared = new Map(readExpectedState()
    .filter((e) => e.launchd_label !== null)
    .map((e) => [e.launchd_label as string, e]));

  let observedLabels: string[] = [];
  try {
    const out = execFileSync("launchctl", ["list"], { encoding: "utf8", timeout: 10_000 });
    observedLabels = out.split("\n")
      .map((l) => l.trim().split(/\s+/).pop() ?? "")
      .filter((l) => l.startsWith(SERVICE_LABEL_PREFIX));
  } catch { observedLabels = []; }

  const targets: TargetCoverage[] = [];
  for (const label of [...new Set([...declared.keys(), ...observedLabels])].sort()) {
    const d = declared.get(label);
    targets.push(d !== undefined
      ? { launchd_label: label, coverage_class: "DECLARED_EXPECTED",
          declared_capability_id: d.served_capability_id, declaration_source: d.basis,
          reason: "มีคำประกาศใน runtime-targets.jsonl พร้อมหลักฐาน" }
      : { launchd_label: label, coverage_class: "MISSING_EXPECTATION",
          declared_capability_id: null, declaration_source: null,
          reason: "บริการนี้รันอยู่แต่ไม่มีใครประกาศว่าควรเป็นอย่างไร — สถานะที่สังเกตได้ไม่ถูกยกเป็นความคาดหวัง" });
  }

  return {
    expected_target_count: declared.size,
    observed_target_count: observedLabels.length,
    match_count: report.differences.filter((d) => d.difference_class === "MATCH").length,
    deviation_count: report.differences.filter((d) => d.difference_class !== "MATCH" && d.difference_class !== "NOT_MEASURABLE").length,
    missing_expectation_count: targets.filter((t) => t.coverage_class === "MISSING_EXPECTATION").length,
    recovery_resolvable_count: report.differences.filter((d) => d.recovery_status === "KNOWN").length,
    targets,
  };
}
