/**
 * CASE 1–25: สัญญาของเหตุการณ์การเริ่มต้นการติดตั้ง
 *
 * ไม่มีเทสต์ใดในไฟล์นี้แตะระบบไฟล์ ไม่มีการสร้าง installation_id และไม่มีการ
 * อ่านนาฬิกาในตัวสัญญา — สามข้อนี้ถูกตรวจเป็นเคสจริง ไม่ใช่ข้อความยืนยันลอย ๆ
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildInitializationRecord, validateInitializationRecord, initializationIdOf, recordDigestOf,
  INSTALLATION_INITIALIZATION_SCHEMA, CEREMONY_VERSION_V1, CREATION_METHOD_V1,
  MACHINE_BINDING_NOT_ESTABLISHED,
} from "./installation-initialization";
import type { BuildInitializationInput, InstallationInitializationV1 } from "./installation-initialization";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}`); if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`); }
};

const ID = "installation-3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const base = (over: Partial<BuildInitializationInput> = {}): BuildInitializationInput => ({
  installation_id: ID,
  created_at: "2026-08-29T10:00:00.000Z",
  evidence_refs: ["execution/local-state-root/contract.ts#resolveLocalStateRoot"],
  ...over,
});
const built = (over: Partial<BuildInitializationInput> = {}): InstallationInitializationV1 => {
  const r = buildInitializationRecord(base(over));
  if (!r.ok) throw new Error(`สร้างไม่ได้: ${r.reason_code} ${r.detail}`);
  return r.record;
};

// ---- CASE 1/2: ระเบียนที่ใช้ได้ ---------------------------------------------
{
  const r = buildInitializationRecord(base());
  check("CASE 1  ระเบียนที่ถูกต้องถูกยอมรับ และมีช่องครบตามสัญญา",
    r.ok && r.record.schema === INSTALLATION_INITIALIZATION_SCHEMA
    && r.record.ceremony_version === CEREMONY_VERSION_V1
    && r.record.creation_method === CREATION_METHOD_V1
    && r.record.machine_binding_evidence.status === "NOT_ESTABLISHED"
    && typeof r.record.record_digest === "string" && r.record.record_digest.length === 64
    && r.record.initialization_id.startsWith("init-"), r);
  check("CASE 2  installation-<uuid> ถูกยอมรับ", r.ok && r.record.installation_id === ID);
  check("       ระเบียนที่สร้างแล้วผ่านการตรวจสอบ",
    r.ok && validateInitializationRecord(r.record).status === "VALID");
}

// ---- CASE 3: installation_id ที่ผิดรูป ----------------------------------------
{
  const bad = ["owner", "installation-", "installation-not-a-uuid", ID.toUpperCase(),
    "inst-3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b", "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b", ""];
  check("CASE 3  installation_id ที่ผิดรูปถูกปฏิเสธทุกแบบ",
    bad.every((id) => { const r = buildInitializationRecord(base({ installation_id: id })); return !r.ok && r.reason_code === "MALFORMED_INSTALLATION_ID"; }),
    bad.filter((id) => buildInitializationRecord(base({ installation_id: id })).ok));
}

// ---- CASE 4/5: initialization_id กำหนดผลได้ -----------------------------------
{
  const a = built(), b = built();
  check("CASE 4  เนื้อหาเดียวกัน -> initialization_id เดียวกัน", a.initialization_id === b.initialization_id);
  const other = built({ installation_id: "installation-00000000-0000-4000-8000-000000000000" });
  const laterTime = built({ created_at: "2026-08-29T10:00:01.000Z" });
  const moreRefs = built({ evidence_refs: [...base().evidence_refs, "runtime-control:abc#1"] });
  check("CASE 5  เปลี่ยนความหมาย -> initialization_id เปลี่ยน (id/เวลา/หลักฐาน)",
    new Set([a.initialization_id, other.initialization_id, laterTime.initialization_id, moreRefs.initialization_id]).size === 4);
  const reordered = built({ evidence_refs: [...base().evidence_refs].reverse() });
  check("       ลำดับของ evidence_refs ไม่ใช่ความหมาย -> id เดิม", a.initialization_id === reordered.initialization_id);
  const dup = built({ evidence_refs: [...base().evidence_refs, ...base().evidence_refs] });
  check("       ตัวชี้ที่ซ้ำถูกตัด -> id เดิม", a.initialization_id === dup.initialization_id);
}

// ---- CASE 6/7/8: record_digest -----------------------------------------------
{
  const a = built();
  check("CASE 6  record_digest กำหนดผลได้", a.record_digest === built().record_digest);
  const core = {
    schema: a.schema, installation_id: a.installation_id, ceremony_version: a.ceremony_version,
    created_at: a.created_at, creation_method: a.creation_method,
    machine_binding_evidence: a.machine_binding_evidence, evidence_refs: a.evidence_refs,
  };
  const swapped = {
    evidence_refs: a.evidence_refs, creation_method: a.creation_method, created_at: a.created_at,
    ceremony_version: a.ceremony_version, installation_id: a.installation_id, schema: a.schema,
    machine_binding_evidence: a.machine_binding_evidence,
  };
  check("CASE 7  ลำดับคีย์ไม่มีผลต่อ digest และต่อ initialization_id",
    recordDigestOf(core, a.initialization_id) === recordDigestOf(swapped, a.initialization_id)
    && initializationIdOf(core) === initializationIdOf(swapped));
  check("CASE 8  digest ที่ถูกแก้ -> CORRUPT",
    validateInitializationRecord({ ...a, record_digest: "0".repeat(64) }).status === "CORRUPT");
  const tampered = validateInitializationRecord({ ...a, record_digest: "0".repeat(64) });
  check("       เหตุผลคือ DIGEST_MISMATCH", tampered.status === "CORRUPT" && tampered.reason_code === "DIGEST_MISMATCH", tampered);
  const idTampered = validateInitializationRecord({ ...a, initialization_id: "init-" + "0".repeat(32) });
  check("       initialization_id ที่ถูกแก้ -> INCONSISTENT_INITIALIZATION_ID",
    idTampered.status === "CORRUPT" && idTampered.reason_code === "INCONSISTENT_INITIALIZATION_ID", idTampered);
}

// ---- CASE 9/10/11: เวลา -------------------------------------------------------
{
  check("CASE 9  เวลาแบบ ISO-8601 UTC พร้อมมิลลิวินาที ถูกยอมรับ", buildInitializationRecord(base()).ok);
  const bad = ["2026-08-29T10:00:00Z", "2026-08-29 10:00:00.000Z", "2026-08-29T10:00:00.000+07:00",
    "2026-13-45T99:99:99.999Z", "เมื่อวาน", "", "1787000000000"];
  check("CASE 10 เวลาที่ไม่ใช่รูปแบบเดียวที่กำหนด ถูกปฏิเสธทุกแบบ",
    bad.every((t) => { const r = buildInitializationRecord(base({ created_at: t })); return !r.ok && r.reason_code === "INVALID_TIMESTAMP"; }),
    bad.filter((t) => buildInitializationRecord(base({ created_at: t })).ok));

  const src = readFileSync(join(__dirname, "installation-initialization.ts"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("CASE 11 สัญญาไม่อ่านนาฬิกาและไม่สุ่มตัวตนเอง",
    !/Date\.now\s*\(|new Date\s*\(\s*\)|randomUUID\s*\(/.test(src),
    src.match(/Date\.now\s*\(|new Date\s*\(\s*\)|randomUUID\s*\(/g));
}

// ---- CASE 12–15: รุ่นพิธี และวิธีการสร้าง ------------------------------------------
{
  check("CASE 12 ceremony_version ที่ถูกต้องถูกยอมรับ", buildInitializationRecord(base({ ceremony_version: CEREMONY_VERSION_V1 })).ok);
  const badCeremony = ["v1", "1.0.0", "installation-ceremony-v2", "", "0.1.0"];
  check("CASE 13 ceremony_version ที่ผิดถูกปฏิเสธ (รวมเวอร์ชันของแพ็กเกจ)",
    badCeremony.every((v) => { const r = buildInitializationRecord(base({ ceremony_version: v as never })); return !r.ok && r.reason_code === "UNKNOWN_CEREMONY_VERSION"; }));
  check("CASE 14 รับเฉพาะวิธีการสร้างของ V1", buildInitializationRecord(base({ creation_method: CREATION_METHOD_V1 })).ok);
  const badMethod = ["CLONE", "IMPORT", "MIGRATION", "RECOVERY", "AUTOMATIC", ""];
  check("CASE 15 วิธีการสร้างที่ไม่รู้จักถูกปฏิเสธ",
    badMethod.every((m) => { const r = buildInitializationRecord(base({ creation_method: m as never })); return !r.ok && r.reason_code === "UNKNOWN_CREATION_METHOD"; }));
}

// ---- CASE 16–18: การผูกเครื่อง --------------------------------------------------
{
  const a = built();
  const text = JSON.stringify(a);
  check("CASE 16 การผูกเครื่องไม่อ้างตัวตนของฮาร์ดแวร์ใด ๆ",
    a.machine_binding_evidence.status === "NOT_ESTABLISHED"
    && !/hostname|hardware|mac_address|platform_uuid|serial|keychain|repository_path/i.test(text), text);
  check("CASE 17 รองรับสถานะ NOT_ESTABLISHED",
    buildInitializationRecord(base({ machine_binding_evidence: MACHINE_BINDING_NOT_ESTABLISHED })).ok);
  const bad = [{ status: "ESTABLISHED" }, { status: "" }, { hostname: "mac.local" }, null, "NOT_ESTABLISHED", 1];
  check("CASE 18 การผูกเครื่องที่ผิดรูปถูกปฏิเสธ",
    bad.every((b) => { const r = buildInitializationRecord(base({ machine_binding_evidence: b as never })); return !r.ok && r.reason_code === "MALFORMED_MACHINE_BINDING"; }),
    bad.filter((b) => buildInitializationRecord(base({ machine_binding_evidence: b as never })).ok));
}

// ---- CASE 19/20: ตัวชี้หลักฐาน ---------------------------------------------------
{
  check("CASE 19 ตัวชี้ที่มีชนิดถูกยอมรับ",
    buildInitializationRecord(base({ evidence_refs: ["a/b.ts#sym", "runtime-control:abc-123"] })).ok);
  const badRefs = [["ทำพิธีแล้วเมื่อวาน"], ["plain-text"], ["has space#sym"], [""], [123 as never]];
  check("CASE 19 ตัวชี้ที่เป็นข้อความบรรยายถูกปฏิเสธ",
    badRefs.every((refs) => { const r = buildInitializationRecord(base({ evidence_refs: refs as never })); return !r.ok && r.reason_code === "MALFORMED_EVIDENCE_REFS"; }),
    badRefs.filter((refs) => buildInitializationRecord(base({ evidence_refs: refs as never })).ok));
  const empty = buildInitializationRecord(base({ evidence_refs: [] }));
  check("CASE 20 ไม่มีตัวชี้หลักฐานเลย -> INSUFFICIENT_EVIDENCE",
    !empty.ok && empty.reason_code === "INSUFFICIENT_EVIDENCE", empty);
}

// ---- CASE 21/22: ความไม่เปลี่ยนแปลง ---------------------------------------------
{
  const refs = ["a/b.ts#one"];
  const binding = { status: "NOT_ESTABLISHED" as const };
  const r = buildInitializationRecord(base({ evidence_refs: refs, machine_binding_evidence: binding }));
  if (!r.ok) throw new Error("ควรสร้างได้");
  const rec = r.record;
  const digestBefore = rec.record_digest;

  check("CASE 21 ระเบียนถูก freeze ลึกถึง evidence_refs และ machine_binding_evidence",
    Object.isFrozen(rec) && Object.isFrozen(rec.evidence_refs) && Object.isFrozen(rec.machine_binding_evidence));

  refs.push("c/d.ts#two");
  (binding as { status: string }).status = "ESTABLISHED";
  let mutationThrew = false;
  try { (rec.evidence_refs as string[]).push("e/f.ts#three"); } catch { mutationThrew = true; }
  try { (rec as { record_digest: string }).record_digest = "แก้แล้ว"; } catch { mutationThrew = true; }

  check("CASE 22 ผู้เรียกแก้อาเรย์/อ็อบเจกต์ของตัวเองแล้ว ระเบียนไม่เปลี่ยนตาม",
    rec.evidence_refs.length === 1 && rec.evidence_refs[0] === "a/b.ts#one"
    && rec.machine_binding_evidence.status === "NOT_ESTABLISHED"
    && rec.record_digest === digestBefore
    && validateInitializationRecord(rec).status === "VALID",
    { refs: rec.evidence_refs, binding: rec.machine_binding_evidence, mutationThrew });
}

// ---- CASE 23–25: ไม่มีผลข้างเคียง -------------------------------------------------
{
  const STATE_ROOT = join(process.env.HOME ?? "", "Library", "Application Support", "DNA OS");
  const dirBefore = readdirSync(__dirname).length;
  built(); built({ created_at: "2026-08-29T11:00:00.000Z" });
  check("CASE 23 ไม่มีไฟล์/ไดเรกทอรีใดถูกสร้าง",
    readdirSync(__dirname).length === dirBefore && !existsSync(STATE_ROOT), { dirBefore, after: readdirSync(__dirname).length });

  const src = readFileSync(join(__dirname, "installation-initialization.ts"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("CASE 24 สัญญาไม่สร้าง installation_id และไม่ import node:fs",
    !/randomUUID|from "node:fs"|require\("node:fs"\)/.test(src), src.match(/randomUUID|node:fs/g));
  check("CASE 25 สัญญาไม่แตะทะเบียนและไม่แตะระบบไฟล์เลย",
    !/registry|writeFileSync|appendFileSync|mkdirSync|openSync|chmodSync/i.test(src),
    src.match(/registry|writeFileSync|appendFileSync|mkdirSync|openSync|chmodSync/gi));
}

// ---- schema ที่ไม่รู้จัก -------------------------------------------------------
{
  const a = built();
  check("       schema ที่ไม่รู้จัก -> CORRUPT",
    validateInitializationRecord({ ...a, schema: "dna-os.installation-initialization.v2" }).status === "CORRUPT");
  check("       ค่าที่ไม่ใช่อ็อบเจกต์ -> CORRUPT",
    [null, "x", 1, []].every((v) => validateInitializationRecord(v).status === "CORRUPT"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
