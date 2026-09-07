/**
 * หน้าที่: ลงทะเบียนรีโป canonical ของระบบบัญชี — Owner, 2026-09-05
 * TASK: CONSOLIDATE_ACCOUNTING_INTO_EXISTING_CANONICAL_RUNTIME (Phase 1)
 *
 * ใช้กลไก software/repository-registry/ เดิม ไม่สร้างกลไกใหม่
 * ทุกค่ามาจากการอ่าน git จริงของรีโปนั้น ไม่มีค่าที่คิดเอง
 * world = BUSINESS_LINE_FINANCE เพราะมีอยู่แล้วในทะเบียน ไม่ได้ตั้งชื่อใหม่
 *
 * Input: ไม่มี (อ่าน git จาก repository_root)
 * Output: RepositoryRegistration ที่บันทึกลงทะเบียนแล้ว
 * สิ่งที่ห้ามแตะ: ห้ามใส่ค่าที่ไม่ได้อ่านจาก git จริง
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { registerRepository, buildRepositoryId, createRepositoryRegistryStore } from "../repository-registry/contract";

const ROOT = "/Users/tam/Desktop/DNA-OS-บัญชีการเงิน";

function git(args: readonly string[]): string {
  return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }).trim();
}

function main(): number {
  if (!existsSync(ROOT)) { console.error(`ไม่พบ ${ROOT}`); return 2; }

  const remote = git(["remote", "get-url", "origin"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = git(["rev-parse", "HEAD"]);
  const m = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/.exec(remote);
  if (m === null) { console.error(`อ่าน owner/repo จาก remote ไม่ได้: ${remote}`); return 2; }
  const [, owner, repository] = m;

  const store = createRepositoryRegistryStore();
  console.log("=".repeat(78));
  console.log("REPOSITORY REGISTRATION — canonical accounting runtime");
  console.log("=".repeat(78));
  console.log(`  owner        : ${owner}`);
  console.log(`  repository   : ${repository}`);
  console.log(`  remote       : ${remote}`);
  console.log(`  branch       : ${branch}`);
  console.log(`  commit       : ${commit}`);
  console.log(`  local path   : ${ROOT}`);

  const result = registerRepository({
    owner, repository,
    world: "BUSINESS_LINE_FINANCE",
    source_authority: remote,
    default_branch: branch,
    repository_root: ROOT,
    connection_id: null,
  });

  console.log(`\n  ผล: ${JSON.stringify(result)}`);
  // อ่านกลับจาก store เดียวกับที่เขียน — พิสูจน์ว่าบันทึกลงจริง ไม่ใช่แค่ค่าที่คืนมา
  const back = store.getRepository(buildRepositoryId(owner, repository));
  console.log(`  อ่านกลับ: ${back === null ? "ไม่พบ" : back.repository_id + " status=" + back.status + " commit_at_registration=" + commit}`);
  return back === null ? 1 : 0;
}

process.exit(main());
