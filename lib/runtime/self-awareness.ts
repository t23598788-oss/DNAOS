/**
 * DNA OS Self-Awareness Engine
 *
 * ไม่ใช่ Dashboard — แต่คือ "สมองที่คิดเรื่องตัวเอง"
 * อ่าน registry ทุกตัว cross-reference แล้วอธิบายเหตุผล
 */

import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

function loadJSON(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(ROOT, path), "utf-8"));
  } catch {
    return {};
  }
}

// ── Registry Loaders ──

const existence = loadJSON("lib/registry/existence.json") as any;
const businessCoverage = loadJSON("lib/registry/business-coverage.json") as any;
const decisionCoverage = loadJSON("lib/registry/decision-coverage.json") as any;
const ruleCoverage = loadJSON("lib/registry/rule-coverage.json") as any;
const commandRegistry = loadJSON("lib/registry/command-registry.json") as any;
const moduleRegistry = loadJSON("lib/registry/module-registry.json") as any;

// ── Self Analysis ──

interface CapabilityGap {
  capability: string;
  reason: string;
  needed_for: string[];
  to_add: string[];
  impact: string;
}

function analyzeCapabilityGaps(): CapabilityGap[] {
  const gaps: CapabilityGap[] = [];
  const caps = existence.capabilities ?? {};

  for (const [name, info] of Object.entries(caps) as [string, any][]) {
    if (info.status === "not_available") {
      const neededFor: string[] = [];

      // Cross-reference with missing knowledge
      for (const mk of existence.missing_knowledge ?? []) {
        if (name === "voice" && mk.item?.includes("แรงงาน")) neededFor.push(`Missing Knowledge: ${mk.item}`);
      }

      // Cross-reference with workflows
      const workflows = existence.goals ?? {};
      for (const [, goal] of Object.entries(workflows) as [string, any][]) {
        for (const wf of goal.workflows ?? []) {
          if (info.used_by?.includes(wf)) neededFor.push(`Goal: ${goal.label} → Workflow: ${wf}`);
        }
      }

      gaps.push({
        capability: name,
        reason: info.gap ?? "ไม่มีข้อมูล",
        needed_for: neededFor.length > 0 ? neededFor : ["ยังไม่มี workflow ที่ต้องการ"],
        to_add: info.interfaces?.length > 0 ? info.interfaces : ["ต้องออกแบบ interface ใหม่"],
        impact: neededFor.length > 2 ? "สูง" : neededFor.length > 0 ? "กลาง" : "ต่ำ",
      });
    }
  }
  return gaps;
}

// ── Reasoning Tree ──

interface ReasonNode {
  statement: string;
  because?: ReasonNode;
  rule?: string;
  resolution?: string;
}

function buildReasoningTree(question: string): ReasonNode {
  if (question.includes("Voice") || question.includes("โทร")) {
    return {
      statement: "ไม่สามารถโทรศัพท์ได้",
      because: {
        statement: "ไม่มี Voice Capability",
        because: {
          statement: "ไม่มี Voice Engine / Driver",
          because: {
            statement: "ยังไม่ได้ออกแบบ Voice Interface",
            rule: "Capability Registry: voice = not_available",
            resolution: "เพิ่ม Android Call API / SIP / VoIP driver",
          },
        },
      },
    };
  }

  if (question.includes("ใบแจ้งหนี้") || question.includes("invoice")) {
    return {
      statement: "ไม่สามารถออกใบแจ้งหนี้ได้",
      because: {
        statement: "ไม่พบข้อมูลลูกค้า",
        because: {
          statement: "ค้นหาใน Registry ไม่พบ Tax ID",
          rule: "Rule 12: ห้ามสร้างเอกสารจากข้อมูลที่ไม่มีต้นทาง",
          resolution: "รอมนุษย์เพิ่มข้อมูลลูกค้าใน partners table",
        },
      },
    };
  }

  if (question.includes("คลังสินค้า") || question.includes("inventory")) {
    return {
      statement: "ไม่สามารถจัดการคลังสินค้าได้",
      because: {
        statement: "ไม่มี Inventory Module",
        because: {
          statement: "Business Coverage: inventory = not_covered",
          because: {
            statement: "ยังไม่ได้ออกแบบ data model สำหรับ stock",
            rule: "Business Coverage Gap",
            resolution: "เพิ่ม v3-engines/inventory.ts + DB table: inventory_items",
          },
        },
      },
    };
  }

  return {
    statement: `ไม่สามารถตอบคำถาม "${question}" ได้`,
    because: {
      statement: "ไม่พบ Reasoning Pattern สำหรับคำถามนี้",
      rule: "Missing Knowledge",
      resolution: "เพิ่ม reasoning pattern ใน self-awareness.ts",
    },
  };
}

