#!/usr/bin/env npx tsx
/**
 * HCG Phase 2.6 (Hook Noise Cleanup) acceptance tests — runs the REAL
 * scripts/hardcode-precommit-hook.ts as a child process via stdin/stdout,
 * the same way Claude Code's PreToolUse hook actually invokes it. Not a
 * simulation against internal functions — this is the real script.
 */
import { spawnSync } from "child_process";
import { join } from "path";

const ROOT = join(__dirname, "..");
const HOOK = join(ROOT, "scripts", "hardcode-precommit-hook.ts");

let pass = 0;
let fail = 0;

function runHook(toolName: string, filePath: string, content: string): { systemMessage?: string; deny: boolean } {
  const input = JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath, content } });
  const result = spawnSync("npx", ["tsx", HOOK], { input, cwd: ROOT, encoding: "utf-8" });
  const out = (result.stdout || "").trim();
  if (!out) return { deny: false };
  const parsed = JSON.parse(out);
  return {
    systemMessage: parsed.systemMessage,
    deny: parsed.hookSpecificOutput?.permissionDecision === "deny",
  };
}

function check(name: string, condition: boolean, detail: string) {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} — ${detail}`);
  }
}

console.log("\nHCG Phase 2.6 — Hook Noise Cleanup acceptance tests\n" + "=".repeat(60));

// 1. HTTP status 404 -> ALLOW, no warning
{
  const r = runHook("Write", join(ROOT, "services/case1.ts"), "const status = 404;");
  check("1. HTTP 404 -> ALLOW, no output/warning", !r.deny && !r.systemMessage, JSON.stringify(r));
}

// 2. Allowed MIME type -> ALLOW, no warning
{
  const r = runHook("Write", join(ROOT, "services/case2.ts"), 'const contentType = "application/json";');
  check("2. MIME type -> ALLOW, no output/warning", !r.deny && !r.systemMessage, JSON.stringify(r));
}

// 3. Password literal -> DENY
{
  const r = runHook("Write", join(ROOT, "services/case3.ts"), 'const password = "SuperSecret123!";');
  check("3. Password literal -> DENY", r.deny, JSON.stringify(r));
}

// 4. API key -> DENY
{
  const r = runHook("Write", join(ROOT, "services/case4.ts"), 'const api_key = "AIzaSyD1234567890abcdefghijk";');
  check("4. API key -> DENY", r.deny, JSON.stringify(r));
}

// 5. Price/threshold -> WARN (allow, but with a systemMessage)
{
  const r = runHook("Write", join(ROOT, "engines/debt/case5.ts"), "const debt_threshold = 5000;");
  check("5a. Threshold -> WARN (allow + message)", !r.deny && !!r.systemMessage, JSON.stringify(r));
  const r2 = runHook("Write", join(ROOT, "engines/debt/case5b.ts"), "const ราคา = 1500;");
  check("5b. ราคา -> WARN (allow + message)", !r2.deny && !!r2.systemMessage, JSON.stringify(r2));
}

// 6. Unknown value -> WARN as UNKNOWN
{
  const r = runHook("Write", join(ROOT, "services/case6.ts"), 'const zzqxFoo = "flerbnorp9912xyz";');
  check(
    "6. Unknown value -> WARN (allow + message mentioning UNKNOWN)",
    !r.deny && !!r.systemMessage && /UNKNOWN/.test(r.systemMessage!),
    JSON.stringify(r)
  );
}

// 7. Secret OUTSIDE critical path -> unchanged behavior (allow, silent, not even scanned)
{
  const r = runHook("Write", join(ROOT, "components/case7.ts"), 'const apiKey = "sk_live_ABCDEF1234567890abcdef";');
  check("7. Secret outside critical path -> ALLOW, silent (out of scope, unchanged)", !r.deny && !r.systemMessage, JSON.stringify(r));
}

// 8. Clean edit in critical path -> ALLOW, no output at all
{
  const r = runHook("Edit", join(ROOT, "gateway/case8.ts"), "const x = 1;\nexport function noop() {}\n");
  check("8. Clean critical-path edit -> ALLOW, no output", !r.deny && !r.systemMessage, JSON.stringify(r));
}

console.log("=".repeat(60));
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
