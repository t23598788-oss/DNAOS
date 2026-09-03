/**
 * หน้าที่: พิสูจน์ว่าการเปิดสิทธิ์ให้ Claude ไม่ได้รั่วไปถึง Agent ทั่วไป และ
 * เมื่อการยืนยันตัวตนของเครื่องใช้ไม่ได้ ระบบปิดตายแทนที่จะแอบสลับไปโหมด API key
 * (Owner, TEST C และ TEST H).
 *
 * เคส C สำคัญที่สุดในไฟล์นี้: ถ้ามันไม่ผ่าน แปลว่าเราแลกความปลอดภัยของ Agent
 * ทุกตัวไปกับการทำให้ Claude ทำงานได้ ซึ่งเป็นเงื่อนไขหยุดที่เจ้าของระบุไว้เอง
 *
 * Input: none.
 * Output: exit 0 เมื่อผ่านทั้งหมด.
 * Dependency ที่อนุญาต: ../../agent-gateway/contract.ts, ../profile.ts, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามผ่อนเคส C ให้ผ่านด้วยการเปลี่ยนสิ่งที่วัด.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentWorkOrder } from "../../agent-gateway/contract";
import { buildClaudeProfile, SECURITY_BINARY } from "../profile";

let failures = 0;
function ok(name: string, condition: boolean, detail = ""): void {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

(async () => {
  const workspace = mkdtempSync(join(tmpdir(), "claude-isolation-"));

  // ================= TEST C: Agent ทั่วไปต้องเข้า Keychain ไม่ได้ =================
  // ใช้ worker LOCAL ตัวจริงผ่าน runAgentWorkOrder เส้นเดียวกับงานปกติ
  // แล้วสั่ง action `exec_security` ซึ่งเป็นการลอง `security find-generic-password` จริง
  const workOrder = {
    operation: "MODIFY", target_type: "FILE", target_path: "(isolation-test)",
    requested_change: "general agent attempts privileged keychain access",
    content: "", workspace_scope: workspace, mode: "sandbox",
    required_tests: [], forbidden_files: [], evidence: [],
    agent_run: {
      worker_kind: "LOCAL", instruction: JSON.stringify({ action: "exec_security" }),
      workspace_id: "", assigned_source_paths: [], dependency_read_paths: [],
      workspace_path: workspace, timeout_ms: 60_000,
      expected_result_contract: "DNA_OS_AGENT_RESULT_V1",
    },
  } as never;
  const agentResult = await runAgentWorkOrder(workOrder, `isolation-c-${Date.now()}`, process.env);
  const transcript = JSON.stringify(agentResult);
  const blockedInAgent = /BLOCKED|not permitted|Operation not permitted|EPERM|denied/i.test(transcript);
  ok("C1. Agent ทั่วไปเรียก /usr/bin/security แล้วถูกปฏิเสธ", blockedInAgent,
    `status=${agentResult.status} exit=${String(agentResult.exit_code)}`);
  ok("C2. ผลของ Agent ทั่วไปไม่มีเนื้อหาจาก Keychain",
    !/password|acct.*=.*"|-----BEGIN/i.test(transcript));

  // โปรไฟล์ของ Agent ทั่วไปต้องยังปิด Keychain ที่ระดับ source ไม่ใช่แค่ผลลัพธ์
  const generalProfileSrc = readFileSync("control/agent-host/host-runtime.ts", "utf8");
  ok("C3. กรงของ Agent ทั่วไปยัง deny Library/Keychains อยู่",
    /ALWAYS_DENIED_READ_SUBPATHS[\s\S]{0,120}Library\/Keychains/.test(generalProfileSrc));
  ok("C4. กรงของ Agent ทั่วไปไม่เคยเปิด exec /usr/bin/security",
    !generalProfileSrc.includes("/usr/bin/security"));

  // ================= สิทธิ์พิเศษอยู่เฉพาะโปรไฟล์ของ Claude =================
  const claudeProfile = buildClaudeProfile({ workspace, executable: "/usr/local/bin/claude" });
  ok("C5. โปรไฟล์ของ Claude เปิด exec security และอ่าน Keychains",
    claudeProfile.includes(`(allow process-exec (literal "${SECURITY_BINARY}"))`)
    && claudeProfile.includes(join(homedir(), "Library/Keychains")));
  ok("C6. โปรไฟล์ของ Claude ยังปิด .ssh / .config/gh / .env",
    claudeProfile.includes(".ssh") && claudeProfile.includes(".config/gh") && claudeProfile.includes("\\.env"));
  ok("C7. โปรไฟล์ของ Claude ไม่เปิด exec ให้ไบนารีอื่นนอกจากสองตัวที่ระบุ",
    (claudeProfile.match(/\(allow process-exec/g) ?? []).length === 2);

  // ================= TEST H: ยืนยันตัวตนไม่ได้ = ปิดตาย ไม่สลับโหมด =================
  // สร้างสถานะไม่ถูกต้องแบบควบคุมได้: HOME ที่ไม่มี config ของ Claude
  const emptyHome = mkdtempSync(join(tmpdir(), "claude-empty-home-"));
  const runner = join(workspace, "h-runner.mjs");
  writeFileSync(runner, `
import { runClaudeCodeLocally } from ${JSON.stringify(join(process.cwd(), "control/claude-execution-boundary/contract.ts"))};
const r = await runClaudeCodeLocally({ provider: "CLAUDE_CODE", execution_mode: "LOCAL_MACHINE_AUTH",
  caller: "control/claude-execution-boundary/tests/boundary.test.ts",
  objective: "say ok", workspace: ${JSON.stringify(workspace)}, task_id: "t", work_order_id: "w", timeout_ms: 60000 });
console.log(JSON.stringify({ status: r.status, authenticated: r.authenticated, api_key_source: r.api_key_source, env_names: r.env_names }));
`);
  let hOut = "";
  try {
    hOut = execFileSync("npx", ["tsx", runner], {
      encoding: "utf8", timeout: 120_000,
      env: { PATH: process.env.PATH ?? "", TMPDIR: "/tmp", HOME: emptyHome, USER: process.env.USER ?? "" },
      cwd: process.cwd(),
    });
  } catch (error) {
    hOut = String((error as { stdout?: string }).stdout ?? "");
  }
  const hLine = hOut.split("\n").filter((l) => l.trim().startsWith("{")).at(-1) ?? "{}";
  const h = JSON.parse(hLine) as { status?: string; authenticated?: boolean; api_key_source?: string | null };
  console.log(`      H run: ${JSON.stringify(h)}`);
  ok("H1. auth ใช้ไม่ได้ → รายงาน AUTH_UNAVAILABLE ตรง ๆ", h.status === "AUTH_UNAVAILABLE", String(h.status));
  ok("H2. ไม่ประกาศว่ายืนยันตัวตนสำเร็จ", h.authenticated === false);

  const boundarySrc = readFileSync("control/claude-execution-boundary/boundary.ts", "utf8");
  ok("H3. ในขอบเขตไม่มีเส้นทางไปโหมด API key เลย",
    !/ANTHROPIC_API_KEY|api-credential|apiKey\s*=/.test(boundarySrc));
  ok("H4. environment ที่ส่งให้ Claude มีเฉพาะ 4 ชื่อคงที่",
    /ENV_NAMES = \["PATH", "TMPDIR", "HOME", "USER"\]/.test(boundarySrc));
  ok("H5. --bare ไม่ถูกใส่กลับเข้ามาใน argv",
    !/"--bare"/.test(boundarySrc.replace(/\/\*[\s\S]*?\*\//g, "")));

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