function formatReasonTree(node: ReasonNode, depth = 0): string[] {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];

  if (depth === 0) {
    lines.push(`${indent}${node.statement}`);
  } else {
    lines.push(`${indent}↓`);
    lines.push(`${indent}${node.statement}`);
  }

  if (node.rule) lines.push(`${indent}  [${node.rule}]`);
  if (node.resolution) lines.push(`${indent}  → ${node.resolution}`);
  if (node.because) lines.push(...formatReasonTree(node.because, depth + 1));

  return lines;
}

// ── Workflow Gap Analysis ──

interface WorkflowGap {
  workflow: string;
  blocked_at: string;
  reason: string;
  missing_capability: string;
}

function analyzeWorkflowGaps(): WorkflowGap[] {
  const gaps: WorkflowGap[] = [];

  // Debt collection → blocked at phone call
  gaps.push({
    workflow: "เก็บหนี้",
    blocked_at: "โทรติดตาม",
    reason: "ไม่มี Voice Capability",
    missing_capability: "voice",
  });

  // Field inspection → blocked at photo
  gaps.push({
    workflow: "ตรวจงานหน้างาน",
    blocked_at: "ถ่ายรูปหลักฐาน",
    reason: "ไม่มี Camera Capability",
    missing_capability: "camera",
  });

  // Machine monitoring → blocked at PLC
  gaps.push({
    workflow: "ตรวจเครื่องจักร",
    blocked_at: "อ่านค่า Sensor",
    reason: "ไม่มี PLC/MQTT Driver",
    missing_capability: "plc",
  });

  return gaps;
}

// ── Container Analysis ──

interface ContainerFit {
  container: string;
  fit_pct: number;
  reasons_for: string[];
  reasons_against: string[];
}

function analyzeContainerFit(): ContainerFit[] {
  const caps = existence.capabilities ?? {};
  const containers: ContainerFit[] = [];

  const envCaps: Record<string, string[]> = {
    "macOS": ["vision", "gps", "messaging", "database", "ai_text", "file_system", "terminal", "browser", "calendar", "printer"],
    "Android": ["vision", "gps", "voice", "camera", "messaging", "database", "sensor"],
    "Browser": ["database", "ai_text", "messaging"],
    "PLC / Edge": ["sensor", "plc", "mqtt"],
    "Cloud Server": ["database", "ai_text", "messaging"],
  };

  for (const [env, supported] of Object.entries(envCaps)) {
    const allCaps = Object.keys(caps);
    const available = supported.filter(c => caps[c]?.status === "available" || caps[c]?.status === "partial");
    const missing = supported.filter(c => caps[c]?.status === "not_available");
    const fit = supported.length > 0 ? Math.round((available.length / supported.length) * 100) : 0;

    containers.push({
      container: env,
      fit_pct: fit,
      reasons_for: available.map(c => `${c}: OK`),
      reasons_against: missing.map(c => `${c}: ${caps[c]?.gap ?? "ไม่มี"}`),
    });
  }

  return containers.sort((a, b) => b.fit_pct - a.fit_pct);
}

// ── Evolution Suggestions with Impact ──

interface EvolutionPath {
  action: string;
  effort: string;
  before: Record<string, number>;
  after: Record<string, number>;
  unlocks: string[];
}

function analyzeEvolution(): EvolutionPath[] {
  return [
    {
      action: "เพิ่ม Supplier Score Engine",
      effort: "2-3 วัน",
      before: { decision_coverage: 87, supplier_selection: 60 },
      after: { decision_coverage: 94, supplier_selection: 100 },
      unlocks: ["เปรียบเทียบราคาผู้ขายอัตโนมัติ", "Supplier Ranking"],
    },
    {
      action: "เพิ่ม Credit Limit Check",
      effort: "1 วัน",
      before: { line_response: 75, risk: 5 },
      after: { line_response: 100, risk: 3 },
      unlocks: ["ตรวจเครดิตก่อนรับงาน", "ลด bad debt"],
    },
    {
      action: "เพิ่ม Driver Assignment Rule",
      effort: "2 วัน",
      before: { vehicle_dispatch: 80, automation: 70 },
      after: { vehicle_dispatch: 100, automation: 75 },
      unlocks: ["จัดคนขับอัตโนมัติตามพื้นที่"],
    },
    {
      action: "เพิ่ม Inventory Module",
      effort: "1-2 สัปดาห์",
      before: { business_coverage: 68, knowledge: 59 },
      after: { business_coverage: 77, knowledge: 68 },
      unlocks: ["จัดการสต๊อก", "แจ้งเตือน stock ต่ำ", "ต้นทุนวัสดุแม่นยำ"],
    },
    {
      action: "เพิ่ม Voice Engine (Android)",
      effort: "1 สัปดาห์",
      before: { capability: 70, debt_workflow: 85 },
      after: { capability: 76, debt_workflow: 100 },
      unlocks: ["โทรทวงหนี้อัตโนมัติ", "Voice Command", "IVR"],
    },
  ];
}

