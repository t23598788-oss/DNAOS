/**
 * DNA OS Cockpit — ศูนย์บัญชาการ
 *
 * เปิดเครื่อง → เห็นทุกอย่างทันที
 * พิมพ์ why/status/next/cost/risk → ระบบอธิบายตัวเองพร้อมหลักฐาน
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();
const REGISTRY_ROOT = join(ROOT, "../registry");
const SESSION_FILE = join(ROOT, ".dna-session.json");

function load(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf-8")); }
  catch { return {}; }
}

function line(t: string) { console.log(t); }

const statusRegistry = load(join(REGISTRY_ROOT, "10-status-registry.json"));
const infra = statusRegistry; // infrastructure is now part of status-registry
const existence = statusRegistry; // existence data is now part of status-registry
const modules = load(join(REGISTRY_ROOT, "02-module-registry.json"));
const commands = load(join(REGISTRY_ROOT, "06-command-registry.json"));

// ═══════════════════════════════════════════
// SESSION — จำว่าทำถึงไหน
// ═══════════════════════════════════════════

interface Session {
  last_opened: string;
  last_mission: string;
  last_files: string[];
  last_module: string;
  pending_tasks: string[];
  notes: string;
}

function loadSession(): Session | null {
  if (!existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(readFileSync(SESSION_FILE, "utf-8")); }
  catch { return null; }
}

function saveSession(mission: string, files: string[], tasks: string[]) {
  const session: Session = {
    last_opened: new Date().toISOString(),
    last_mission: mission,
    last_files: files,
    last_module: files[0] ?? "",
    pending_tasks: tasks,
    notes: "",
  };
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

// ═══════════════════════════════════════════
// WHY — อธิบายทุกอย่างพร้อมหลักฐาน
// ═══════════════════════════════════════════

interface Evidence {
  source: string;
  finding: string;
}

function why(topic: string) {
  const t = topic.toLowerCase();
  const caps = existence.capabilities ?? {};
  const services = infra.services ?? {};

  line("");
  line(`  ╔═══════════════════════════════════════╗`);
  line(`  ║  WHY: ${topic.padEnd(30)} ║`);
  line(`  ╚═══════════════════════════════════════╝`);

  // Check capabilities
  if (caps[t]) {
    const cap = caps[t];
    line(`  Type: Capability`);
    line(`  Status: ${cap.status}`);
    if (cap.status === "available") {
      line(`  ใช้โดย: ${cap.used_by?.join(", ") ?? "ไม่มี"}`);
      line(`  ผ่าน: ${cap.interfaces?.join(", ") ?? "ไม่มี"}`);
    } else if (cap.status === "not_available") {
      line(`  สาเหตุ: ${cap.gap ?? "ไม่ทราบ"}`);
      line("");
      line("  Evidence:");
      searchEvidence(t).forEach(e => line(`    [${e.source}] ${e.finding}`));
      line("");
      line("  Workflows ที่ได้รับผลกระทบ:");
      if (t === "voice") line("    - เก็บหนี้ → หยุดที่ 'โทรติดตาม'");
      if (t === "camera") line("    - ตรวจหน้างาน → หยุดที่ 'ถ่ายรูป'");
      if (t === "plc") line("    - ตรวจเครื่องจักร → หยุดที่ 'อ่าน sensor'");
      if (t === "mqtt") line("    - IoT monitoring → หยุดที่ 'subscribe topic'");
    }
    return;
  }

  // Check services
  for (const [key, svc] of Object.entries(services) as [string, any][]) {
    if (key.includes(t) || svc.name?.toLowerCase().includes(t)) {
      line(`  Type: External Service`);
      line(`  Name: ${svc.name}`);
      line(`  Organ: ${svc.organ ?? "N/A"}`);
      line(`  Purpose: ${svc.purpose}`);
      line(`  Critical: ${svc.critical}`);
      line(`  Cost: ${svc.cost_monthly_thb} THB/mo`);
      line(`  ถ้าล่ม: ${svc.if_down}`);
      line(`  Workflows: ${svc.affected_workflows?.join(", ") ?? "N/A"}`);
      line("");
      line("  Evidence:");
      searchEvidence(svc.name.toLowerCase()).forEach(e => line(`    [${e.source}] ${e.finding}`));
      return;
    }
  }

  line(`  ไม่พบข้อมูลเกี่ยวกับ "${topic}"`);
  line("  ลองพิมพ์:");
  line("    why voice | why supabase | why maps | why debt | why pricing");
}

function searchEvidence(topic: string): Evidence[] {
  const evidence: Evidence[] = [];

  // Search module registry
  const mods = modules.modules ?? {};
  let modCount = 0;
  for (const [path] of Object.entries(mods)) {
    if (path.toLowerCase().includes(topic)) modCount++;
  }
  evidence.push({ source: "02-module-registry.json", finding: `${modCount} modules match "${topic}"` });

  // Search command registry
  const cmds = commands.commands ?? {};
  let cmdCount = 0;
  for (const [name] of Object.entries(cmds)) {
    if (name.toLowerCase().includes(topic)) cmdCount++;
  }
  evidence.push({ source: "06-command-registry.json", finding: `${cmdCount} commands match "${topic}"` });

  // Search source files
  try {
    const grepResult = execSync(
      `grep -rl "${topic}" --include="*.ts" --include="*.tsx" lib/ app/ 2>/dev/null | wc -l`,
      { encoding: "utf-8", cwd: ROOT }
    ).trim();
    evidence.push({ source: "source code grep", finding: `${grepResult} files reference "${topic}"` });
  } catch {
    evidence.push({ source: "source code grep", finding: "0 files" });
  }

  return evidence;
}

// ═══════════════════════════════════════════
// COCKPIT — หน้าแรก
// ═══════════════════════════════════════════

function renderCockpit() {
  const today = new Date();
  const session = loadSession();
  const services = infra.services ?? {};

  line("");
  line("  ╔══════════════════════════════════════════════════════════╗");
  line("  ║                   DNA OS COCKPIT                        ║");
  line("  ║              ศูนย์บัญชาการ — เปิดมาก็รู้                 ║");
  line("  ╚══════════════════════════════════════════════════════════╝");
  line("");

  // ── Last Session ──
  if (session) {
    const lastDate = new Date(session.last_opened);
    const daysAgo = Math.floor((today.getTime() - lastDate.getTime()) / 86_400_000);
    line(`  LAST SESSION (${daysAgo === 0 ? "วันนี้" : daysAgo + " วันก่อน"})`);
    line(`    Mission:  ${session.last_mission}`);
    if (session.pending_tasks.length > 0) {
      line(`    ค้างอยู่:`);
      for (const task of session.pending_tasks) line(`      - ${task}`);
    }
    line("");
  } else {
    line("  FIRST SESSION — ยินดีต้อนรับครับเฮีย");
    line("");
  }

  // ── Owner Action ──
  line("  OWNER ACTION — วันนี้เฮียต้องทำอะไร");

  const urgent: string[] = [];
  const high: string[] = [];

  // Check backup
  urgent.push("ตั้ง Supabase backup (Resilience 40% → 80%)");

  // Check expirations
  for (const [, s] of Object.entries(services) as [string, any][]) {
    if (s.expiration) {
      const days = Math.floor((new Date(s.expiration).getTime() - today.getTime()) / 86_400_000);
      if (days <= 30) urgent.push(`ต่ออายุ ${s.name} (เหลือ ${days} วัน)`);
    }
    if (s.quota_used_pct >= 80) high.push(`${s.name} quota ${s.quota_used_pct}% — ต้องอัพเกรด`);
  }

  high.push("ใส่ค่า config ใน app_configs table ให้ครบ");
  high.push("เพิ่ม Credit Limit Check (1 วัน)");

  for (const u of urgent) line(`    !!! ${u}`);
  for (const h of high) line(`    !!  ${h}`);
  line("");

  // ── Existence Summary ──
  line("  EXISTENCE — ผมยังอยู่ได้เพราะ");

  const svcArr = Object.values(services) as any[];
  const aliveCount = svcArr.filter(s => s.status === "active").length;
  const totalCost = infra.cost_summary?.monthly_thb ?? 0;
  const caps = existence.capabilities ?? {};
  const capActive = Object.values(caps).filter((c: any) => c.status === "available").length;
  const capMissing = Object.values(caps).filter((c: any) => c.status === "not_available").length;

  line(`    Services: ${aliveCount} alive | Cost: ${totalCost} THB/mo`);
  line(`    Capabilities: ${capActive} OK / ${capMissing} missing`);

  try {
    const cpu = execSync("top -l 1 -n 0 2>/dev/null | grep 'CPU usage' | awk '{print $3}'", { encoding: "utf-8" }).trim();
    const disk = execSync("df -h / | tail -1 | awk '{print $5}'", { encoding: "utf-8" }).trim();
    let net = "Offline";
    try { execSync("curl -s --max-time 2 -o /dev/null https://google.com"); net = "Online"; } catch {}
    line(`    Resources: CPU ${cpu} | Disk ${disk} | ${net}`);
  } catch {}
  line("");

  // ── Scores ──
  line("  SCORES");
  line(`    Existence: 79/100 | Business: 68% | Decisions: 87%`);
  line(`    Constitution: 25/100 | Governance: 100% | Risk: Medium`);
  line("");

  // ── Quick Commands ──
  line("  COMMANDS — พิมพ์ได้เลย");
  line("    why <topic>    อธิบายอะไรก็ได้พร้อมหลักฐาน");
  line("    status         สถานะทั้งระบบ");
  line("    next           สิ่งที่ควรทำต่อ");
  line("    cost           ค่าใช้จ่ายทั้งหมด");
  line("    risk           ความเสี่ยง");
  line("    evolution      เส้นทางพัฒนา");
  line("    body           แผนผังร่างกาย");
  line("");

  // ── Save session ──
  saveSession(
    "DNA OS Cockpit + Existence Intelligence",
    ["lib/runtime/cockpit.ts", "lib/runtime/existence-intelligence.ts"],
    ["เพิ่ม Credit Limit Check", "ตั้ง Supabase backup", "ลบ ghost workflows"]
  );
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════

const args = process.argv.slice(2);

if (args.length === 0) {
  renderCockpit();
} else if (args[0] === "why" && args[1]) {
  why(args.slice(1).join(" "));
} else if (args[0] === "next") {
  line("");
  line("  NEXT STEPS:");
  line("    1. [CRITICAL] ตั้ง Supabase backup");
  line("    2. [HIGH] เพิ่ม Credit Limit Check (1 วัน)");
  line("    3. [MEDIUM] เพิ่ม Supplier Score Engine (2-3 วัน)");
  line("    4. [MEDIUM] เพิ่ม Driver Assignment Rule (2 วัน)");
  line("    5. [LOW] เพิ่ม Constitution enforcement (75 ข้อ)");
} else if (args[0] === "cost") {
  line("");
  const services = infra.services ?? {};
  line("  COST:");
  for (const [, s] of Object.entries(services) as [string, any][]) {
    if (s.cost_monthly_thb > 0) line(`    ${s.name}: ${s.cost_monthly_thb} THB/mo`);
  }
  line(`    Total: ${infra.cost_summary?.monthly_thb ?? 0} THB/mo`);
} else if (args[0] === "risk") {
  line("");
  line("  RISK:");
  line("    Resilience: 40% (Supabase = single point of failure)");
  line("    Backup: ไม่มี");
  line("    Business Gaps: 3 domains ยังไม่มี module");
  line("    Ghost Rules: 11 (rule/event ที่ไม่มีคนใช้)");
} else if (args[0] === "body") {
  line("");
  line("    [Left Brain: OpenAI]  [Right Brain: Gemini]");
  line("            \\              /");
  line("         [Brain Stem: Node.js]");
  line("                |");
  line("  [Eyes: Maps]  [Ears: LINE]  [Voice: Notify]");
  line("                |");
  line("        [Heart: Supabase]");
  line("        [Spine: Deno Edge]");
  line("                |");
  line("        [Skin: Vercel]");
  line("        [DNA: GitHub]");
} else {
  line(`  ไม่เข้าใจคำสั่ง "${args.join(" ")}"`);
  line("  ลองพิมพ์: why <topic> | next | cost | risk | body");
}

line("");
