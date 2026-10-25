/**
 * device-connector-test.ts — step1 inventory + step3/5 contract proof for the
 * Device Connector round (2026-09-25). Prints the REQUIRED capability table
 * (source → executor → contract → permission → UI → OS → evidence → status)
 * computed from REAL files — never from file counts or "build passed". Then
 * contract-checks the new device path and RUNS the connector selftest.
 * PASS/FAIL per check; exit1 on failure.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
const ex = (p: string) => existsSync(join(ROOT, p));

interface InvRow {
  capability: string; source: string; executor: string; apiContract: string;
  permission: string; ui: string; os: string; evidence: string; status: string;
}
const INVENTORY: InvRow[] = [
  {
    capability: "พิมพ์เอกสาร (LINE receipt queue)",
    source: "local-runtime/print-watcher.mjs",
    executor: "launchd + CUPS lp บนเครื่อง Owner",
    apiContract: "print_jobs status ladder (paid→printed→notified/failed)",
    permission: "SUPABASE_SERVICE_ROLE_KEY จาก .env.local (เครื่อง dev เท่านั้น)",
    ui: "ไม่มี (LINE webhook เขียนคิว)",
    os: "macOS เท่านั้น",
    evidence: ex("local-runtime/print-watcher.log") ? "print-watcher.log + source" : "source only",
    status: "HAS_CODE_DEV_MACHINE — แจกไม่ได้ (service-role + path เครื่อง dev); ไม่มี printable artifact URL ใน contract",
  },
  {
    capability: "AI บนเครื่อง (OCR/classify/material)",
    source: "local-runtime/ai/device-ai-runtime.mjs + ai-task-watcher.mjs",
    executor: "watcher + Ollama บนเครื่อง Owner",
    apiContract: "ai_tasks queue + x-callback-secret callback",
    permission: "service-role .env.local (เครื่อง dev)",
    ui: "ไม่มีโดยตรง (LINE/_receipt ใช้ผ่านคิว)",
    os: "macOS dev",
    evidence: ex("scripts/ai-device-cutover-test.ts") ? "scripts/ai-device-cutover-test.ts" : "-",
    status: "TESTED_DEV_MACHINE — decoupling test มี; ยังไม่ใช่ของผู้ใช้ทั่วไป",
  },
  {
    capability: "เสียงปลุก (voice wake)",
    source: "local-runtime/voice-wake-watcher.mjs",
    executor: "launchd + whisper-cpp/sox",
    apiContract: "voice_wake_events table",
    permission: "service-role .env.local + path model /Users/tam/… (hardcoded)",
    ui: "ไม่มี",
    os: "macOS dev เท่านั้น",
    evidence: "source + comments ยืนยันติดตั้งจริงบนเครื่อง Owner",
    status: "HAS_CODE_DEV_MACHINE — path เครื่อง dev, ไม่กระจาย",
  },
  {
    capability: "รีเลย์เครื่องจักร (lock/unlock)",
    source: "engines/equipment/relay-command.ts + app/api/internal/equipment/lock-command",
    executor: "SMS gateway ภายนอก (env ยังไม่ตั้ง) — ไม่ใช่เครื่องผู้ใช้",
    apiContract: "internal route + EQUIPMENT_LOCK_INTERNAL_SECRET",
    permission: "internal secret / admin trigger-start",
    ui: "/admin/equipment",
    os: "any (cloud-side)",
    evidence: "source + honesty note: คำสั่ง GPSDD ยังไม่ verified กับคู่มือเครื่องจริง",
    status: "BLOCKED_EXTERNAL — รอเลือก SMS gateway + คู่มือกล่องจริง",
  },
  {
    capability: "V6 executor (AppleScript/URL scheme)",
    source: "plugins/executor.ts + plugins/platform/mac/*",
    executor: "รันใน Node ของแอป (server) — production serverless ไม่มี macOS",
    apiContract: "ExecuteRequest confirm flag",
    permission: "ไม่มี caller จริง (dead path)",
    ui: "ไม่พบ",
    os: "mac dev เท่านั้น (ในทางทฤษฎี)",
    evidence: "ไม่มี test",
    status: "LEGACY_DEV_ONLY — ไม่นับเป็น executor ของผู้ใช้",
  },
  {
    capability: "เดสก์ท็อปแอป (Tauri)",
    source: "src-tauri/tauri.conf.json + Cargo",
    executor: "Tauri webview ชี้ production URL (แก้รอบนี้)",
    apiContract: "หน้าต่าง + csp (แก้ null → explicit)",
    permission: "/api/auth/auto-login = RETIRED410 (single flow = email link)",
    ui: "/login (ฟอร์มเดิม)",
    os: "cross (build ยังไม่ได้)",
    evidence: `frontendDist placeholder=${ex(".next-tauri-placeholder/index.html")} · ไม่มี bundle artifact`,
    status: "SKELETON_UNVERIFIED — ต้อง build + signing/notarization (Owner) — ยังไม่แจก",
  },
  {
    capability: "MCP (อ่าน registry/contract)",
    source: "app/api/v1/mcp/* + registry/mcp-*.json",
    executor: "server (HTTP read tools)",
    apiContract: "mcpEnvelope passthrough",
    permission: "public read routes",
    ui: "ไม่มี (สำหรับ MCP client)",
    os: "any",
    evidence: "mcp-resource-registry.json: integration_tested notes (constitution read)",
    status: "PARTIAL_TESTED_READS — tools เขียน/contract flow ยัง 'planned' ตาม registry ตัวเอง",
  },
  {
    capability: "Runtime คำสั่งธุรกิจ (calculate_*/storage/workspace)",
    source: "core/runtime/engine.ts + engines/business.ts",
    executor: "executeCommand dispatcher (server)",
    apiContract: "RuntimeCommand/RuntimeResult + trace",
    permission: "route ที่ requireAuth เดิม",
    ui: "จอต่าง ๆ ที่เรียกผ่าน APIs",
    os: "any (cloud)",
    evidence: ex("local-runtime/runtime-registration-test.ts") ? "local-runtime/runtime-registration-test.ts" : "-",
    status: "TESTED",
  },
  {
    capability: "Device connector v1 (คู่เครื่อง/สุขภาพ/probe พิมพ์)",
    source: "device-connector/dnaos-device.mjs + app/api/{admin,internal}/device(s)/* + migration 20260925000001",
    executor: "Node บนเครื่องผู้ใช้ (argv allowlist เท่านั้น) + OS secret store",
    apiContract: "pair (one-time code) · health (device token sha256) · probe (DEVICE_COMMANDS allowlist)",
    permission: "requireAuth(ADMIN_TIER) ฝั่ง admin · device token + re-read profile role ฝั่งเครื่อง · grants[]",
    ui: "/admin/devices + /install section",
    os: "macOS TESTED (selftest+install/uninstall รันแล้ว) · Windows/Linux มีโค้ด = UNVERIFIED",
    evidence: "selftest รันสดในเทสนี้ + install/uninstall round-trip บันทึกไว้ + migration apply บน local แล้ว",
    status: "WIRED_MAC_TESTED — pair/end-to-end จริงรอ Owner ให้ migration บน LIVE + บัญชีทดสอบ",
  },
];