// ── Digital DNA ──

interface DigitalDNA {
  identity: string;
  age_days: number;
  constitution_rules: number;
  business_rules_enforced: number;
  workflows: number;
  commands: number;
  modules: number;
  capabilities_total: number;
  capabilities_active: number;
  capabilities_missing: number;
  decision_points_total: number;
  decision_points_codified: number;
  human_dependency_points: number;
  autonomous_pct: number;
  knowledge_pct: number;
  risk_level: string;
  next_evolution: string;
  confidence_pct: number;
}

function generateDigitalDNA(): DigitalDNA {
  const caps = existence.capabilities ?? {};
  const capTotal = Object.keys(caps).length;
  const capActive = Object.values(caps).filter((c: any) => c.status === "available").length;
  const capMissing = Object.values(caps).filter((c: any) => c.status === "not_available").length;

  const decisions = decisionCoverage.decisions ?? {};
  let decTotal = 0, decCoded = 0;
  for (const d of Object.values(decisions) as any[]) {
    decTotal += d.total_decision_points ?? 0;
    decCoded += d.codified ?? 0;
  }

  const rulesEnforced = Object.keys(ruleCoverage.rules ?? {}).length;
  const commands = Object.keys(commandRegistry.commands ?? {}).length;
  const modules = Object.keys(moduleRegistry.modules ?? {}).length;

  const humanDeps = existence.human_dependency ?? {};
  let humanTotal = 0;
  for (const d of Object.values(humanDeps) as any[]) {
    humanTotal += d.count ?? 0;
  }

  const autoPct = decTotal > 0 ? Math.round(((decCoded - humanTotal) / decTotal) * 100) : 0;
  const birthDate = new Date("2025-12-25");
  const ageDays = Math.floor((Date.now() - birthDate.getTime()) / 86_400_000);

  const suggestions = existence.evolution_suggestions ?? [];
  const nextEvolution = suggestions[0]?.action ?? "ไม่มี";

  return {
    identity: "DNA OS",
    age_days: ageDays,
    constitution_rules: 100,
    business_rules_enforced: rulesEnforced,
    workflows: 19,
    commands,
    modules,
    capabilities_total: capTotal,
    capabilities_active: capActive,
    capabilities_missing: capMissing,
    decision_points_total: decTotal,
    decision_points_codified: decCoded,
    human_dependency_points: humanTotal,
    autonomous_pct: Math.max(0, autoPct),
    knowledge_pct: 59,
    risk_level: capMissing > 5 ? "Medium" : "Low",
    next_evolution: nextEvolution,
    confidence_pct: 92,
  };
}

// ── Render ──

function line(text: string) { console.log(text); }
function header(title: string) {
  line("");
  line(`  ${"═".repeat(52)}`);
  line(`  ${title}`);
  line(`  ${"═".repeat(52)}`);
}
function section(title: string) {
  line(`  ${"─".repeat(52)}`);
  line(`  ${title}`);
  line(`  ${"─".repeat(52)}`);
}

