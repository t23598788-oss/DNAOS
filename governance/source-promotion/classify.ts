/**
 * ตัวจำแนกของเครื่อง — ตัดสินเองว่าห่อการเปลี่ยนแปลงแตะของที่ถูกป้องกันหรือไม่
 *
 * กฎเหล็ก: ไม่เชื่อฟิลด์ใด ๆ จากผู้เสนอเรื่องความเป็นของที่ถูกป้องกัน
 * ทุก path ถูกคลี่ผ่าน realpath ก่อนเทียบ เพื่อให้ symlink ที่ชี้ออกนอก
 * หรือชี้เข้าไปในของที่ถูกป้องกัน ถูกมองเห็นตามความจริง ไม่ใช่ตามชื่อ
 *
 * กำกวมเมื่อไร = DENY เสมอ ไม่มีการเดา
 */
import { realpathSync, existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { REPO_ROOT, PROTECTED_BOUNDARIES } from "./boundary-registry";
import type { ChangePackage, TargetFile } from "./change-package";

export type Classification = "NORMAL_EXTENSION_CHANGE" | "PROTECTED_MACHINE_CHANGE" | "DENY";

export interface ResolvedTarget {
  readonly declared_path: string;
  readonly real_path: string | null;
  readonly boundary: string | null;
  readonly reason: string;
}

export interface ClassifyResult {
  readonly classification: Classification;
  readonly boundaries: readonly string[];
  readonly targets: readonly ResolvedTarget[];
  readonly deny_reason: string | null;
}

/** คลี่ path ให้เป็นความจริงบนดิสก์ ถ้าไฟล์ยังไม่มีก็คลี่โฟลเดอร์แม่ที่มีอยู่จริง */
function realOf(abs: string): string | null {
  try {
    if (existsSync(abs)) return realpathSync(abs);
    let d = dirname(abs);
    const tail: string[] = [abs.slice(d.length + 1)];
    while (!existsSync(d) && d !== "/" && d.length > 1) {
      tail.unshift(d.slice(dirname(d).length + 1));
      d = dirname(d);
    }
    if (!existsSync(d)) return null;
    return `${realpathSync(d)}/${tail.join("/")}`;
  } catch {
    return null;
  }
}

function under(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

/** ไฟล์อยู่ในขอบเขตไหน — ต้องอยู่ *ชั้นเดียว* ใต้ file_root ตามที่ทะเบียนกำหนด */
function boundaryOf(realPath: string): string | null {
  for (const b of PROTECTED_BOUNDARIES) {
    for (const root of b.file_roots) {
      if (dirname(realPath) === root) return b.boundary;
    }
  }
  return null;
}

/** ไฟล์อยู่ใต้ต้นไม้ของขอบเขตใดไหม (ลึกเท่าไรก็ตาม) — ใช้จับการเลี่ยงด้วยโฟลเดอร์ย่อย */
function withinBoundaryTree(realPath: string): string | null {
  for (const b of PROTECTED_BOUNDARIES) {
    for (const root of b.file_roots) {
      if (under(realPath, root)) return b.boundary;
    }
  }
  return null;
}

export function classifyChange(pkg: ChangePackage): ClassifyResult {
  const targets: ResolvedTarget[] = [];
  const boundaries = new Set<string>();
  let deny: string | null = null;

  for (const t of pkg.target_files as readonly TargetFile[]) {
    const abs = pathResolve(REPO_ROOT, t.repo_relative_path);
    if (!under(abs, REPO_ROOT)) {
      deny ??= `path หลุดออกนอกรากรีโป: ${t.repo_relative_path}`;
      targets.push({ declared_path: t.repo_relative_path, real_path: null, boundary: null, reason: "ESCAPES_REPO_ROOT" });
      continue;
    }
    const real = realOf(abs);
    if (real === null) {
      deny ??= `คลี่ path ไม่ได้ ตัดสินไม่ได้: ${t.repo_relative_path}`;
      targets.push({ declared_path: t.repo_relative_path, real_path: null, boundary: null, reason: "UNRESOLVABLE" });
      continue;
    }
    // symlink ที่ชี้ออกนอกราก = ปฏิเสธ ไม่ว่าปลายทางจะเป็นของที่ถูกป้องกันหรือไม่
    if (!under(real, REPO_ROOT)) {
      deny ??= `symlink พาออกนอกรากรีโป: ${t.repo_relative_path} -> ${real}`;
      targets.push({ declared_path: t.repo_relative_path, real_path: real, boundary: null, reason: "SYMLINK_ESCAPE" });
      continue;
    }
    // ชื่อที่ประกาศกับความจริงหลังคลี่ไม่ตรงกัน = มี symlink คั่นกลาง ตัดสินไม่ได้
    if (real !== abs) {
      const tree = withinBoundaryTree(real);
      deny ??= `path ผ่าน symlink จึงกำกวม: ${t.repo_relative_path} -> ${real}`;
      targets.push({ declared_path: t.repo_relative_path, real_path: real, boundary: tree, reason: "SYMLINK_INDIRECTION" });
      continue;
    }
    const direct = boundaryOf(real);
    const tree = withinBoundaryTree(real);
    if (direct !== null) {
      boundaries.add(direct);
      targets.push({ declared_path: t.repo_relative_path, real_path: real, boundary: direct, reason: "IN_PROTECTED_BOUNDARY" });
    } else if (tree !== null) {
      // อยู่ใต้ต้นไม้ของขอบเขตแต่ไม่ใช่ชั้นที่ทะเบียนระบุ — ไม่เดา
      deny ??= `อยู่ใต้ขอบเขต ${tree} แต่ไม่ตรงชั้นที่ทะเบียนกำหนด: ${t.repo_relative_path}`;
      targets.push({ declared_path: t.repo_relative_path, real_path: real, boundary: tree, reason: "AMBIGUOUS_DEPTH" });
    } else {
      targets.push({ declared_path: t.repo_relative_path, real_path: real, boundary: null, reason: "OUTSIDE_PROTECTED" });
    }
  }

  if (deny !== null) {
    return { classification: "DENY", boundaries: [...boundaries], targets, deny_reason: deny };
  }
  return {
    classification: boundaries.size > 0 ? "PROTECTED_MACHINE_CHANGE" : "NORMAL_EXTENSION_CHANGE",
    boundaries: [...boundaries].sort(),
    targets,
    deny_reason: null,
  };
}
