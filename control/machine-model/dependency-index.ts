/**
 * หน้าที่: ตอบสองทิศจากกราฟเดียว — "ฉันพึ่งอะไร" และ "อะไรพึ่งฉัน"
 *
 * ── ทำไมทิศเดียวไม่พอ ──
 * ทะเบียนเก็บความสัมพันธ์แบบมีทิศอยู่แล้ว แต่ทุกผู้อ่านในระบบเดินตามทิศเดียว
 * เวลาจะลบ ย้าย ปิด หรือซ่อมอะไรสักอย่าง คำถามที่ต้องตอบคือทิศตรงข้าม และ
 * วันนี้ยังไม่มีใครตอบได้ ดัชนีนี้สร้างทิศกลับจากแถวเดิม ไม่ใช่จากข้อมูลใหม่
 *
 * ── ทิศของความสัมพันธ์ ไม่ใช่ทิศของลูกศร ──
 * `FILE -> CAPABILITY` ลูกศรชี้จากไฟล์ไปหาความสามารถ แต่ผู้ที่พึ่งพาคือ
 * ความสามารถ ลบไฟล์แล้วความสามารถพัง ไม่ใช่ทางกลับ การอ่านทิศพึ่งพาจากทิศ
 * ลูกศรตรง ๆ จะได้ผลกระทบกลับหัวทุกครั้ง `EDGE_SEMANTICS` จึงประกาศความหมาย
 * ของแต่ละชนิดไว้ทีละตัว
 *
 * ── ชนิดที่ยังไม่มีใครประกาศความหมาย ไม่เข้ากราฟผลกระทบ ──
 * เดาว่า "น่าจะเป็นการพึ่งพา" แล้วคำนวณ blast radius ผิด อันตรายกว่าการตอบว่า
 * ยังไม่รู้ ชนิดที่ไม่ประกาศจะถูกนับและรายงานแยก ไม่ถูกใช้เงียบ ๆ
 *
 * Input: `MachineModel`
 * Output: `buildDependencyIndex`, `DependencyIndex`
 * Dependency ที่อนุญาต: ./model.ts (type)
 * สิ่งที่ห้ามแตะ: ห้ามเดาทิศของชนิดที่ไม่ได้ประกาศ ห้ามเขียนไฟล์
 */

import type { MachineEdge, MachineModel } from "./model";

export type EdgeDirection = "FROM_DEPENDS_ON_TO" | "TO_DEPENDS_ON_FROM" | "NOT_A_DEPENDENCY" | "UNDECLARED";

/** ความหมายของแต่ละชนิด ประกาศไว้ทีละตัว ไม่ได้อนุมานจากชื่อ */
export const EDGE_SEMANTICS: Readonly<Record<string, EdgeDirection>> = {
  MODULE_TO_CAPABILITY: "TO_DEPENDS_ON_FROM",
  OWNED_BY_CAPABILITY: "TO_DEPENDS_ON_FROM",
  RUNTIME_SERVES_CAPABILITY: "TO_DEPENDS_ON_FROM",
  CAPABILITY_TO_DEPENDENCY: "FROM_DEPENDS_ON_TO",
  ORCHESTRATES_CAPABILITY: "FROM_DEPENDS_ON_TO",
  EXECUTOR_USES_CONNECTION_REGISTRY: "FROM_DEPENDS_ON_TO",
  EXECUTOR_REQUIRES_PROVIDER_AUTHORIZATION: "FROM_DEPENDS_ON_TO",
  OBSERVES_RUNTIME_TARGET: "NOT_A_DEPENDENCY",
  // การสังเกตเป็นข้อเท็จจริงของเครื่อง ไม่ใช่การพึ่งพา — เครื่องไม่ได้พึ่ง
  // ค่า CPU ของตัวเอง และค่านั้นก็ไม่ได้พึ่งเครื่องในเชิงหน้าที่
  OBSERVED_ON_MACHINE: "NOT_A_DEPENDENCY",
  // ของบนเครื่องพึ่งเครื่อง: เครื่องหายไป ของทั้งหมดเรียกใช้ไม่ได้
  SOFTWARE_RUNS_ON_MACHINE: "FROM_DEPENDS_ON_TO",
  INSTANCE_OF_ENGINE: "FROM_DEPENDS_ON_TO",
  // ความสามารถที่ประกาศว่ามี connection เป็นผู้ทำงานให้ ย่อมพึ่ง connection นั้น
  CONNECTION_SERVES_CAPABILITY: "TO_DEPENDS_ON_FROM",
  // connection พึ่งตัวชี้กุญแจของมัน — ตัวชี้ ไม่ใช่ค่าความลับ
  CONNECTION_USES_CREDENTIAL: "FROM_DEPENDS_ON_TO",
  // ── ทิศการเรียก กับ ทิศการพึ่งพา ประกาศแยกกันเสมอ ──
  // ผู้เรียกพึ่งผู้ถูกเรียก: ลูกศรการเรียกและลูกศรการพึ่งพาบังเอิญตรงกันตรงนี้
  CAPABILITY_INVOKED_BY_CAPABILITY: "FROM_DEPENDS_ON_TO",
  CAPABILITY_DISPATCHED_TO_EXECUTOR: "FROM_DEPENDS_ON_TO",
  // ความสามารถที่รันอยู่ในบริการ พึ่งบริการนั้น แม้การเรียกจะเข้ามาจากทางอื่น
  CAPABILITY_RUNS_IN_PROCESS: "FROM_DEPENDS_ON_TO",
};

