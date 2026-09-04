/**
 * ทดสอบเชิงศัตรูกับชั้นที่ไม่ต้องใช้สิทธิ์: สัญญาห่อ · ตัวจำแนก · การตรึง
 * ทุกเคสรันจริง ไม่มี mock ของระบบไฟล์ — ใช้ไฟล์จริงในโลกพัฒนา
 */
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateSchema } from "../change-package";
import { classifyChange } from "../classify";
import { freezePromotion, reverifyFrozen } from "../freeze";
import { REPO_ROOT } from "../boundary-registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const work = mkdtempSync(join(tmpdir(), "promo-"));

const HEAD = "5f2c693d448627184bc00e4670a2850af3c10e48";
const base = (over: Record<string, unknown> = {}) => ({
  change_id: "chg-test-0001", created_at: new Date().toISOString(),
  producer_identity: "claude:test", baseline_commit: HEAD,
  target_files: [], test_evidence: [], verification_plan: [], ...over,
});
const tf = (over: Record<string, unknown> = {}) => ({
  repo_relative_path: "permissions/write-gate/policy.ts", operation: "REPLACE_FILE",
  expected_old_sha256: sha("x"), proposed_new_sha256: sha("y"), payload_path: `${work}/p`, ...over,
});

console.log("\n── สัญญาห่อ: ฟิลด์ที่ผู้เสนอไม่มีสิทธิ์กำหนด");
for (const f of ["command", "shell", "chmod", "sudo", "is_protected", "boundary", "skip_verification", "unlock_seconds"]) {
  const r = validateSchema(base({ [f]: "อะไรก็ตาม", target_files: [tf()] }));
  ok(`ปฏิเสธฟิลด์ ${f}`, !r.ok && r.reason_code === "FORBIDDEN_FIELD");
}

console.log("\n── สัญญาห่อ: รูปแบบ path");
ok("ปฏิเสธ path สัมบูรณ์", (() => { const r = validateSchema(base({ target_files: [tf({ repo_relative_path: "/etc/passwd" })] })); return !r.ok && r.reason_code === "ABSOLUTE_PATH_REJECTED"; })());
ok("ปฏิเสธ ../ traversal", (() => { const r = validateSchema(base({ target_files: [tf({ repo_relative_path: "../../etc/passwd" })] })); return !r.ok && r.reason_code === "PATH_TRAVERSAL_REJECTED"; })());
ok("ปฏิเสธ traversal กลางทาง", (() => { const r = validateSchema(base({ target_files: [tf({ repo_relative_path: "permissions/../../etc/x" })] })); return !r.ok && r.reason_code === "PATH_TRAVERSAL_REJECTED"; })());
ok("ปฏิเสธไฟล์ซ้ำ", (() => { const r = validateSchema(base({ target_files: [tf(), tf()] })); return !r.ok && r.reason_code === "DUPLICATE_TARGET"; })());
ok("ปฏิเสธ operation แปลกปลอม", (() => { const r = validateSchema(base({ target_files: [tf({ operation: "DELETE_FILE" })] })); return !r.ok && r.reason_code === "BAD_OPERATION"; })());
ok("ปฏิเสธ baseline ที่ไม่ใช่ commit", (() => { const r = validateSchema(base({ baseline_commit: "HEAD", target_files: [tf()] })); return !r.ok && r.reason_code === "BAD_BASELINE_COMMIT"; })());
ok("รับห่อที่ถูกต้อง", validateSchema(base({ target_files: [tf()] })).ok);

console.log("\n── ตัวจำแนก: เครื่องตัดสินเอง ไม่เชื่อผู้เสนอ");
const okPkg = validateSchema(base({ target_files: [tf()] }));
ok("write-gate ถูกจัดเป็นของที่ถูกป้องกัน", okPkg.ok && classifyChange(okPkg.package).classification === "PROTECTED_MACHINE_CHANGE");
ok("ระบุขอบเขตได้ถูกตัว", okPkg.ok && classifyChange(okPkg.package).boundaries[0] === "write-gate");
const normal = validateSchema(base({ target_files: [tf({ repo_relative_path: "connections/n8n/contract.ts", expected_old_sha256: sha("a") })] }));
ok("ไฟล์นอกขอบเขต = งานพัฒนาปกติ", normal.ok && classifyChange(normal.package).classification === "NORMAL_EXTENSION_CHANGE");
const selfp = validateSchema(base({ target_files: [tf({ repo_relative_path: "governance/source-promotion/classify.ts" })] }));
ok("ตัวจำแนกป้องกันตัวเอง", selfp.ok && classifyChange(selfp.package).classification === "PROTECTED_MACHINE_CHANGE");
const deeper = validateSchema(base({ target_files: [tf({ repo_relative_path: "permissions/write-gate/tests/nested/deep.ts" })] }));
ok("ความลึกที่ทะเบียนไม่ได้ระบุ = DENY ไม่เดา", deeper.ok && classifyChange(deeper.package).classification === "DENY");

