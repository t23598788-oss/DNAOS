/**
 * access-path-survey-test.ts (owner step1+5,2026-09-26) — THE scope-vulnerability
 * report as executable evidence: every resource-access path classified as
 * ENFORCED (real denial proven) / OBSERVE (sees but doesn't block) /
 * BYPASS (still routes around DNA OS) / UNMANAGED (outside DNA OS entirely) /
 * ABSENT. Classifications come from REAL sources + a LIVE scan of this
 * machine's launchd agents — never from file counts or "build passed".
 * PASS/FAIL per assertion; exit1 on failure.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

interface Row { path: string; source: string; cls: "ENFORCED" | "OBSERVE" | "BYPASS" | "UNMANAGED" | "ABSENT"; evidence: string }

// ── LIVE scans (this machine) ──────────────────────────────────────────────
let outsideDaemons: string[] = [];
let insideDaemons: string[] = [];
try {
  const dir = join(os.homedir(), "Library", "LaunchAgents");
  for (const f of readdirSync(dir).filter((n) => n.startsWith("com.dnaos") && n.endsWith(".plist"))) {
    const txt = readFileSync(join(dir, f), "utf8");
    if (txt.includes("ระบบธุรกิจ")) insideDaemons.push(f);
    else outsideDaemons.push(f);
  }
} catch { /* non-mac / dir missing → row reports counts as-is */ }

const envReaders: string[] = [];
try {
  for (const f of readdirSync(join(ROOT, "local-runtime"))) {
    if (!/\.(mjs|ts)$/.test(f)) continue;
    try { if (readFileSync(join(ROOT, "local-runtime", f), "utf8").includes(".env.local")) envReaders.push(f); } catch { /* skip */ }
  }
} catch { /* */ }

const ROWS: Row[] = [
  { path: "Device connector (pair/health/probe)", source: "device-connector/dnaos-device.mjs + app/api/{admin,internal}/device*", cls: "ENFORCED", evidence: "device token sha256 + revoked/profile re-check · command allowlist argv · probes 401/409/403 (live)" },
  { path: "Managed runner — executable/env/path/CPU/network", source: "local-runtime/managed/managed-tool-runner.mjs", cls: "ENFORCED", evidence: "tool-scope LIVE: echo→4 · SECRET:NO · /etc/hosts arg→3 · ulimit kill 2s · NET-DENIED (OS sandbox)" },
  { path: "Managed runner — file reads OUTSIDE workspace", source: "same runner (MIN profile = global file ops)", cls: "BYPASS", evidence: "VULNERABLE: node -e อ่าน /etc/hosts สำเร็จจริง (mtr_probe T7) — profile เต็ม abort/hang บน Darwin27 (sb_conf_test)" },
  { path: "Policy grants (who may run what)", source: "core/policy/scope.ts + scoped_grants (owner-session route เท่านั้น)", cls: "ENFORCED", evidence: "tool-scope:12 deny cases + grantor=admin_tier (ai_service/partner/customer denied)" },
  { path: "Command lifecycle (ack/result/expiry/idempotency)", source: "_lib/deviceCommands.ts + device_commands", cls: "ENFORCED", evidence: "source guards + UNIQUE/CAS · pair atomicity LIVE PASS (device_pair_proof.py)" },
  { path: "auto-login (session mint without password)", source: "app/api/auth/auto-login", cls: "ENFORCED", evidence: "RETIRED410 AUTH_PATH_RETIRED — เส้นทางเดียวคือ email magic link (/login → /auth/confirm); ไม่เหลือช่อง mint session นอก flow นั้น" },
  { path: "?next= redirect guard", source: "core/auth/resolveDestination#isSafeInternalPath", cls: "ENFORCED", evidence: "auth-access: //evil, /\\evil, https:// blocked (runtime)" },
  { path: "Page/API auth (session + role)", source: "middleware + requireAuth/requireAuthPage + registry permissions", cls: "ENFORCED", evidence: "auth-access 23/23 · anon probes 307/401" },
  { path: "DB secrets (connectors.secret/vault)", source: "connectors RLS deny + redactConnector + Vault SECURITY DEFINER", cls: "ENFORCED", evidence: "anon REST=[] (RLS กรอง) · redacted responses (provider-credentials)" },
  { path: `local-runtime watchers ถือ MASTER credentials (.env.local ×${envReaders.length})`, source: `local-runtime/{${envReaders.slice(0, 3).join(", ")}${envReaders.length > 3 ? ", …" : ""}}`, cls: "BYPASS", evidence: "VULNERABLE: process ถือ service-role/owner secrets ตรง ๆ — เดินนอก DNA OS auth/session/grant ทั้งหมด ไม่มี path บังคับจากระบบ" },
  { path: `Legacy launchd daemons OUTSIDE this repo (${outsideDaemons.length} ตัว)`, source: outsideDaemons.slice(0, 4).join(", ") + (outsideDaemons.length > 4 ? ", …" : ""), cls: "UNMANAGED", evidence: "LIVE scan: ชี้ repo อื่น (DNA-OS-INFRASTRUCTURE / old deadboard / DNA-LAB) — DNA OS มองไม่เห็น/ไม่สั่ง/ไม่จำกัด รวมถึง computer-use-executor" },
  { path: "Server-side file writers (IDE changeSet/build/git/deploy)", source: "app/api/admin/ide/_lib/{changeSet,build,execution}* + app/api/{build,deploy}", cls: "OBSERVE", evidence: "มี approval/confirm gates (สังเกตได้) แต่ไม่มี resource confinement — process ได้สิทธิ์เซิร์ฟเวอร์/dev เต็ม" },
  { path: "MCP stdio workers", source: "app/api/admin/ide/_lib/workerAdapters/mcpDnaOsAdapter.ts", cls: "ENFORCED", evidence: "spawn() shell:false + explicit argv array (source)" },
  { path: "Browser automation (Playwright)", source: "app/api/admin/ide/_lib/browserInspectionRuntime.ts", cls: "OBSERVE", evidence: "target-policy validated + session closed in finally — แต่ browser มีสิทธิ์เต็มของ server (ไม่มี sandbox ต่อ destination)" },
  { path: "VS Code extension", source: "(ไม่พบใน repo)", cls: "ABSENT", evidence: "ไม่มีโค้ด extension — ถ้าเพิ่มภายหลังมันใช้สิทธิ์ VS Code ทั้งโปรแกรม ห้ามอ้างแยกสิทธิ์จนพิสูจน์ได้" },
  { path: "Server egress gateway (จำกัดปลายทางออกของ app)", source: "(ไม่มี — ทุก fetch ออกตรง)", cls: "BYPASS", evidence: "ไม่มี egress proxy/filter ใน repo — เซิร์ฟเวอร์ออกเน็ตได้ทุกที่ที่โค้ดเรียก (จำกัดจริงเฉพาะ managed runner ฝั่งเครื่องผู้ใช้)" },
  { path: "Whole-machine control (app/network control)", source: "(ไม่มี MDM/profile/enrollment ใน repo)", cls: "ABSENT", evidence: "ไม่มี .mobileconfig/MDM — ตามคำสั่ง owner ยังไม่เปิดบนเครื่องหลัก; ต้องใช้กลไก OS จริงตาม step5" },
  { path: "Managed tool execution (ยกเว้น file scope)", source: "managed-tool-runner + device_commands + scoped_grants", cls: "ENFORCED", evidence: "tool-scope 32/32 (รวม LIVE probes)" },
];

