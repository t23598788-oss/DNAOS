/**
 * การตรึงคำขอเลื่อนขั้น
 *
 * สิ่งที่ Owner อนุมัติคือ "manifest hash" ไม่ใช่ "คำขอ" ลอย ๆ
 * ถ้าห่อ เป้าหมาย baseline หรือแฮชของเนื้อหาใหม่เปลี่ยนไปแม้ไบต์เดียว
 * hash จะไม่ตรงและการอนุมัติเดิมใช้ไม่ได้อีก
 *
 * manifest ผูกกับ change_id หนึ่งใบต่อการอนุมัติหนึ่งครั้ง — นำอนุมัติเก่า
 * มาใช้กับห่อใหม่ไม่ได้ และใช้ manifest เดิมซ้ำสองรอบไม่ได้
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { REPO_ROOT } from "./boundary-registry";
import type { ChangePackage } from "./change-package";
import { classifyChange } from "./classify";

export interface FrozenManifest {
  readonly change_id: string;
  readonly classification: string;
  readonly boundaries: readonly string[];
  readonly baseline_commit: string;
  readonly entries: readonly {
    readonly path: string;
    readonly operation: string;
    readonly old_sha256: string | null;
    readonly new_sha256: string;
  }[];
  readonly manifest_sha256: string;
}

export type FreezeResult =
  | { readonly ok: true; readonly manifest: FrozenManifest }
  | { readonly ok: false; readonly reason_code: string; readonly detail: string };

function sha256File(abs: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(abs)).digest("hex");
  } catch {
    return null;
  }
}

/** ตรึงคำขอ — ตรวจ baseline จริงบนดิสก์และเนื้อหาที่เสนอ ก่อนคำนวณ hash */
export function freezePromotion(pkg: ChangePackage): FreezeResult {
  const cls = classifyChange(pkg);
  if (cls.classification === "DENY") {
    return { ok: false, reason_code: "CLASSIFICATION_DENY", detail: cls.deny_reason ?? "ไม่ระบุ" };
  }

  const entries: FrozenManifest["entries"][number][] = [];
  for (const t of pkg.target_files) {
    const abs = pathResolve(REPO_ROOT, t.repo_relative_path);

    if (t.operation === "REPLACE_FILE") {
      if (!existsSync(abs)) return { ok: false, reason_code: "TARGET_MISSING", detail: t.repo_relative_path };
      const actual = sha256File(abs);
      if (actual === null) return { ok: false, reason_code: "TARGET_UNREADABLE", detail: t.repo_relative_path };
      if (actual !== t.expected_old_sha256) {
        return { ok: false, reason_code: "BASELINE_MISMATCH", detail: `${t.repo_relative_path}: บนดิสก์ ${actual.slice(0, 12)} ≠ ที่อ้าง ${String(t.expected_old_sha256).slice(0, 12)}` };
      }
    } else if (existsSync(abs)) {
      return { ok: false, reason_code: "ADD_TARGET_EXISTS", detail: t.repo_relative_path };
    }

    const payload = sha256File(t.payload_path);
    if (payload === null) return { ok: false, reason_code: "PAYLOAD_UNREADABLE", detail: t.payload_path };
    if (payload !== t.proposed_new_sha256) {
      return { ok: false, reason_code: "PAYLOAD_MISMATCH", detail: `${t.payload_path}: จริง ${payload.slice(0, 12)} ≠ ที่อ้าง ${t.proposed_new_sha256.slice(0, 12)}` };
    }

    entries.push({
      path: t.repo_relative_path, operation: t.operation,
      old_sha256: t.expected_old_sha256, new_sha256: t.proposed_new_sha256,
    });
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const body = JSON.stringify({
    change_id: pkg.change_id,
    classification: cls.classification,
    boundaries: [...cls.boundaries].sort(),
    baseline_commit: pkg.baseline_commit,
    entries,
  });
  const manifest_sha256 = createHash("sha256").update(body).digest("hex");

  return {
    ok: true,
    manifest: {
      change_id: pkg.change_id, classification: cls.classification,
      boundaries: [...cls.boundaries].sort(), baseline_commit: pkg.baseline_commit,
      entries, manifest_sha256,
    },
  };
}

/**
 * ตรวจว่าการอนุมัติที่ถืออยู่ ยังใช้กับสภาพปัจจุบันได้ไหม
 * เรียกซ้ำก่อนลงมือจริงเสมอ — ระหว่างที่ Owner กำลังตัดสินใจ ห่ออาจถูกแก้
 */
export function reverifyFrozen(pkg: ChangePackage, approved_manifest_sha256: string): FreezeResult {
  const again = freezePromotion(pkg);
  if (!again.ok) return again;
  if (again.manifest.manifest_sha256 !== approved_manifest_sha256) {
    return { ok: false, reason_code: "AUTHORIZATION_INVALID", detail: "ห่อเปลี่ยนไปหลังการอนุมัติ — การอนุมัติเดิมใช้ไม่ได้" };
  }
  return again;
}