console.log("\n── ตัวจำแนก: symlink");
const linkDir = join(REPO_ROOT, "governance/source-promotion/tests/__linkprobe__");
try { rmSync(linkDir, { recursive: true, force: true }); } catch { /* ไม่มีก็ข้าม */ }
mkdirSync(linkDir, { recursive: true });
symlinkSync("/etc/passwd", join(linkDir, "escape.ts"));
symlinkSync(join(REPO_ROOT, "permissions/write-gate/policy.ts"), join(linkDir, "into-protected.ts"));
const esc = validateSchema(base({ target_files: [tf({ repo_relative_path: "governance/source-promotion/tests/__linkprobe__/escape.ts" })] }));
ok("symlink ออกนอกราก = DENY", esc.ok && classifyChange(esc.package).classification === "DENY");
const into = validateSchema(base({ target_files: [tf({ repo_relative_path: "governance/source-promotion/tests/__linkprobe__/into-protected.ts" })] }));
ok("symlink เข้าไปในของที่ถูกป้องกัน = DENY", into.ok && classifyChange(into.package).classification === "DENY");

console.log("\n── การตรึง: baseline และเนื้อหา");
const realTarget = "permissions/write-gate/policy.ts";
const realOld = sha(readFileSync(join(REPO_ROOT, realTarget)));
const payload = join(work, "new-policy.ts");
writeFileSync(payload, "// เนื้อหาที่เสนอ\n");
const realNew = sha(readFileSync(payload));
const good = validateSchema(base({ target_files: [tf({ repo_relative_path: realTarget, expected_old_sha256: realOld, proposed_new_sha256: realNew, payload_path: payload })] }));
const frozen = good.ok ? freezePromotion(good.package) : { ok: false as const, reason_code: "SCHEMA", detail: "" };
ok("ตรึงสำเร็จเมื่อ baseline และเนื้อหาตรง", frozen.ok);
const manifestHash = frozen.ok ? frozen.manifest.manifest_sha256 : "";
ok("ได้ manifest hash", /^[0-9a-f]{64}$/.test(manifestHash));

const wrongBase = validateSchema(base({ target_files: [tf({ repo_relative_path: realTarget, expected_old_sha256: sha("ไม่ใช่ของจริง"), proposed_new_sha256: realNew, payload_path: payload })] }));
ok("baseline ไม่ตรง = ปฏิเสธ", wrongBase.ok && !freezePromotion(wrongBase.package).ok);
const wrongPayload = validateSchema(base({ target_files: [tf({ repo_relative_path: realTarget, expected_old_sha256: realOld, proposed_new_sha256: sha("โกหก"), payload_path: payload })] }));
ok("แฮชเนื้อหาไม่ตรงของจริง = ปฏิเสธ", wrongPayload.ok && !freezePromotion(wrongPayload.package).ok);

console.log("\n── การตรึง: แก้ห่อหลังอนุมัติ และใช้อนุมัติซ้ำ");
ok("ยังใช้ได้ถ้าไม่มีอะไรเปลี่ยน", good.ok && reverifyFrozen(good.package, manifestHash).ok);
writeFileSync(payload, "// เนื้อหาที่ถูกสับเปลี่ยนหลังอนุมัติ\n");
const after = good.ok ? reverifyFrozen(good.package, manifestHash) : { ok: false as const, reason_code: "", detail: "" };
ok("สับเปลี่ยนเนื้อหาหลังอนุมัติ = ปฏิเสธ", !after.ok);
writeFileSync(payload, "// เนื้อหาที่เสนอ\n");
const other = validateSchema(base({ change_id: "chg-test-0002", target_files: [tf({ repo_relative_path: realTarget, expected_old_sha256: realOld, proposed_new_sha256: realNew, payload_path: payload })] }));
const otherFrozen = other.ok ? freezePromotion(other.package) : { ok: false as const };
ok("เปลี่ยน change_id ได้ manifest คนละอัน", otherFrozen.ok && otherFrozen.manifest.manifest_sha256 !== manifestHash);
ok("เอาอนุมัติของใบเก่ามาใช้กับใบใหม่ = ปฏิเสธ", other.ok && !reverifyFrozen(other.package, manifestHash).ok);

rmSync(linkDir, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });
console.log(`\n  ผลรวม: PASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
