/**
 * CASE 1–15: การ resolve ที่เก็บสถานะเฉพาะการติดตั้ง
 *
 * เทสต์นี้ไม่สร้างไดเรกทอรีหรือไฟล์ใดในตำแหน่งจริง และตรวจยืนยันข้อนั้นเอง
 * แซนด์บ็อกซ์ที่สร้างขึ้นมีไว้เพื่อ **ทดสอบการปฏิเสธ symlink** เท่านั้น และ
 * อยู่นอกรีโปทั้งหมด
 */
import { mkdtempSync, existsSync, symlinkSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  resolveLocalStateRoot, installationDirectoryOf, initializationFileOf,
  DNA_OS_STATE_ROOT_ENV, STATE_DIRECTORY_MODE, STATE_FILE_MODE,
} from "../contract";
import type { ResolvedLocalStateRootV1 } from "../contract";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}`); if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`); }
};

const REPO = resolve(__dirname, "..", "..", "..");
const savedHome = process.env.HOME;
const savedOverride = process.env[DNA_OS_STATE_ROOT_ENV];
const clearOverride = (): void => { delete process.env[DNA_OS_STATE_ROOT_ENV]; };
clearOverride();

// ---- CASE 1: ค่าเริ่มต้นบน macOS ------------------------------------------
{
  const r = resolveLocalStateRoot();
  const expected = join(process.env.HOME ?? homedir(), "Library", "Application Support", "DNA OS");
  check("CASE 1  macOS -> ~/Library/Application Support/DNA OS/",
    r.status === "RESOLVED" && r.state_root === expected && r.origin === "PLATFORM_DEFAULT",
    { status: r.status, got: r.status === "RESOLVED" ? r.state_root : r, expected });
  check("       ไม่มี /Users/tam/ ฝังอยู่ในซอร์ส",
    !/\/Users\/tam\//.test(require("node:fs").readFileSync(join(__dirname, "..", "resolver.ts"), "utf-8")));
}

// ---- CASE 2: HOME ถูกอ่านตอนเรียก ------------------------------------------
{
  const fakeHome = mkdtempSync(join(tmpdir(), "dna-home-a-"));
  process.env.HOME = fakeHome;
  const a = resolveLocalStateRoot();
  const fakeHome2 = mkdtempSync(join(tmpdir(), "dna-home-b-"));
  process.env.HOME = fakeHome2;
  const b = resolveLocalStateRoot();
  process.env.HOME = savedHome;
  // mkdtemp คืน /var/... แต่ resolver คืน realpath คือ /private/var/... — เทียบที่ realpath
  const realA = require("node:fs").realpathSync(fakeHome);
  const realB = require("node:fs").realpathSync(fakeHome2);
  check("CASE 2  HOME ถูกอ่านตอนเรียก ไม่ใช่ตอน import (เปลี่ยนกลางโปรเซสได้)",
    a.status === "RESOLVED" && b.status === "RESOLVED" && a.state_root !== b.state_root
    && a.state_root.startsWith(realA) && b.state_root.startsWith(realB),
    { a: a.status === "RESOLVED" ? a.state_root : a, b: b.status === "RESOLVED" ? b.state_root : b });
}

// ---- CASE 3: override ที่ตั้งอย่างชัดแจ้ง -------------------------------------
const EXTERNAL = mkdtempSync(join(tmpdir(), "dna-state-"));
{
  process.env[DNA_OS_STATE_ROOT_ENV] = EXTERNAL;
  const r = resolveLocalStateRoot();
  check("CASE 3  override resolve ถูกต้อง และถูกทำเครื่องหมายว่ามาจากการตั้งค่า",
    r.status === "RESOLVED" && r.state_root === require("node:fs").realpathSync(EXTERNAL)
    && r.origin === "EXPLICIT_OVERRIDE", r);
}

// ---- CASE 4/5/6: กันรีโป ------------------------------------------------------
{
  process.env[DNA_OS_STATE_ROOT_ENV] = REPO;
  const atRoot = resolveLocalStateRoot();
  check("CASE 4  รากของรีโปเป็น state root -> INELIGIBLE",
    atRoot.status === "INELIGIBLE" && atRoot.reason_code === "INSIDE_SOURCE_ROOT", atRoot);

  process.env[DNA_OS_STATE_ROOT_ENV] = join(REPO, "control", "runtime-control", "data");
  const desc = resolveLocalStateRoot();
  check("CASE 5  ลูกหลานของรีโป -> INELIGIBLE",
    desc.status === "INELIGIBLE" && desc.reason_code === "INSIDE_SOURCE_ROOT", desc);

  process.env[DNA_OS_STATE_ROOT_ENV] = join(REPO, "control", "..", "software", "..", "execution");
  const traversal = resolveLocalStateRoot();
  check("CASE 6  path ที่มี ../ แล้ววนกลับเข้ารีโป -> INELIGIBLE",
    traversal.status === "INELIGIBLE" && traversal.reason_code === "INSIDE_SOURCE_ROOT", traversal);
}

// ---- CASE 7: symlink ที่ชี้กลับเข้ารีโป ---------------------------------------
{
  const linkDir = mkdtempSync(join(tmpdir(), "dna-link-"));
  const link = join(linkDir, "looks-external");
  symlinkSync(join(REPO, "control"), link);
  process.env[DNA_OS_STATE_ROOT_ENV] = link;
  const viaLink = resolveLocalStateRoot();
  check("CASE 7  symlink ที่ดูเหมือนอยู่นอกรีโปแต่ชี้กลับเข้ารีโป -> INELIGIBLE",
    viaLink.status === "INELIGIBLE" && viaLink.reason_code === "INSIDE_SOURCE_ROOT", viaLink);

  // symlink ที่ปลายทางยังไม่ถูกสร้าง ก็ต้องถูกจับได้เช่นกัน
  const deep = join(link, "installation", "ยังไม่มี");
  process.env[DNA_OS_STATE_ROOT_ENV] = deep;
  const viaLinkDeep = resolveLocalStateRoot();
  check("CASE 7  symlink + ส่วนปลายที่ยังไม่มีอยู่ ก็ยังถูกจับได้",
    viaLinkDeep.status === "INELIGIBLE" && viaLinkDeep.reason_code === "INSIDE_SOURCE_ROOT", viaLinkDeep);
}

// ---- CASE 8: root ภายนอก ------------------------------------------------------
{
  process.env[DNA_OS_STATE_ROOT_ENV] = EXTERNAL;
  const r = resolveLocalStateRoot();
  check("CASE 8  root ชั่วคราวนอกรีโป -> RESOLVED", r.status === "RESOLVED", r);
}

// ---- CASE 9/10: ไม่มีผลข้างเคียง ------------------------------------------------
{
  const target = join(EXTERNAL, "nothing-should-appear-here");
  process.env[DNA_OS_STATE_ROOT_ENV] = target;
  const before = readdirSync(EXTERNAL).length;
  const r = resolveLocalStateRoot();
  const paths = r.status === "RESOLVED" ? [installationDirectoryOf(r), initializationFileOf(r)] : [];
  const after = readdirSync(EXTERNAL).length;
  check("CASE 9  resolve ไม่สร้างไดเรกทอรีใด", before === after && !existsSync(target), { before, after });
  check("CASE 10 resolve ไม่สร้างไฟล์ใด และ path ที่คืนยังไม่มีอยู่จริง",
    paths.length === 2 && paths.every((p) => !existsSync(p)), paths);

  // ค่าเริ่มต้นของแพลตฟอร์มก็ต้องไม่ถูกสร้างขึ้นมาเช่นกัน
  //
  // เดิมข้อนี้ยืนยันว่า `~/Library/Application Support/DNA OS` ต้องไม่มีอยู่เลย
  // ซึ่งเป็นการยืนยันว่า "เครื่องนี้ยังไม่เคยประกาศตัวตน" ไม่ใช่การยืนยันว่า
  // ตัวแก้ path ไม่มีผลข้างเคียง Owner สั่งสร้างตัวตนของเครื่องใน TASK
  // CLOSE_MACHINE_IDENTITY_AND_RECOVERY_FOUNDATION (2026-08-30) โฟลเดอร์จึงมีอยู่
  // โดยชอบ ข้อนี้จึงวัดสิ่งที่มันตั้งใจวัดจริง ๆ: เรียกแล้วสถานะของดิสก์ต้องไม่ขยับ
  clearOverride();
  const realHomeRoot = join(process.env.HOME ?? homedir(), "Library", "Application Support", "DNA OS");
  const existedBefore = existsSync(realHomeRoot);
  const entriesBefore = existedBefore ? readdirSync(realHomeRoot).length : -1;
  resolveLocalStateRoot();
  const entriesAfter = existsSync(realHomeRoot) ? readdirSync(realHomeRoot).length : -1;
  check("CASE 9  การ resolve ค่าเริ่มต้นไม่สร้างและไม่แก้ ~/Library/Application Support/DNA OS",
    existsSync(realHomeRoot) === existedBefore && entriesBefore === entriesAfter,
    { existedBefore, entriesBefore, entriesAfter });
}

// ---- CASE 11/12/13: ตัวชี้ตำแหน่งกำหนดผลได้ -------------------------------------
{
  process.env[DNA_OS_STATE_ROOT_ENV] = EXTERNAL;
  const r = resolveLocalStateRoot() as ResolvedLocalStateRootV1;
  check("CASE 11 path ของไดเรกทอรี installation กำหนดผลได้",
    installationDirectoryOf(r) === join(r.state_root, "installation")
    && installationDirectoryOf(r) === installationDirectoryOf(r), installationDirectoryOf(r));
  check("CASE 12 path ของ initialization.json กำหนดผลได้",
    initializationFileOf(r) === join(r.state_root, "installation", "initialization.json"), initializationFileOf(r));
  const again = resolveLocalStateRoot();
  check("CASE 13 อินพุตเดิม -> ผลลัพธ์เดิมทุกครั้ง", JSON.stringify(again) === JSON.stringify(r), { again, r });
}

// ---- CASE 14: เปลี่ยน override กลางโปรเซส --------------------------------------
{
  const other = mkdtempSync(join(tmpdir(), "dna-state2-"));
  process.env[DNA_OS_STATE_ROOT_ENV] = EXTERNAL;
  const first = resolveLocalStateRoot();
  process.env[DNA_OS_STATE_ROOT_ENV] = other;
  const second = resolveLocalStateRoot();
  check("CASE 14 เปลี่ยน override ระหว่างการเรียก -> ผลเปลี่ยน โดยไม่ต้อง reload โมดูล",
    first.status === "RESOLVED" && second.status === "RESOLVED" && first.state_root !== second.state_root,
    { first: first.status === "RESOLVED" ? first.state_root : first, second: second.status === "RESOLVED" ? second.state_root : second });
}

// ---- CASE 15: แพลตฟอร์มที่ยังไม่รองรับ ------------------------------------------
{
  clearOverride();
  const linux = resolveLocalStateRoot({ platform: "linux" });
  const win = resolveLocalStateRoot({ platform: "win32" });
  check("CASE 15 แพลตฟอร์มที่ยังไม่พิสูจน์ -> UNRESOLVED ไม่ตกกลับไปเก็บในรีโป",
    linux.status === "UNRESOLVED" && linux.reason_code === "UNSUPPORTED_PLATFORM"
    && win.status === "UNRESOLVED"
    && !JSON.stringify([linux, win]).includes(REPO), { linux, win });
}

// ---- การตั้งค่าที่ผิดต้องไม่ถูกกลืนเงียบ -----------------------------------------
{
  process.env[DNA_OS_STATE_ROOT_ENV] = "";
  const empty = resolveLocalStateRoot();
  check("       override ที่ตั้งเป็นค่าว่าง -> INELIGIBLE ไม่ถูกอ่านว่า \"ไม่ได้ตั้ง\"",
    empty.status === "INELIGIBLE" && empty.reason_code === "EMPTY_OVERRIDE", empty);
  process.env[DNA_OS_STATE_ROOT_ENV] = "relative/path";
  const rel = resolveLocalStateRoot();
  check("       override ที่เป็น path สัมพัทธ์ -> INELIGIBLE (ขึ้นกับ cwd)",
    rel.status === "INELIGIBLE" && rel.reason_code === "RELATIVE_OVERRIDE", rel);
}

// ---- สัญญาสิทธิ์ประกาศไว้ แต่ไม่ถูกใช้ในสไลซ์นี้ ------------------------------------
{
  // ตรวจเฉพาะโค้ดจริง ไม่ใช่คอมเมนต์ — คอมเมนต์ในไฟล์นั้น *ห้าม* สิ่งเหล่านี้ไว้
  // จึงมีคำเหล่านั้นอยู่ การ grep ทั้งไฟล์จะฟ้องคำสั่งห้ามของตัวเอง
  const src = require("node:fs").readFileSync(join(__dirname, "..", "resolver.ts"), "utf-8") as string;
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("       ค่าคงที่สิทธิ์คือ 0o700 / 0o600 และ resolver ไม่มีคำสั่งเปลี่ยนระบบไฟล์เลย",
    STATE_DIRECTORY_MODE === 0o700 && STATE_FILE_MODE === 0o600
    && !/\b(chmodSync|mkdirSync|writeFileSync|appendFileSync|openSync|rmSync|unlinkSync)\s*\(/.test(code),
    code.match(/\b(chmodSync|mkdirSync|writeFileSync|appendFileSync|openSync)\s*\(/g));
}

process.env.HOME = savedHome;
if (savedOverride === undefined) clearOverride(); else process.env[DNA_OS_STATE_ROOT_ENV] = savedOverride;

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
