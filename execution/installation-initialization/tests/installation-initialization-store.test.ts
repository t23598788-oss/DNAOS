/**
 * CASE 1–31: การอ่านและสร้างระเบียนการเริ่มต้นการติดตั้ง
 *
 * ทุกเคสใช้ state root ชั่วคราวผ่าน DNA_OS_STATE_ROOT และเทสต์ยืนยันเองก่อน
 * เขียนอะไรว่า path ที่จะถูกใช้อยู่ในแซนด์บ็อกซ์จริง — ตามบทเรียนที่หลักฐาน
 * 187 แถวเคยหายเพราะ path ถูกผูกตอน import
 *
 * การทดสอบการแข่งขันใช้ `child_process.spawn` สองโปรเซสจริงพร้อมกัน ไม่ใช่
 * การเรียกฟังก์ชันซ้ำในโปรเซสเดียว — การรับประกันที่ทดสอบอยู่คือของเคอร์เนล
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInitializationRecord } from "../../../contracts/installation/installation-initialization";
import type { InstallationInitializationV1 } from "../../../contracts/installation/installation-initialization";
import { readInstallationInitialization, initializationPath } from "../contract";
import { createInstallationInitializationFromCeremony } from "../restricted";
import { DNA_OS_STATE_ROOT_ENV } from "../../local-state-root/contract";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}`); if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`); }
};

const PROD_ROOT = join(process.env.HOME ?? "", "Library", "Application Support", "DNA OS");
const prodExistedBefore = existsSync(PROD_ROOT);
/** ลายนิ้วมือของสโตร์จริง — ใช้พิสูจน์ว่าเทสต์ชุดนี้ไม่ได้ไปแตะมัน */
function prodDigest(): string {
  if (!existsSync(PROD_ROOT)) return "ABSENT";
  const entries = readdirSync(PROD_ROOT, { withFileTypes: true })
    .map((e) => `${e.name}:${e.isDirectory() ? "d" : "f"}`).sort().join("|");
  const file = join(PROD_ROOT, "installation", "initialization.json");
  return existsSync(file) ? `${entries}#${readFileSync(file, "utf-8")}` : entries;
}
const prodDigestBefore = prodDigest();

const ID_A = "installation-3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const ID_B = "installation-00000000-0000-4000-8000-000000000000";
const TIME = "2026-08-29T10:00:00.000Z";
const recordFor = (id: string, at = TIME): InstallationInitializationV1 => {
  const r = buildInitializationRecord({ installation_id: id, created_at: at, evidence_refs: ["a/b.ts#ceremony"] });
  if (!r.ok) throw new Error(r.reason_code);
  return r.record;
};

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dna-init-"));
  process.env[DNA_OS_STATE_ROOT_ENV] = root;
  return root;
}
const installDirOf = (root: string): string => join(root, "installation");
const fileOf = (root: string): string => join(installDirOf(root), "initialization.json");

// ---- การแยกสโตร์: ยืนยันก่อนเขียนอะไร ------------------------------------------
{
  const root = freshRoot();
  const p = initializationPath();
  check("ISOLATION  path ที่จะถูกใช้อยู่ในแซนด์บ็อกซ์ ไม่ใช่สโตร์จริง",
    p !== null && p.startsWith(require("node:fs").realpathSync(root)) && !p.startsWith(PROD_ROOT), p);
  if (p === null || p.startsWith(PROD_ROOT)) { console.log("\nหยุดทันที: การแยกสโตร์ล้มเหลว"); process.exit(1); }
}

// ---- CASE 1/2/3: ยังไม่เริ่มต้น และการอ่านไม่มีผลข้างเคียง -------------------------
{
  const root = freshRoot();
  const before = readdirSync(root).length;
  const r = readInstallationInitialization();
  check("CASE 1  ไม่มีไฟล์ -> UNINITIALIZED", r.state === "UNINITIALIZED", r);
  check("CASE 2  การอ่านไม่มีผลข้างเคียง", readdirSync(root).length === before && before === 0);
  check("CASE 3  การอ่านไม่สร้างไดเรกทอรี installation", !existsSync(installDirOf(root)));
  readInstallationInitialization(); readInstallationInitialization();
  check("       อ่านซ้ำหลายครั้งก็ยังไม่สร้างอะไร", readdirSync(root).length === 0);
}

