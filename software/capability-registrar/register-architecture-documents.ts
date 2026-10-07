/**
 * หน้าที่: ลงทะเบียน Architecture Document ที่มีอยู่จริงเข้า canonical registry
 * ผ่าน Registration Pipeline เดิม — ไม่เขียน canonical โดยตรง
 *
 * candidate สร้างจาก **ไฟล์จริง** ทุกฉบับ: path, ขนาด, sha256 ของเนื้อหา,
 * หัวเรื่องแรก, และสถานะ git ที่อ่านสด ไม่มี field ใดถูกแต่ง
 *
 * เอกสารเป็น kind "resource" ไม่ใช่ capability และไม่ประกาศเจตนา executable
 * จึงไม่เข้าเงื่อนไข EXECUTABLE_CONTRACT_REQUIRED ของ admission gate
 *
 * Usage: npx tsx software/capability-registrar/register-architecture-documents.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import type { RegistrationCandidate } from "../../control/event-pipeline/registration-contract";

const ROOT = join(__dirname, "..", "..");
const DIR = "governance/architecture-rules";

type GitState = "TRACKED_COMMITTED" | "TRACKED_MODIFIED" | "UNTRACKED" | "NOT_IN_REPOSITORY";

function gitStateOf(rel: string): GitState {
  try {
    execSync(`git ls-files --error-unmatch "${rel}"`, { cwd: ROOT, stdio: "pipe" });
    const dirty = execSync(`git status --porcelain "${rel}"`, { cwd: ROOT, encoding: "utf8" }).trim();
    return dirty ? "TRACKED_MODIFIED" : "TRACKED_COMMITTED";
  } catch { return "UNTRACKED"; }
}

function head(): string {
  try { return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "UNKNOWN"; }
}
function repoRemote(): string {
  try { return execSync("git remote get-url origin", { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "UNKNOWN"; }
}

function candidateFor(name: string): RegistrationCandidate {
  const rel = `${DIR}/${name}`;
  const abs = join(ROOT, rel);
  const text = readFileSync(abs, "utf8");
  const info = statSync(abs);
  const sha = createHash("sha256").update(text).digest("hex");
  const heading = text.split("\n").find((l) => l.startsWith("# "))?.replace(/^#\s*/, "").trim() ?? name;
  const git = gitStateOf(rel);

  return {
    candidate_id: `candidate-architecture-document-${name.replace(/\.md$/, "").toLowerCase()}`,
    name: `architecture-document:${name.replace(/\.md$/, "").toLowerCase().replace(/_/g, "-")}`,
    kind: "resource",
    source_location: rel,
    owner: "governance/architecture-rules",
    input: [],
    output: [],
    side_effects: [],
    dependencies: [],
    behavior: `Architecture Document — "${heading}". เอกสารสถาปัตยกรรมที่อ่านสดจาก ${rel} และถูกฉายผ่าน /api/architecture-doc ไปยังหน้า Settings ไม่ใช่ฐานข้อมูลอีกชุด แต่เป็น living projection ของ canonical graph/evidence`,
    version: "1.0.0",
    evidence_refs: [
      rel,
      `sha256:${sha}`,
      `bytes:${info.size}`,
      `git_state:${git}`,
      `repository:${repoRemote()}`,
      `head_at_registration:${head()}`,
      "transport: GET /api/architecture-doc (Product server อ่านไดเรกทอรีสดทุกครั้ง)",
    ],
    // SOURCE_REFERENCE = การอ้างถึงเอกสาร/ซอร์สที่อธิบาย control plane
    // ไม่ใช่ BUSINESS_DOCUMENT (ซึ่ง classifier ปฏิเสธโดยตั้งใจ)
    // และไม่ต้องเพิ่มชนิดใหม่เข้า classifier
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "SOURCE_REFERENCE",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: "governance/architecture-document",
  } as unknown as RegistrationCandidate;
}

function main(): number {
  const store = createPersistentFileStore();
  const docs = readdirSync(join(ROOT, DIR)).filter((f) => f.endsWith(".md")).sort();
  let registered = 0, duplicate = 0, rejected = 0;

  for (const name of docs) {
    const c = candidateFor(name);
    const r = runRegistrationPipeline(c, store, `register-architecture-document-${name}`);
    const line = `${name.padEnd(46)} ${r.status.padEnd(11)}`;
    if (r.status === "REGISTERED") { registered++; console.log(`${line} ${r.resource_id}`); }
    else if (r.status === "DUPLICATE") { duplicate++; console.log(`${line} ${"reason_code" in r ? r.reason_code : ""}`); }
    else { rejected++; console.log(`${line} ${"reason_code" in r ? r.reason_code : ""} ${"failed_stage" in r ? r.failed_stage : ""}`); }
  }
  console.log(`\nREGISTERED=${registered}  DUPLICATE(REUSED)=${duplicate}  REJECTED=${rejected}  total=${docs.length}`);
  return rejected > 0 ? 1 : 0;
}
process.exit(main());