export interface DependencyEdge {
  readonly dependent: string;
  readonly depends_on: string;
  readonly kind: string;
  readonly source_ref: string;
}

export interface ImpactPath {
  readonly node_id: string;
  readonly depth: number;
  readonly via: readonly string[];
}

export interface DependencyIndex {
  /** "ฉันต้องพึ่งอะไรถึงจะทำงานได้" */
  dependenciesOf(nodeId: string): readonly DependencyEdge[];
  /** "มีอะไรพึ่งฉันอยู่" */
  dependentsOf(nodeId: string): readonly DependencyEdge[];
  /** ถ้าสิ่งนี้หายไป อะไรพังตามบ้าง — ปิดเชิงทรานซิทีฟ */
  impactOf(nodeId: string): readonly ImpactPath[];
  readonly declared_edge_count: number;
  readonly undeclared_edge_kinds: readonly string[];
  readonly undeclared_edge_count: number;
}

export function buildDependencyIndex(model: MachineModel): DependencyIndex {
  const declared: DependencyEdge[] = [];
  const undeclaredKinds = new Set<string>();
  let undeclaredCount = 0;

  for (const e of model.edges as readonly MachineEdge[]) {
    const dir = EDGE_SEMANTICS[e.kind] ?? "UNDECLARED";
    if (dir === "UNDECLARED") { undeclaredKinds.add(e.kind); undeclaredCount += 1; continue; }
    if (dir === "NOT_A_DEPENDENCY") continue;
    declared.push(dir === "FROM_DEPENDS_ON_TO"
      ? { dependent: e.from, depends_on: e.to, kind: e.kind, source_ref: e.source_ref }
      : { dependent: e.to, depends_on: e.from, kind: e.kind, source_ref: e.source_ref });
  }

  const forward = new Map<string, DependencyEdge[]>();
  const reverse = new Map<string, DependencyEdge[]>();
  for (const d of declared) {
    (forward.get(d.dependent) ?? forward.set(d.dependent, []).get(d.dependent)!).push(d);
    (reverse.get(d.depends_on) ?? reverse.set(d.depends_on, []).get(d.depends_on)!).push(d);
  }

  return {
    dependenciesOf: (id) => forward.get(id) ?? [],
    dependentsOf: (id) => reverse.get(id) ?? [],
    impactOf(id) {
      // กว้างก่อนลึก เพื่อให้ระยะที่รายงานเป็นระยะสั้นที่สุดจริง ๆ
      const seen = new Set<string>([id]);
      const out: ImpactPath[] = [];
      let frontier: { node: string; via: string[] }[] = [{ node: id, via: [] }];
      let depth = 0;
      while (frontier.length > 0 && depth < 32) {
        depth += 1;
        const next: { node: string; via: string[] }[] = [];
        for (const cur of frontier) {
          for (const d of reverse.get(cur.node) ?? []) {
            if (seen.has(d.dependent)) continue;
            seen.add(d.dependent);
            const via = [...cur.via, d.kind];
            out.push({ node_id: d.dependent, depth, via });
            next.push({ node: d.dependent, via });
          }
        }
        frontier = next;
      }
      return out;
    },
    declared_edge_count: declared.length,
    undeclared_edge_kinds: [...undeclaredKinds].sort(),
    undeclared_edge_count: undeclaredCount,
  };
}
