/**
 * ai-worker-env-isolation-test.ts — I-2 TEST CONTRACT (owner 2026-10-18)
 *
 * พิสูจน์กับฟังก์ชันจริงของ app/api/chat/_lib/clineWorker.ts (ไม่ mock, ไม่ network):
 *   1. WORKER ทำงานด้วย Environment จำเป็นเท่านั้น — default-deny allowlist
 *   2. ไม่มี SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL / Railway Token /
 *      Owner Credential / Session Secret / Provider credential ใด ๆ
 *   3. Proxy + Permission เดิมทำงาน: local auth proxy ยอมเฉพาะ 2 path ของ MCP
 *      (เงื่อนไขเดิมทุกตัวอักษร — handler จริงเรียก isProxyPathAllowed)
 *   4. เครื่องมือ/สายที่ไม่ได้รับอนุญาตถูกปฏิเสธ (deny ก่อนเกิด request)
 *   5. Parse ผลจริงของ worker ยัง fail-closed (ข้อความผู้ให้บริการ ≠ คำตอบธุรกิจ)
 *   6. สายผลชั้น sanitize: Cline ไม่มี authority สร้างรูปผลนอก ChatResult
 *
 * Run: npx tsx scripts/ai-worker-env-isolation-test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractClineJson,
  isProxyPathAllowed,
  parseClineRunOutput,
  resolveClineBin,
  resolveWorkerChildEnv,
  sanitizeClineResult,
} from "../app/api/chat/_lib/clineWorker";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const source = readFileSync(join(ROOT, "app/api/chat/_lib/clineWorker.ts"), "utf8");

// ── 1. Environment isolation — จำเป็นมี, ห้ามมีหมด ──────────────────────────
const fakeServerEnv = {
  SUPABASE_SERVICE_ROLE_KEY: "secret-supabase",
  NEXT_PUBLIC_SUPABASE_URL: "https://secret.supabase.co",
  SUPABASE_URL2: "x",
  DATABASE_URL: "postgres://secret",
  POSTGRES_DB: "secret",
  RAILWAY_TOKEN: "sk-railway-secret",
  RAILWAY_ENVIRONMENT: "production",
  OWNER_EMAIL: "owner-secret",
  DNA_OS_OWNER_COOKIE: "cookie-secret",
  SESSION_SECRET: "session-secret",
  JWT_SECRET: "jwt-secret",
  OPENAI_API_KEY: "sk-openai-secret",
  ANTHROPIC_API_KEY: "sk-anthropic-secret",
  STRIPE_SECRET_KEY: "sk-stripe-secret",
  LINE_CHANNEL_ACCESS_TOKEN: "line-secret",
  GITHUB_TOKEN: "ghp-secret",
  SOME_RANDOM_SECRET: "unknown-secret",
  RANDOM_VALUE_FROM_SERVER: "leak-attempt",
  // อันที่จำเป็นจริง (จะได้กับของมีคุณค่า)
  PATH: "/usr/local/bin:/usr/bin",
  HOME: "/Users/tam",
  SHELL: "/bin/zsh",
  LANG: "en_US.UTF-8",
  TMPDIR: "/tmp",
  TZ: "Asia/Bangkok",
  TERM: "xterm",
  USER: "tam",
};
const childEnv = resolveWorkerChildEnv(fakeServerEnv as unknown as NodeJS.ProcessEnv);
const forbiddenKeys = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL2",
  "DATABASE_URL",
  "POSTGRES_DB",
  "RAILWAY_TOKEN",
  "RAILWAY_ENVIRONMENT",
  "OWNER_EMAIL",
  "DNA_OS_OWNER_COOKIE",
  "SESSION_SECRET",
  "JWT_SECRET",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "STRIPE_SECRET_KEY",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "GITHUB_TOKEN",
  "SOME_RANDOM_SECRET",
  "RANDOM_VALUE_FROM_SERVER",
];
check("child env ห้ามมี SUPABASE_SERVICE_ROLE_KEY/credential ใด ๆ ทั้ง 18 ชื่อ",
  forbiddenKeys.every((k) => !(k in childEnv)),
  Object.keys(childEnv).filter((k) => forbiddenKeys.includes(k)).join(","));
check("child env default-deny: ตัวแปรที่ไม่รู้จักไม่ผ่านเข้าเด็ก",
  !("RANDOM_VALUE_FROM_SERVER" in childEnv) && !("SOME_RANDOM_SECRET" in childEnv));
check("child env ยังมีจำเป็น: PATH/HOME/LANG/TMPDIR/TZ/TERM",
  ["PATH", "HOME", "LANG", "TMPDIR", "TZ", "TERM"].every((k) => typeof childEnv[k] === "string" && childEnv[k] !== ""));
check("child env NO_PROXY มี 127.0.0.1+localhost เสมอ (เข้า local proxy ได้แน่)",
  typeof childEnv.NO_PROXY === "string" &&
    childEnv.NO_PROXY.includes("127.0.0.1") &&
    childEnv.NO_PROXY.includes("localhost"));

// ── 2. Credential filtering — defense-in-depth ──────────────────────────────
const sneaky = resolveWorkerChildEnv({ SUPABASE_2: "x", RAILWAY_1: "y" } as unknown as NodeJS.ProcessEnv);
check("defense-in-depth: ชื่อแบบ SUPABASE_*/RAILWAY_* หลุดออกตาม deny-list ตัว",
  !("SUPABASE_2" in sneaky) && !("RAILWAY_1" in sneaky));