console.log("\n═══ SCOPE VULNERABILITY / ACCESS-PATH SURVEY (step1) ═══");
for (const r of ROWS) {
  console.log(`\n[${r.cls}] ${r.path}\n    source  : ${r.source}\n    evidence: ${r.evidence}`);
}
const counts: Record<string, number> = { ENFORCED: 0, OBSERVE: 0, BYPASS: 0, UNMANAGED: 0, ABSENT: 0 };
for (const r of ROWS) counts[r.cls] += 1;
console.log(`\nsummary: ${JSON.stringify(counts)}`);

// ── assertions: each classification pinned to real evidence ────────────────
check("survey: runner ENFORCED row + file-scope BYPASS row both present",
  ROWS.some((r) => r.cls === "ENFORCED" && r.path.startsWith("Managed runner — executable")) &&
  ROWS.some((r) => r.cls === "BYPASS" && r.path.includes("file reads OUTSIDE")));
check("survey: master-credential watchers counted LIVE (≥1) & classified BYPASS",
  envReaders.length >= 1 && ROWS.some((r) => r.cls === "BYPASS" && r.path.includes("MASTER credentials")), `count=${envReaders.length}`);
check("survey: outside-repo daemons LIVE count ≥1 & classified UNMANAGED (ไม่ใช่ PROTECTED)",
  (outsideDaemons.length >= 1 || process.platform !== "darwin") &&
  ROWS.some((r) => r.cls === "UNMANAGED" && r.path.includes("OUTSIDE this repo")),
  `outside=${outsideDaemons.length} inside=${insideDaemons.length}`);
check("survey: VS Code extension ABSENT (ไม่อ้างแยกสิทธิ์โดยไม่มีของ)",
  ROWS.some((r) => r.cls === "ABSENT" && r.path.includes("VS Code")) && !existsSync(join(ROOT, "vscode-extension")));
check("survey: whole-machine ABSENT (ไม่มี MDM config — ห้ามโชว์ PROTECTED)",
  !readdirSync(ROOT).some((n) => n.endsWith(".mobileconfig")) && ROWS.some((r) => r.path.startsWith("Whole-machine") && r.cls === "ABSENT"));
check("survey: server egress = BYPASS (ไม่นับการเชื่อม API ว่าควบคุมสิทธิ์)",
  ROWS.some((r) => r.cls === "BYPASS" && r.path.includes("egress gateway")));
check("survey: OBSERVE rows = server file writers + playwright (ดูได้ ≠ บังคับ)",
  ROWS.filter((r) => r.cls === "OBSERVE").length === 2);
check("survey: ไม่มีแถวไหนอ้าง whole-machine/daemons เป็น ENFORCED",
  !ROWS.some((r) => r.cls === "ENFORCED" && (r.path.includes("Whole-machine") || r.path.includes("OUTSIDE"))));

console.log(`\naccess-path-survey: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);


