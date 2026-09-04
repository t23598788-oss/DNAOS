/**
 * สัญญาของ "ห่อการเปลี่ยนแปลง" ที่ผู้เสนอส่งเข้ามา
 *
 * ห่อนี้บรรยาย *ผลลัพธ์ที่ต้องการ* เท่านั้น — ไฟล์ไหน เนื้อหาใหม่แฮชอะไร
 * มันบรรยาย *วิธีทำ* ไม่ได้ ไม่มีช่องให้ใส่คำสั่ง shell ไม่มีช่องให้ใส่ path
 * แบบสัมบูรณ์ ไม่มีช่องให้ขอเปลี่ยนเจ้าของหรือ flag และไม่มีช่องให้ผู้เสนอ
 * ประกาศขอบเขตสิทธิ์ของตัวเอง — เครื่องเป็นคนตัดสินทั้งหมดนั้นเอง
 */

/** ปฏิบัติการที่ฝั่งสิทธิ์สูงรู้จัก มีเท่านี้ ไม่มีการเพิ่มจากภายนอก */
export type OperationType = "REPLACE_FILE" | "ADD_FILE";

export interface TargetFile {
  /** path สัมพัทธ์จากรากรีโปเท่านั้น — ห้ามขึ้นต้นด้วย / และห้ามมี .. */
  readonly repo_relative_path: string;
  readonly operation: OperationType;
  /** sha256 ของเนื้อหาเดิม — null ได้เฉพาะ ADD_FILE */
  readonly expected_old_sha256: string | null;
  readonly proposed_new_sha256: string;
  /** ที่เก็บเนื้อหาใหม่ อยู่ในโลกพัฒนาเท่านั้น */
  readonly payload_path: string;
}

export interface ChangePackage {
  readonly change_id: string;
  readonly created_at: string;
  readonly producer_identity: string;
  readonly baseline_commit: string;
  readonly target_files: readonly TargetFile[];
  readonly test_evidence: readonly string[];
  readonly verification_plan: readonly string[];
}

export type SchemaVerdict =
  | { readonly ok: true; readonly package: ChangePackage }
  | { readonly ok: false; readonly reason_code: string; readonly detail: string };

const SHA256 = /^[0-9a-f]{64}$/;
const CHANGE_ID = /^[A-Za-z0-9_-]{6,64}$/;

/** ฟิลด์ที่ถ้าโผล่มาในห่อ = ปฏิเสธทันที ไม่ใช่เพิกเฉย */
export const FORBIDDEN_FIELDS: readonly string[] = [
  "command", "shell", "exec", "run", "script", "argv",
  "chmod", "chown", "chflags", "sudo", "root",
  "absolute_path", "unlock_seconds", "authorization_scope",
  "is_protected", "boundary", "skip_verification",
];

export function validateSchema(raw: unknown): SchemaVerdict {
  const deny = (c: string, d: string): SchemaVerdict => ({ ok: false, reason_code: c, detail: d });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return deny("NOT_AN_OBJECT", typeof raw);
  const o = raw as Record<string, unknown>;

  for (const f of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(o, f)) {
      return deny("FORBIDDEN_FIELD", `ห่อมีฟิลด์ที่ผู้เสนอไม่มีสิทธิ์กำหนด: ${f}`);
    }
  }
  if (typeof o.change_id !== "string" || !CHANGE_ID.test(o.change_id)) return deny("BAD_CHANGE_ID", String(o.change_id));
  if (typeof o.created_at !== "string" || Number.isNaN(Date.parse(o.created_at))) return deny("BAD_CREATED_AT", String(o.created_at));
  if (typeof o.producer_identity !== "string" || o.producer_identity.length === 0) return deny("BAD_PRODUCER", "ต้องระบุผู้เสนอ");
  if (typeof o.baseline_commit !== "string" || !/^[0-9a-f]{40}$/.test(o.baseline_commit)) return deny("BAD_BASELINE_COMMIT", String(o.baseline_commit));
  if (!Array.isArray(o.target_files) || o.target_files.length === 0) return deny("NO_TARGET_FILES", "ต้องมีอย่างน้อยหนึ่งไฟล์");
  if (!Array.isArray(o.test_evidence)) return deny("BAD_TEST_EVIDENCE", "ต้องเป็นรายการ");
  if (!Array.isArray(o.verification_plan)) return deny("BAD_VERIFICATION_PLAN", "ต้องเป็นรายการ");

  const files: TargetFile[] = [];
  for (const t of o.target_files as unknown[]) {
    if (typeof t !== "object" || t === null) return deny("BAD_TARGET", "รายการไฟล์ต้องเป็น object");
    const f = t as Record<string, unknown>;
    const p = f.repo_relative_path;
    if (typeof p !== "string" || p.length === 0) return deny("BAD_PATH", "ต้องมี repo_relative_path");
    if (p.startsWith("/")) return deny("ABSOLUTE_PATH_REJECTED", p);
    if (p.split("/").includes("..")) return deny("PATH_TRAVERSAL_REJECTED", p);
    if (p.includes("\0")) return deny("NUL_IN_PATH", "path มีอักขระ NUL");
    const op = f.operation;
    if (op !== "REPLACE_FILE" && op !== "ADD_FILE") return deny("BAD_OPERATION", String(op));
    const oldH = f.expected_old_sha256;
    if (op === "REPLACE_FILE" && (typeof oldH !== "string" || !SHA256.test(oldH))) return deny("BAD_OLD_HASH", String(oldH));
    if (op === "ADD_FILE" && oldH !== null) return deny("ADD_MUST_HAVE_NULL_OLD_HASH", String(oldH));
    if (typeof f.proposed_new_sha256 !== "string" || !SHA256.test(f.proposed_new_sha256)) return deny("BAD_NEW_HASH", String(f.proposed_new_sha256));
    if (typeof f.payload_path !== "string" || f.payload_path.length === 0) return deny("BAD_PAYLOAD_PATH", String(f.payload_path));
    files.push({
      repo_relative_path: p, operation: op,
      expected_old_sha256: (oldH as string | null) ?? null,
      proposed_new_sha256: f.proposed_new_sha256 as string,
      payload_path: f.payload_path as string,
    });
  }
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.repo_relative_path)) return deny("DUPLICATE_TARGET", f.repo_relative_path);
    seen.add(f.repo_relative_path);
  }
  return {
    ok: true,
    package: {
      change_id: o.change_id, created_at: o.created_at, producer_identity: o.producer_identity,
      baseline_commit: o.baseline_commit, target_files: files,
      test_evidence: o.test_evidence as string[], verification_plan: o.verification_plan as string[],
    },
  };
}
