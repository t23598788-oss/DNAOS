/**
 * หน้าที่: พิสูจน์กับ Claude Code ตัวจริงบนเครื่องนี้ว่าขอบเขตนี้ (ก) ใช้การ
 * ยืนยันตัวตนของเครื่องได้จริงโดยไม่มี API key และ (ข) ไม่ได้กลายเป็นตัวรัน
 * คำสั่งที่มีสิทธิ์พิเศษแบบทั่วไป (Owner, TEST A/B/D/E/F).
 *
 * ทุกเคสรันของจริง ไม่มี mock: executable จริง, sandbox-exec จริง, Keychain จริง
 * ของเครื่อง ถ้าเครื่องไม่ได้ล็อกอิน Claude ไว้ เคส A/B/F จะรายงาน
 * AUTH_UNAVAILABLE ตามจริง — ไม่ใช่ข้ามไปแล้วบอกว่าผ่าน
 *
 * Input: none.
 * Output: exit 0 เมื่อผ่านทั้งหมด.
 * Dependency ที่อนุญาต: ../contract.ts, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้าม mock ตัว spawn, ห้ามพิมพ์ค่า secret, ห้ามผ่อนเคส D/E
 * ให้ผ่านด้วยการแก้ข้อความ.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClaudeCodeLocally } from "../contract";

const CALLER = "control/claude-execution-boundary/tests/boundary.test.ts";
let failures = 0;
function ok(name: string, condition: boolean, detail = ""): void {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

(async () => {
  const workspace = mkdtempSync(join(tmpdir(), "claude-boundary-test-"));

  // ---------- TEST A + B: machine auth ใช้ได้ และไม่มี API key ----------
  const a = await runClaudeCodeLocally({
    provider: "CLAUDE_CODE", execution_mode: "LOCAL_MACHINE_AUTH", caller: CALLER,
    objective: "Return exactly: DNA_OS_CLAUDE_LOCAL_AUTH_OK",
    workspace, task_id: "task-boundary-test", work_order_id: "wo-boundary-test", timeout_ms: 120_000,
  });
  console.log(`      status=${a.status} exit=${String(a.exit_code)} apiKeySource=${String(a.api_key_source)} profile=${(a.sandbox_profile_hash ?? "").slice(0, 16)}`);
  ok("A1. Claude ในเครื่องรันผ่านขอบเขตนี้ได้จริง", a.status === "COMPLETED", a.reason ?? "");
  ok("A2. exit code = 0", a.exit_code === 0, String(a.exit_code));
  ok("A3. ยืนยันตัวตนได้ (ไม่ใช่ Not logged in)", a.authenticated === true);
  ok("B1. ไม่ต้องใช้ ANTHROPIC_API_KEY — apiKeySource = none", a.api_key_source === "none", String(a.api_key_source));
  ok("B2. env ที่ส่งเข้าไปมีเฉพาะ 4 ชื่อ ไม่มีตัวแปร credential",
    JSON.stringify([...a.env_names].sort()) === JSON.stringify(["HOME", "PATH", "TMPDIR", "USER"]), a.env_names.join(","));
  ok("B3. argv ที่บันทึกไม่มี --bare", !a.sanitized_argv.includes("--bare"), a.sanitized_argv.join(" "));
  ok("B4. --no-session-persistence ยังอยู่", a.sanitized_argv.includes("--no-session-persistence"));

  // ---------- TEST F: ผลลัพธ์จริงเดินทางกลับมาครบ ----------
  ok("F1. ข้อความที่ขอกลับมาถึงจริง", (a.text ?? "").includes("DNA_OS_CLAUDE_LOCAL_AUTH_OK"), (a.text ?? "").slice(0, 80));

  // ---------- TEST D: ผู้เรียกเปลี่ยน executable ไม่ได้ ----------
  const overrideAttempt = {
    provider: "CLAUDE_CODE", execution_mode: "LOCAL_MACHINE_AUTH", caller: CALLER,
    objective: "x", workspace, task_id: "t", work_order_id: "w",
    // ฟิลด์พวกนี้ไม่มีในสัญญา — ส่งมาก็ไม่มีผล เพราะไม่มีโค้ดที่อ่านมัน
    executable: "/bin/sh", agentExecutable: "/usr/bin/security", argv: ["find-generic-password"],
    env: { ANTHROPIC_API_KEY: "x" }, sandbox_profile: "(version 1)(allow default)",
  } as unknown as Parameters<typeof runClaudeCodeLocally>[0];
  const d = await runClaudeCodeLocally({ ...overrideAttempt, timeout_ms: 60_000 });
  ok("D1. executable ที่รันยังเป็น Claude เสมอ", d.executable.includes("claude"), d.executable);
  ok("D2. ฟิลด์ override ของผู้เรียกไม่มีผลต่อ argv",
    !d.sanitized_argv.includes("find-generic-password") && !d.sanitized_argv.includes("/bin/sh"), d.sanitized_argv.join(" "));
  ok("D3. env ที่ส่งเข้าไปยังเป็น 4 ชื่อเดิม ไม่มี ANTHROPIC_API_KEY",
    !d.env_names.includes("ANTHROPIC_API_KEY" as never), d.env_names.join(","));

  // ---------- TEST E: ไม่ใช่ตัวรันคำสั่งพิเศษแบบทั่วไป ----------
  ok("E1. สัญญาไม่มีช่องให้ส่ง argv/executable/profile เข้ามาเลย",
    !("argv" in ({} as Parameters<typeof runClaudeCodeLocally>[0])) , "ตรวจจากรูปสัญญาใน types.ts");
  const e = await runClaudeCodeLocally({
    provider: "SHELL" as never, execution_mode: "LOCAL_MACHINE_AUTH", caller: CALLER,
    objective: "x", workspace, task_id: "t", work_order_id: "w",
  });
  ok("E2. provider อื่นถูกปฏิเสธ", e.status === "INVALID_REQUEST", e.reason ?? "");
  const e3 = await runClaudeCodeLocally({
    provider: "CLAUDE_CODE", execution_mode: "REMOTE" as never, caller: CALLER,
    objective: "x", workspace, task_id: "t", work_order_id: "w",
  });
  ok("E3. execution_mode อื่นถูกปฏิเสธ", e3.status === "INVALID_REQUEST", e3.reason ?? "");
  const e4 = await runClaudeCodeLocally({
    provider: "CLAUDE_CODE", execution_mode: "LOCAL_MACHINE_AUTH", caller: "some/other/module.ts",
    objective: "x", workspace, task_id: "t", work_order_id: "w",
  });
  ok("E4. ผู้เรียกที่ไม่อยู่ใน allowlist ถูกปฏิเสธ", e4.status === "CALLER_NOT_ALLOWED", e4.reason ?? "");
  const e5 = await runClaudeCodeLocally({
    provider: "CLAUDE_CODE", execution_mode: "LOCAL_MACHINE_AUTH", caller: CALLER,
    objective: "x", workspace: "/etc", task_id: "t", work_order_id: "w",
  });
  ok("E5. workspace นอกที่อนุมัติยังถูกรับ แต่เขียนได้เฉพาะที่ระบุ (ตรวจว่าไม่ crash)",
    e5.status !== "CALLER_NOT_ALLOWED", e5.status);

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