// ── 3. Missing dependency — fail-closed ─────────────────────────────────────
const saved = process.env.CLINE_BIN;
process.env.CLINE_BIN = "/nonexistent-path/cline";
check("resolveClineBin: ตัด binary ที่สาย override ชี้ไม่ได้ (fallback/null — ไม่เรียก path พังเลยฝัน)",
  resolveClineBin() !== "/nonexistent-path/cline");
process.env.CLINE_BIN = saved;
check("resolveClineBin: binary จริงมี = path ที่กำหนด (positive path ยังทำงาน)", typeof resolveClineBin() === "string" && resolveClineBin() !== "");

// ── 4. Proxy + Permission เดิมยังทำงาน (2 path เท่านั้น) ────────────────────
check("proxy allowlist: GET/POST /api/v1/mcp/manifest อนุญาต", isProxyPathAllowed("/api/v1/mcp/manifest"));
check("proxy allowlist: /api/v1/mcp/business/dispatch (+query) อนุญาต",
  isProxyPathAllowed("/api/v1/mcp/business/dispatch") && isProxyPathAllowed("/api/v1/mcp/business/dispatch?x=1"));
for (const deniedPath of ["/", "/api/admin/ide/file", "/api/v1/mcp/other", "/api/chat", "/api/v1/mcp/business"]) {
  check(`proxy deny: ${deniedPath} ถูกปฏิเสธก่อนเกิด request`, !isProxyPathAllowed(deniedPath));
}
check("handler จริงเรียก isProxyPathAllowed (ไม่มีสายเดาข้าม)",
  source.includes("isProxyPathAllowed(url)") && !/const allowed = url === " \/api\/v1\/mcp\/manifest"/.test(source));

// ── 5. Owner Authority แนบฝั่ง server เท่านั้น + spawn ใช้ allowlist ──────────
check("spawn ใน worker ใช้ resolveWorkerChildEnv (ไม่ใช่ { ...process.env })",
  source.includes("resolveWorkerChildEnv(process.env)") && !source.includes("NodeJS.ProcessEnv = { ...process.env }"));
check("worker แนบ Owner cookie เฉพาะใน proxy upstream (cookie ไม่ออกจาก process)",
  source.includes("opts.transport.cookie) headers.cookie") && !source.includes("headers.cookie = process"));

// ── 6. Parse/sanitize ผลที่คืน (Structured Result ก่อน Response Gateway) ────
const creditText = "Insufficient balance — please top up your cline account credit plan";
check("parseClineRunOutput: ข้อความ 'ผู้ให้บริการหมดแครดิต' = null (ห้ามเป็นคำตอบธุรกิจ)",
  parseClineRunOutput(`\n{"type":"run_result","text":"${creditText}","usage":{}}\n`) === null);
const runOut = parseClineRunOutput(
  `\n{"type":"run_result","text":"{\\"answer\\":\\"ok\\",\\"result\\":null,\\"ask\\":null}","usage":{}}\n`,
);
check("parseClineRunOutput + extractClineJson + sanitizeClineResult: JSON จริง → structured path ทำงาน",
  JSON.stringify(extractClineJson(runOut?.text ?? "") ?? {}) === JSON.stringify({ answer: "ok", result: null, ask: null }));
check("sanitizeClineResult: ผลที่ใช้ไม่ได้ (path .. / type นอก contract) = null",
  sanitizeClineResult({ type: "file", name: "x", path: "/a/../secret", mime: "text", size: 1 }) === null);
check("sanitizeClineResult: ผลที่ใช้ได้ (table จาก business.dispatch) = ผ่าน",
  sanitizeClineResult({ type: "table", title: "t", table: { columns: [{ key: "c1", label: "a" }], rows: [["1"]] } }) !== null);

// ── 7. ไม่ส่ง credential เป็นข้อความให้โมเดล (ห้ามพิมพ์ค่าจริงลง prompt) ──
check("system prompt ปฏิเสธการพิมพ์ค่า secret ตัวตั้งเดิมทั้ง 2 กติกาล",
  /ห้ามพิมพ์\/คายค่าจริงของ session ลงในข้อความ/.test(source) &&
    source.includes("ห้ามแนบ header เพิ่ม") &&
    source.includes("cookie ไม่เคยออกจาก worker process")),

console.log(`\n=== ai-worker-env-isolation: PASS ${pass} · FAIL ${fail} ===`);
if (fail > 0) process.exit(1);