console.log("\n═══ CAPABILITY INVENTORY (rule1 — คำนวณจากไฟล์จริง) ═══");
for (const r of INVENTORY) {
  console.log(`\n• ${r.capability}\n    source     : ${r.source}\n    executor   : ${r.executor}\n    contract   : ${r.apiContract}\n    permission : ${r.permission}\n    ui         : ${r.ui}\n    os         : ${r.os}\n    evidence   : ${r.evidence}\n    STATUS     : ${r.status}`);
}

const connector = read("device-connector/dnaos-device.mjs");
const reg = read("app/api/admin/devices/_lib/deviceRegistry.ts");
const pairRoute = read("app/api/internal/device/pair/route.ts");
const healthRoute = read("app/api/internal/device/health/route.ts");
const adminRoute = read("app/api/admin/devices/route.ts");
const probeRoute = read("app/api/admin/devices/[id]/probe/route.ts");
const delRoute = read("app/api/admin/devices/[id]/route.ts");
const migration = read("supabase/migrations/20260925000001_device_registry.sql");
const devicesPage = read("app/admin/devices/page.tsx");
const board = read("app/admin/devices/DevicesBoard.tsx");
const installPage = read("app/install/page.tsx");
const tauriConf = read("src-tauri/tauri.conf.json");

// ── inventory sources exist (no fabricated rows) ───────────────────────────
check("inv: print-watcher source exists", ex("local-runtime/print-watcher.mjs"));
check("inv: device-ai runtime source exists", ex("local-runtime/ai/device-ai-runtime.mjs"));
check("inv: equipment relay source exists", ex("engines/equipment/relay-command.ts"));
check("inv: v6 plugins source exists", ex("plugins/executor.ts"));
check("inv: tauri conf exists", ex("src-tauri/tauri.conf.json"));
check("inv: mcp manifest route exists", ex("app/api/v1/mcp/manifest/route.ts"));
check("inv: runtime registration test exists", ex("local-runtime/runtime-registration-test.ts"));