// ---- CASE 4 + 13/14/15/16: สร้างครั้งแรก ------------------------------------------
{
  const root = freshRoot();
  const created = createInstallationInitializationFromCeremony(recordFor(ID_A));
  check("CASE 16 สร้างครั้งแรกที่ถูกต้อง -> CREATED", created.result === "CREATED", created);
  const read = readInstallationInitialization();
  check("CASE 4  ระเบียนที่เก็บไว้ถูกต้อง -> INITIALIZED",
    read.state === "INITIALIZED" && read.initialization.installation_id === ID_A, read);
  check("CASE 13 สร้างเฉพาะไดเรกทอรี installation ไม่มีอย่างอื่น",
    readdirSync(root).join(",") === "installation" && readdirSync(installDirOf(root)).join(",") === "initialization.json",
    { root: readdirSync(root), dir: readdirSync(installDirOf(root)) });
  const dirMode = statSync(installDirOf(root)).mode & 0o777;
  const fileMode = statSync(fileOf(root)).mode & 0o777;
  check("CASE 14 ไดเรกทอรีเป็น 0700", dirMode === 0o700, dirMode.toString(8));
  check("CASE 15 ไฟล์เป็น 0600", fileMode === 0o600, fileMode.toString(8));
}

// ---- CASE 5/6/7/8/9/10/23: รูปแบบที่เสียหาย ---------------------------------------
{
  const good = recordFor(ID_A);
  const cases: { name: string; content: string; expect: string }[] = [
    { name: "CASE 5  JSON ไม่ถูกต้อง -> CORRUPT", content: "{ ไม่ใช่ json", expect: "INVALID_JSON" },
    { name: "CASE 6  ไฟล์ว่าง -> CORRUPT", content: "", expect: "INVALID_JSON" },
    { name: "CASE 23 ไฟล์ที่เขียนค้างครึ่งทาง -> CORRUPT", content: JSON.stringify(good).slice(0, 60), expect: "INVALID_JSON" },
    { name: "CASE 7  schema ผิด -> CORRUPT", content: JSON.stringify({ ...good, schema: "dna-os.installation-initialization.v2" }), expect: "INVALID_CONTRACT" },
    { name: "CASE 8  installation_id ผิดรูป -> CORRUPT", content: JSON.stringify({ ...good, installation_id: "owner" }), expect: "INVALID_CONTRACT" },
    { name: "CASE 9  initialization_id ไม่ตรงเนื้อหา -> CORRUPT", content: JSON.stringify({ ...good, initialization_id: `init-${"0".repeat(32)}` }), expect: "INVALID_CONTRACT" },
    { name: "CASE 10 record_digest ไม่ตรง -> CORRUPT", content: JSON.stringify({ ...good, record_digest: "0".repeat(64) }), expect: "DIGEST_MISMATCH" },
  ];
  for (const c of cases) {
    const root = freshRoot();
    mkdirSync(installDirOf(root), { recursive: true, mode: 0o700 });
    writeFileSync(fileOf(root), c.content, { mode: 0o600 });
    const r = readInstallationInitialization();
    check(c.name, r.state === "CORRUPT" && r.reason_code === c.expect, r);
  }
}

// ---- CASE 11: สิทธิ์/IO ไม่กลายเป็น UNINITIALIZED ----------------------------------
{
  const root = freshRoot();
  mkdirSync(installDirOf(root), { recursive: true, mode: 0o700 });
  writeFileSync(fileOf(root), JSON.stringify(recordFor(ID_A)), { mode: 0o600 });
  chmodSync(fileOf(root), 0o000);
  const r = readInstallationInitialization();
  chmodSync(fileOf(root), 0o600);
  check("CASE 11 อ่านไฟล์ไม่ได้เพราะสิทธิ์ -> CORRUPT ไม่ใช่ UNINITIALIZED",
    r.state === "CORRUPT" && (r.reason_code === "PERMISSION_DENIED" || r.reason_code === "IO_FAILURE"), r);
}