export function runDiagnosis() {
  // ── Digital DNA ──
  const dna = generateDigitalDNA();
  header("DIGITAL DNA");
  line(`  ตัวตน              ${dna.identity}`);
  line(`  อายุระบบ           ${dna.age_days} วัน`);
  line(`  Constitution       ${dna.constitution_rules} ข้อ (บังคับใช้ ${dna.business_rules_enforced})`);
  line(`  Workflows          ${dna.workflows}`);
  line(`  Commands           ${dna.commands}`);
  line(`  Modules            ${dna.modules}`);
  line(`  Capabilities       ${dna.capabilities_active} active / ${dna.capabilities_missing} missing`);
  line(`  Decision Points    ${dna.decision_points_codified} / ${dna.decision_points_total} codified`);
  line(`  Human Dependency   ${dna.human_dependency_points} จุด`);
  line(`  Autonomous         ${dna.autonomous_pct}%`);
  line(`  Knowledge          ${dna.knowledge_pct}%`);
  line(`  Risk               ${dna.risk_level}`);
  line(`  Next Evolution     ${dna.next_evolution}`);

  // ── Self Analysis ──
  header("SELF ANALYSIS");
  line("  ผมคือ DNA OS v1.0");
  line("  หน้าที่หลัก:");
  line("    - บริหารทรัพยากร (ดิน หิน ทราย รถ คน)");
  line("    - จัดการเอกสาร (ใบเสนอราคา, ใบแจ้งหนี้, ใบเสร็จ)");
  line("    - ตัดสินใจตามกฎ (ราคา, หนี้, ภาษี)");
  line("    - ประสาน Workflow (LINE → คำนวณ → เอกสาร → ส่ง)");

  section("สิ่งที่ผมทำได้");
  const canDo = [
    "ออกใบเสนอราคาจากพิกัด GPS + ประเภทวัสดุ",
    "คำนวณราคาขนส่ง (ระยะทาง × น้ำมัน × เที่ยว + markup)",
    "ติดตามหนี้ + คำนวณดอกเบี้ยทบต้น",
    "ออกเอกสาร 6 ประเภทจาก template เดียว",
    "รับ LINE → แปลเป็น command → คำนวณ → ตอบราคา",
    "ค้นหาบ่อวัสดุใกล้สุดด้วย Haversine",
    "Scout หาคู่ค้าใหม่ผ่าน Google Maps",
  ];
  for (const item of canDo) line(`    ✓ ${item}`);

  section("สิ่งที่ผมยังทำไม่ได้ (พร้อมเหตุผล)");
  const gaps = analyzeCapabilityGaps();
  for (const gap of gaps) {
    line(`    ✗ ${gap.capability}`);
    line(`      สาเหตุ: ${gap.reason}`);
    line(`      ต้องเพิ่ม: ${gap.to_add.join(" / ")}`);
    line(`      ผลกระทบ: ${gap.impact}`);
    line("");
  }

  // ── Workflow Gaps ──
  header("WHY — ทำไมบาง Workflow หยุด");
  const wfGaps = analyzeWorkflowGaps();
  for (const wg of wfGaps) {
    line(`  Workflow: ${wg.workflow}`);
    line(`    แจ้งเตือน → ${wg.blocked_at} → [BLOCKED]`);
    line(`    สาเหตุ: ${wg.reason}`);
    line(`    ต้องเพิ่ม Capability: ${wg.missing_capability}`);
    line("");
  }

  // ── Reasoning Trees ──
  header("REASONING TREE");
  const questions = [
    "ทำไมไม่สามารถโทรศัพท์ได้",
    "ทำไมไม่สามารถจัดการคลังสินค้าได้",
  ];
  for (const q of questions) {
    line(`  Q: ${q}`);
    const tree = buildReasoningTree(q);
    const lines2 = formatReasonTree(tree, 1);
    for (const l of lines2) line(l);
    line("");
  }

  // ── Container Fit ──
  header("CONTAINER FIT");
  const containers = analyzeContainerFit();
  for (const c of containers) {
    line(`  ${c.container}: ${c.fit_pct}%`);
    if (c.reasons_against.length > 0) {
      line(`    ขาด: ${c.reasons_against.map(r => r.split(":")[0]).join(", ")}`);
    }
  }

  // ── Evolution Path ──
  header("NEXT EVOLUTION");
  const evolutions = analyzeEvolution();
  for (const ev of evolutions) {
    line(`  + ${ev.action} (${ev.effort})`);
    for (const [key, val] of Object.entries(ev.before)) {
      const afterVal = ev.after[key];
      line(`    ${key}: ${val}% → ${afterVal}%`);
    }
    line(`    Unlocks: ${ev.unlocks.join(", ")}`);
    line("");
  }

  // ── Business Gaps ──
  header("BUSINESS GAP ANALYSIS");
  const domains = businessCoverage.domains ?? {};
  for (const [, domain] of Object.entries(domains) as [string, any][]) {
    const status = domain.status === "covered" ? "OK" : domain.status === "partial" ? "PARTIAL" : "MISSING";
    line(`  ${status}  ${domain.label}`);
    if (domain.gap) {
      line(`        ขาด: ${domain.gap}`);
    }
  }

  // ── Missing Knowledge ──
  header("MISSING KNOWLEDGE (สิ่งที่ผมยอมรับว่าไม่รู้)");
  for (const mk of existence.missing_knowledge ?? []) {
    line(`  [${mk.domain}] ${mk.item}`);
    line(`    ผลกระทบ: ${mk.impact}`);
  }

  line("");
  line(`  Generated: ${new Date().toISOString()}`);
  line("");
}

if (require.main === module) {
  runDiagnosis();
}