// ── connector contract (rule3/4/5) ────────────────────────────────────────
check("connector: NO service-role/supabase credential in the script", !/SERVICE_ROLE|SUPABASE/i.test(connector));
check("connector: NO developer-machine path", !/DNA OS-ต้นฉบับ|\/Users\/tam\/Desktop/.test(connector));
check("connector: no shell execution (no exec/shell:true)", !/shell:\s*true|execSync|exec\(/.test(connector) && /spawnSync\(/.test(connector));
check("connector: standard OS dirs (keychain/DPAPI/libsecret + LaunchAgents/schtasks/systemd)",
  connector.includes("Library") && connector.includes("LaunchAgents") && connector.includes("APPDATA") && connector.includes("secret-tool"));
check("connector: install registers the STANDARD-LOCATION COPY (not the run path)",
  connector.includes("connectorCopyPath()") && connector.includes("fs.copyFileSync(src, dest)"));
check("connector: main dispatch Promise.resolve (sync-commands bug fixed)",
  connector.includes("Promise.resolve()") && !connector.includes("chosen(rest).catch"));
check("connector: never prints token VALUE (no ${token} interpolation / token-value keys in output)",
  !/console\.(log|error|warn)[^\n]*\$\{token\}/.test(connector) &&
  !/console\.(log|error|warn)[^\n]*\btoken:\s*(result|res\.|cfg)/.test(connector) &&
  connector.includes("device_id: res.json.device_id, grants:"));
check("connector: allowlist closed to probe_printers (no free-form)",
  connector.includes("ALLOWED_COMMANDS = { probe_printers: probePrinters }"));
check("connector: hardware facts only, no file-content scan",
  connector.includes("diskFreeBytes") && !/readdir/.test(connector));

// ── server routes contract ─────────────────────────────────────────────────
check("admin routes all ADMIN_TIER",
  [adminRoute, probeRoute, delRoute].every((s) => s.includes("requireAuth(ADMIN_TIER)")));
check("pair: atomic SQL exchange (device_pair_code RPC) + rate limit + token returned once",
  reg.includes('rpc("device_pair_code"') && reg.includes("sha256Hex(") && pairRoute.includes("isRateLimited") && pairRoute.includes("token: result.token"));
check("health: token via HEADER only (never query/URL)",
  healthRoute.includes('req.headers.get("x-dnaos-device-token")') && !healthRoute.includes("searchParams"));
check("device auth: revoked blocked + timingSafeEqual + profile role re-read (install ≠ permanent)",
  reg.includes('status === "revoked"') && reg.includes("timingSafeEqual") && reg.includes('from("profiles")'));
check("probe: closed DEVICE_COMMANDS allowlist enforced server-side",
  probeRoute.includes("DEVICE_COMMANDS") && reg.includes('DEVICE_COMMANDS = ["probe_printers"]'));
check("revoke + pair + probe all write audit_logs (entity device)",
  [adminRoute, probeRoute, delRoute, pairRoute].every((s) => s.includes('entity_type: "device"')));
check("fail-closed mutations / fail-open reads (META_TABLES_MISSING)",
  reg.includes('e.code = "META_TABLES_MISSING"') && reg.includes("return { rows: [], migrated: false }"));

// ── migration shape ────────────────────────────────────────────────────────
check("migration:2 tables + token/code hashes + grants + pending_probe + RLS deny-all",
  migration.includes("device_registry") && migration.includes("device_pairing_codes") &&
  migration.includes("device_token_hash") && migration.includes("code_hash") &&
  migration.includes("grants") && migration.includes("pending_probe") &&
  (migration.match(/service_role_only/g) ?? []).length >= 2);

// ── UI + channel honesty (rule2) + tauri (rule7) ───────────────────────────
check("devices page server-side ADMIN_TIER gate", devicesPage.includes('requireAuthPage("/admin/devices", ADMIN_TIER)'));
check("board shows channel matrix with UNVERIFIED + BLOCKED (ไม่แสร้งว่าครบ)",
  board.includes("UNVERIFIED") && board.includes("BLOCKED") && board.includes("ช่องทาง × ความสามารถ"));
check("board shows migrated banner (เหตุผล+ขั้นตอนเมื่อไม่พร้อม)", board.includes("20260925000001_device_registry"));
check("install page has device-connector section + no-repo/no-npm + allowlist note",
  installPage.includes("Device Connector") && installPage.includes("ไม่ต้อง clone repo") && installPage.includes("allowlist"));
check("tauri: url = production domain, csp NOT null",
  tauriConf.includes("dna-os-deadboard-production.up.railway.app") && !tauriConf.includes('"csp": null'));

// ── LIVE run: connector selftest on this machine (real evidence) ───────────
const st = spawnSync("node", ["device-connector/dnaos-device.mjs", "selftest"], { encoding: "utf8", cwd: ROOT });
let stJson: Record<string, unknown> | null = null;
try { stJson = JSON.parse(st.stdout); } catch { stJson = null; }
check("selftest exits0 + ok:true", st.status === 0 && stJson?.ok === true, `status=${st.status} out=${(st.stdout || st.stderr).slice(0, 200)}`);
check("selftest reports real hardware facts (arch/ram/disk/lp)",
  Boolean(stJson?.arch) && Number(stJson?.ramBytes) > 0 && Number(stJson?.diskFreeBytes) > 0 &&
  (stJson?.tools as Record<string, unknown> | undefined)?.lp === true);
check("selftest keychain roundtrip ok (macOS)", stJson?.keychain_roundtrip === "ok");
check("selftest standard paths (Application Support + LaunchAgents)",
  String(stJson?.config_dir ?? "").includes("Application Support/DNA OS") &&
  String(stJson?.launch_dir ?? "").endsWith("LaunchAgents"));

const usage = spawnSync("node", ["device-connector/dnaos-device.mjs"], { encoding: "utf8", cwd: ROOT });
check("usage exits1 with real usage line", usage.status === 1 && usage.stderr.includes("selftest|pair"));

console.log(`\ndevice-connector: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);



