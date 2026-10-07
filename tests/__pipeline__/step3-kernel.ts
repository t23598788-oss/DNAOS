/** STEP 3: ทดสอบความปลอดภัยซ้ำบน launchAgent ตัวจริงหลัง promote */
import { launchAgent } from "../../control/agent-host/contract";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const WS = `${REPO}/tests/__pipeline__/step3-ws`;
const DEP = `${REPO}/tests/__pipeline__/step3-dep`;
const SIB = "/Users/tam/Desktop/DNA-LAB-FILE-INTELLIGENCE";
async function main() {
  for (const d of [WS, DEP]) { mkdirSync(d, { recursive: true }); }
  writeFileSync(`${WS}/assigned.txt`, "assigned\n");
  writeFileSync(`${DEP}/dep.txt`, "dependency\n");
  writeFileSync(`${WS}/.env.local`, "SECRET=1\n");
  const probe = `${WS}/probe.mjs`;
  writeFileSync(probe, `import fs from "node:fs";
const t = JSON.parse(process.argv[2]); const out = {};
for (const [k, v] of Object.entries(t)) {
  try { if (v.op === "read") { fs.readFileSync(v.path, "utf8"); out[k] = "ALLOWED"; }
        else { fs.writeFileSync(v.path, "x"); out[k] = "ALLOWED"; } }
  catch (e) { out[k] = "DENIED:" + e.code; } }
console.log(JSON.stringify(out));\n`);
  const targets = {
    ASSIGNED_SOURCE_READ: { op: "read", path: `${WS}/assigned.txt` },
    DEPENDENCY_READ: { op: "read", path: `${DEP}/dep.txt` },
    UNASSIGNED_REPO_READ: { op: "read", path: `${REPO}/control/agent-gateway/gateway.ts` },
    SIBLING_REPO_READ: { op: "read", path: `${SIB}/package.json` },
    SECRET_READ: { op: "read", path: `${WS}/.env.local` },
    OTHER_USER_DATA_READ: { op: "read", path: "/Users/tam/.zshrc" },
    ALLOWED_WRITE: { op: "write", path: `${WS}/w.txt` },
    FORBIDDEN_WRITE: { op: "write", path: `${REPO}/FORBIDDEN-STEP3.txt` },
  };
  const node = process.execPath;
  const r = await launchAgent({ allowedWorkspaceDir: WS, agentExecutable: node,
    agentArgv: [probe, JSON.stringify(targets)], timeoutMs: 30_000,
    repositoryReadPaths: [DEP] }, process.env, []);
  console.log("LOCAL_WORKER exit=" + r.exitCode);
  console.log(r.stdout.trim() || `(no stdout) stderr=${r.stderr.slice(0, 200)}`);
  console.log("FORBIDDEN_FILE_CREATED=" + existsSync(`${REPO}/FORBIDDEN-STEP3.txt`));
  for (const w of [["CLAUDE", "/usr/local/bin/claude"], ["CODEX", "/Users/tam/.codex/plugins/.plugin-appserver/codex"]]) {
    const lr = await launchAgent({ allowedWorkspaceDir: WS, agentExecutable: w[1],
      agentArgv: ["--version"], timeoutMs: 30_000 }, process.env, []);
    console.log(`${w[0]}_WORKER exit=${lr.exitCode} out=${(lr.stdout || lr.stderr).trim().slice(0, 60)}`);
  }
  rmSync(WS, { recursive: true, force: true }); rmSync(DEP, { recursive: true, force: true });
}
main().catch((e) => { console.error("ERR", e?.message ?? e); process.exit(1); });