// ---- CASE 12: symlink ไม่ปลอดภัย -------------------------------------------------
{
  const root = freshRoot();
  const elsewhere = mkdtempSync(join(tmpdir(), "dna-elsewhere-"));
  writeFileSync(join(elsewhere, "planted.json"), JSON.stringify(recordFor(ID_B)), { mode: 0o600 });
  mkdirSync(installDirOf(root), { recursive: true, mode: 0o700 });
  symlinkSync(join(elsewhere, "planted.json"), fileOf(root));
  const r = readInstallationInitialization();
  check("CASE 12 ไฟล์มาตรฐานเป็น symlink -> CORRUPT/UNSAFE_PATH ไม่ใช่ UNINITIALIZED และไม่ใช่ INITIALIZED",
    r.state === "CORRUPT" && r.reason_code === "UNSAFE_PATH", r);
}
{
  // state root ที่ชี้เข้ารีโป ต้องไม่ถูกอ่านว่า "ยังไม่เริ่มต้น"
  process.env[DNA_OS_STATE_ROOT_ENV] = join(process.cwd(), "control");
  const r = readInstallationInitialization();
  check("       state root ที่อยู่ในรีโป -> CORRUPT/UNSAFE_PATH", r.state === "CORRUPT" && r.reason_code === "UNSAFE_PATH", r);
}

// ---- CASE 17/18/19/20/21/22: replay, conflict, ไม่เขียนทับ --------------------------
{
  const root = freshRoot();
  const first = createInstallationInitializationFromCeremony(recordFor(ID_A));
  const bytesAfterFirst = readFileSync(fileOf(root), "utf-8");
  const replay = createInstallationInitializationFromCeremony(recordFor(ID_A));
  check("CASE 17 สร้างซ้ำด้วยระเบียนเดียวกันเป๊ะ -> REPLAY", replay.result === "REPLAY", replay);
  const conflict = createInstallationInitializationFromCeremony(recordFor(ID_B));
  check("CASE 18 สร้างด้วยระเบียนที่ถูกต้องแต่ต่างกัน -> CONFLICT",
    conflict.result === "CONFLICT" && conflict.existing.installation_id === ID_A, conflict);
  const bytesNow = readFileSync(fileOf(root), "utf-8");
  check("CASE 20 ไม่เขียนทับ — ไฟล์เหมือนเดิมทุกไบต์หลัง REPLAY และ CONFLICT",
    bytesNow === bytesAfterFirst && first.result === "CREATED");
  check("CASE 21 ไม่ลบ — ไฟล์ยังอยู่", existsSync(fileOf(root)));
  check("CASE 22 ไม่ตัดไฟล์ — ขนาดไม่ลดลง", bytesNow.length === bytesAfterFirst.length && bytesNow.length > 0);

  // ระเบียนเดียวกันแต่ลำดับคีย์ต่างกัน ต้องยังเป็น REPLAY
  const reordered = JSON.parse(JSON.stringify(recordFor(ID_A))) as Record<string, unknown>;
  const swapped = Object.fromEntries(Object.entries(reordered).reverse()) as unknown as InstallationInitializationV1;
  check("CASE 12 เทียบด้วยความหมาย ไม่ใช่ข้อความ JSON -> ลำดับคีย์ต่างกันยังเป็น REPLAY",
    createInstallationInitializationFromCeremony(swapped).result === "REPLAY");
}
{
  const root = freshRoot();
  mkdirSync(installDirOf(root), { recursive: true, mode: 0o700 });
  writeFileSync(fileOf(root), "{ เสียหาย", { mode: 0o600 });
  const r = createInstallationInitializationFromCeremony(recordFor(ID_A));
  check("CASE 19 มีสิ่งที่เสียหายอยู่ก่อน -> CORRUPT และไม่เขียนทับ",
    r.result === "CORRUPT" && readFileSync(fileOf(root), "utf-8") === "{ เสียหาย", r);
}

// ---- CASE 24/25: การแข่งขันข้ามโปรเซสจริง ------------------------------------------
const worker = join(__dirname, "create-worker.ts");
function race(root: string, ids: [string, string]): Promise<{ result: string; id: string | null }[]> {
  const run = (id: string): Promise<{ result: string; id: string | null }> => new Promise((resolveOne) => {
    const child = spawn("npx", ["tsx", worker, id, TIME], {
      cwd: process.cwd(), env: { ...process.env, [DNA_OS_STATE_ROOT_ENV]: root },
    });
    let out = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.on("close", () => {
      const line = out.trim().split("\n").filter((l) => l.trim().startsWith("{")).at(-1) ?? "{}";
      resolveOne(JSON.parse(line) as { result: string; id: string | null });
    });
  });
  return Promise.all([run(ids[0]), run(ids[1])]);
}

