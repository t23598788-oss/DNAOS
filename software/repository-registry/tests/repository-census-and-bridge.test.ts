/**
 * หน้าที่: (1) พิสูจน์ census classification ของ repository registry
 *         (2) พิสูจน์สะพาน Repository Registry -> canonical -> Connection Declaration
 * ไม่ลบ fixture ไม่เขียนอะไรใหม่
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countRepositoriesByClassification, listOperationalRepositories,
  classifyRepository, getRepository, buildRepositoryId } from "../contract";
import { resolveCanonicalResource } from "../../registry-database/canonical-resource-resolution";
import { listConnectionDeclarations } from "../../../connections/connection-registry/declaration-registry";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (d ? "  -> " + d : "")); }
};

console.log("\nCENSUS CLASSIFICATION");
const counts = countRepositoriesByClassification();
console.log(`  OPERATIONAL=${counts.OPERATIONAL} TEST_FIXTURE=${counts.TEST_FIXTURE} UNCLASSIFIED=${counts.UNCLASSIFIED} total=${counts.total}`);
ok("TEST_FIXTURE = 117 (ไม่ถูกลบ)", counts.TEST_FIXTURE === 117, String(counts.TEST_FIXTURE));
ok("UNCLASSIFIED = 0 (marker สองตัวตรงกันทุกแถว)", counts.UNCLASSIFIED === 0, String(counts.UNCLASSIFIED));
ok("สามกลุ่มรวมเท่าจำนวนแถวทั้งหมด",
  counts.OPERATIONAL + counts.TEST_FIXTURE + counts.UNCLASSIFIED === counts.total);
ok("OPERATIONAL ทุกแถวมี repository_root เป็น path จริง ไม่ใช่ sandbox",
  listOperationalRepositories().every((r) => !/__sandbox__|^\/tmp\//.test(r.repository_root)));
ok("marker ขัดกันต้องได้ UNCLASSIFIED ไม่ใช่เดา",
  classifyRepository({ owner: "test-owner", repository_root: "/Users/tam/real" }) === "UNCLASSIFIED");

console.log("\nIDENTITY ที่เพิ่งลงทะเบียน");
const REPO_ID = buildRepositoryId("t23598788-oss", "-DNA-OS-INFRASTRUCTURE-");
const repo = getRepository(REPO_ID);
ok("repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE- อ่านกลับได้", repo !== null, REPO_ID);
ok("source_authority คือ git remote จริง",
  repo?.source_authority === "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-.git", String(repo?.source_authority));
ok("repository_root คือ checkout จริงบนเครื่อง",
  repo?.repository_root === "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", String(repo?.repository_root));
ok("ถูกจำแนกเป็น OPERATIONAL", repo ? classifyRepository(repo) === "OPERATIONAL" : false);

console.log("\nBRIDGE — repository_id -> canonical resource");
{
  // สะพานถูกเดินสายไว้แล้วใน canonical-resource-resolution: expected_repository_id / REPOSITORY_MISMATCH
  const src = readFileSync(join(__dirname, "..", "..", "registry-database", "canonical-resource-resolution.ts"), "utf8");
  ok("canonical resolver รับ expected_repository_id", src.includes("expected_repository_id"));
  ok("canonical resolver มี REPOSITORY_MISMATCH", src.includes("REPOSITORY_MISMATCH"));
  ok("canonical resolver อ่าน repository registry ผ่าน getRepository", src.includes("getRepository"));

  // resource จริงยังไม่มี repository_id — สะพานพร้อมแต่ยังไม่มีการผูก
  const res = readFileSync(join(__dirname, "..", "..", "registry-database", "data", "canonical", "resources.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l) as { repository_id: string | null });
  const linked = res.filter((r) => r.repository_id !== null).length;
  ok("รายงานตามจริงว่ายังไม่มี resource ใดผูก repository_id", linked === 0, `${linked}/${res.length}`);
  ok("resolveCanonicalResource ยัง import ได้ (สะพานยังทำงาน)", typeof resolveCanonicalResource === "function");
}

console.log("\nBRIDGE — repository -> Connection Declaration");
{
  const ghDecl = listConnectionDeclarations().find((d) => d.provider_id === "github");
  const d = ghDecl?.target_descriptor ?? {};
  ok("descriptor ของ declaration ตรงกับ identity ที่ลงทะเบียน",
    d.owner === repo?.owner && d.repository === repo?.repository && d.branch === repo?.default_branch,
    JSON.stringify(d));
  ok("canonical_target_id ยังเป็น null (รอบนี้ไม่เติมตามคำสั่ง)", ghDecl?.canonical_target_id === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
