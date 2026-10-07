// Phase 23 close-out — fresh-user bootstrap. Does NOT hard-code any
// Owner-specific path. Resolves external tool locations by real
// filesystem probing relative to this repo's own parent directory (the
// only assumption made: sibling-folder layout, same as every other real
// root this whole session discovered organically), writes the resolved
// result to config.json, and self-tests against the live gateway.
//
// Run: node control/agent-gateway/bootstrap.mjs
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(HERE, "..", "..");
const PARENT_DIR = path.resolve(REPO_ROOT, "..");
const CONFIG_PATH = path.join(HERE, "config.json");

function checkNode() {
  const [major] = process.versions.node.split(".").map(Number);
  return { ok: major >= 18, version: process.versions.node, required: ">=18" };
}

/** Real filesystem probe — no hard-coded absolute path. Looks for a sibling directory whose src/cli.ts matches the real, known DNA-LAB-FILE-INTELLIGENCE shape. */
function resolveFileIntelligenceRoot() {
  const envOverride = process.env.DNA_LAB_FILE_INTELLIGENCE_PATH;
  if (envOverride && fs.existsSync(path.join(envOverride, "src/cli.ts"))) {
    return { path: envOverride, resolved_via: "env:DNA_LAB_FILE_INTELLIGENCE_PATH" };
  }
  if (!fs.existsSync(PARENT_DIR)) return { path: null, resolved_via: "NOT_FOUND — parent directory unreadable" };
  const candidates = fs.readdirSync(PARENT_DIR).filter((name) => /file.intelligence/i.test(name));
  for (const c of candidates) {
    const candidatePath = path.join(PARENT_DIR, c);
    if (fs.existsSync(path.join(candidatePath, "src/cli.ts")) && fs.existsSync(path.join(candidatePath, "node_modules/.bin/ts-node"))) {
      return { path: candidatePath, resolved_via: "filesystem_probe:sibling_directory_name_match" };
    }
  }
  return { path: null, resolved_via: "NOT_FOUND — no sibling directory matching /file.intelligence/i with a real src/cli.ts + node_modules/.bin/ts-node" };
}

function checkRequiredFiles() {
  const required = [
    "control/agent-gateway/gateway.ts",
    "control/agent-gateway/contract.ts",
    "control/agent-gateway/types.ts",
    "reports/phase16-world-evidence/capability_index.json",
    "permissions/write-gate/contract.ts",
    "software/capability-registrar/contract.ts",
  ];
  return required.map((rel) => ({ file: rel, exists: fs.existsSync(path.join(REPO_ROOT, rel)) }));
}

function get(url) {
  return new Promise((resolve) => {
    http.get(url, { timeout: 5000 }, (res) => {
      let out = ""; res.on("data", (c) => (out += c)); res.on("end", () => resolve({ status: res.statusCode, body: out }));
    }).on("error", (err) => resolve({ status: 0, error: err.message })).on("timeout", () => resolve({ status: 0, error: "timeout" }));
  });
}

async function main() {
  const report = { generated_at: new Date().toISOString(), steps: [] };

  const nodeCheck = checkNode();
  report.steps.push({ step: "1_check_dependencies", node: nodeCheck });

  const fileFiles = checkRequiredFiles();
  const missing = fileFiles.filter((f) => !f.exists);
  report.steps.push({ step: "2_check_missing", required_files: fileFiles, missing_count: missing.length });

  const fileIntelRoot = resolveFileIntelligenceRoot();
  report.steps.push({ step: "3_resolve_external_tools", file_intelligence: fileIntelRoot });

  // 3. Install only safe, explicitly-scoped dependencies — this bootstrap installs NOTHING
  // automatically (no `npm install` invoked). It only reports what would be needed.
  report.steps.push({ step: "3b_install_policy", note: "No automatic installation performed — this bootstrap only detects and reports. Any install requires an explicit, separate, Owner-authorized step (matches Phase 23's own 'safe and authorized only' rule)." });

  const config = { file_intelligence_root: fileIntelRoot.path, resolved_via: fileIntelRoot.resolved_via, generated_at: report.generated_at };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  report.steps.push({ step: "4_register_adapters", config_written_to: CONFIG_PATH, config });

  const status = await get("http://localhost:8790/gateway/dna_status");
  report.steps.push({ step: "5_verify_gateway", reachable: status.status === 200, response: status.status === 200 ? JSON.parse(status.body) : status });

  let selfTestOk = false;
  if (status.status === 200) {
    const selfTest = await new Promise((resolve) => {
      const data = JSON.stringify({ intent_text: "bootstrap self-test: ตรวจสอบไฟล์ซ้ำในระบบ", client_id: "bootstrap-self-test", user_id: "bootstrap", workspace_id: "bootstrap-ws", conversation_id: "bootstrap-conv" });
      const req = http.request("http://localhost:8790/gateway/dna_submit_task", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => {
        let out = ""; res.on("data", (c) => (out += c)); res.on("end", () => resolve({ status: res.statusCode, body: out }));
      });
      req.on("error", (err) => resolve({ status: 0, error: err.message }));
      req.write(data); req.end();
    });
    selfTestOk = selfTest.status === 200;
    report.steps.push({ step: "6_self_test", ok: selfTestOk, response: selfTest.status === 200 ? JSON.parse(selfTest.body) : selfTest });
  } else {
    report.steps.push({ step: "6_self_test", ok: false, reason: "gateway unreachable, self-test skipped" });
  }

  report.overall = missing.length === 0 && !!fileIntelRoot.path && status.status === 200 && selfTestOk ? "BOOTSTRAP_OK" : "BOOTSTRAP_INCOMPLETE";
  fs.writeFileSync(path.join(HERE, "bootstrap_result.json"), JSON.stringify(report, null, 2), "utf-8");
  console.log(JSON.stringify({ overall: report.overall, file_intelligence_resolved: fileIntelRoot, missing_files: missing.length, gateway_reachable: status.status === 200, self_test_ok: selfTestOk }, null, 2));
}
main();