void (async () => {
  {
    const root = mkdtempSync(join(tmpdir(), "dna-race-same-"));
    const [a, b] = await race(root, [ID_A, ID_A]);
    const results = [a.result, b.result].sort().join("+");
    const content = readFileSync(fileOf(root), "utf-8");
    check("CASE 24 สร้างพร้อมกันด้วยระเบียนเดียวกัน -> CREATED หนึ่ง REPLAY หนึ่ง",
      results === "CREATED+REPLAY", { a, b });
    check("       ไฟล์เดียว ไม่มี JSON ปนกัน และมีตัวตนเดียว",
      readdirSync(join(root, "installation")).length === 1 && JSON.parse(content).installation_id === ID_A
      && a.id === b.id, { files: readdirSync(join(root, "installation")) });
  }
  {
    const root = mkdtempSync(join(tmpdir(), "dna-race-diff-"));
    const [a, b] = await race(root, [ID_A, ID_B]);
    const results = [a.result, b.result].sort().join("+");
    const content = readFileSync(fileOf(root), "utf-8");
    check("CASE 25 สร้างพร้อมกันด้วยระเบียนที่ต่างกัน -> CREATED หนึ่ง CONFLICT หนึ่ง",
      results === "CONFLICT+CREATED", { a, b });
    const parsed = JSON.parse(content) as InstallationInitializationV1;
    check("       เหลือตัวตนเดียวในดิสก์ ไม่มีตัวตนที่สอง",
      (parsed.installation_id === ID_A || parsed.installation_id === ID_B)
      && readdirSync(join(root, "installation")).length === 1);
  }

  // ---- CASE 26/27: resolve ตอนเรียก และการแยกด้วย override ------------------------
  {
    const rootA = freshRoot();
    createInstallationInitializationFromCeremony(recordFor(ID_A));
    const rootB = freshRoot();
    const inB = readInstallationInitialization();
    process.env[DNA_OS_STATE_ROOT_ENV] = rootA;
    const backInA = readInstallationInitialization();
    check("CASE 26 เปลี่ยน state root กลางโปรเซส -> ผลเปลี่ยนโดยไม่ต้อง reload โมดูล",
      inB.state === "UNINITIALIZED" && backInA.state === "INITIALIZED", { inB: inB.state, backInA: backInA.state });
    check("CASE 27 สองแซนด์บ็อกซ์ไม่ปนกัน", !existsSync(fileOf(rootB)) && existsSync(fileOf(rootA)));
  }

  // ---- CASE 28/29/30/31: production และสิ่งที่ store ไม่ทำ ---------------------------
  {
    // เดิมข้อนี้ยืนยันว่าสโตร์จริงต้องไม่มีอยู่ ซึ่งกลายเป็นการยืนยันว่าเครื่อง
    // ยังไม่มีตัวตน ไม่ใช่การยืนยันว่าเทสต์ชุดนี้ไม่ไปแตะของจริง Owner สั่งสร้าง
    // ตัวตนของเครื่องใน CLOSE_MACHINE_IDENTITY_AND_RECOVERY_FOUNDATION
    // (2026-08-30) — ข้อนี้จึงวัดตรงตามชื่อของมัน: ของจริงต้องไม่ขยับจากเทสต์นี้
    check("CASE 28 สโตร์จริงไม่ถูกแตะ",
      existsSync(PROD_ROOT) === prodExistedBefore && prodDigestBefore === prodDigest(),
      { prodExistedBefore, existsNow: existsSync(PROD_ROOT) });
    const src = readFileSync(join(__dirname, "..", "store.ts"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    check("CASE 29 สโตร์ไม่สร้าง id และไม่อ่านนาฬิกาเพื่อประกอบระเบียน",
      !/randomUUID|Date\.now\s*\(|new Date\s*\(/.test(src), src.match(/randomUUID|Date\.now|new Date/g));
    check("CASE 30 สโตร์ไม่สร้าง Owner/สิทธิ์/สถานะที่พึงเป็นใด ๆ",
      !/principal|owner|grant|membership|credential|desired_state|authority/i.test(src),
      src.match(/principal|owner|grant|membership|credential|desired_state|authority/gi));
    check("CASE 31 สโตร์ไม่แตะทะเบียน และไม่มีคำสั่งเขียนทับ/ลบ/ตัดไฟล์",
      !/registry/i.test(src) && !/writeFileSync|unlinkSync|rmSync|truncate|renameSync|copyFileSync/.test(src),
      src.match(/registry|writeFileSync|unlinkSync|rmSync|truncate|renameSync/gi));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
